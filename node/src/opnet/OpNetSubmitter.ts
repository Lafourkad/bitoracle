/**
 * OpNetSubmitter — builds, signs, and broadcasts OpNet interaction transactions.
 *
 * Handles the full submission flow:
 * 1. Fetch current UTXOs for the oracle wallet
 * 2. Fetch the current epoch challenge (PoW required for interactions)
 * 3. Build the interaction tx via TransactionFactory.signInteraction()
 * 4. Broadcast funding tx + interaction tx via OPNetLimitedProvider
 */

import { TransactionFactory } from '@btc-vision/transaction';
import { networks, type Network as BtcNetwork } from '@btc-vision/bitcoin';
import { JSONRpcProvider } from 'opnet';
import { OPNetLimitedProvider, EcKeyPair } from '@btc-vision/transaction';
import type { UTXO, FetchUTXOParams } from '@btc-vision/transaction';
import type { UniversalSigner } from '@btc-vision/ecpair';
import type { Network } from '../config/config.js';

// Selector for PriceFeed.submitPrice — placeholder until contract is deployed
// Will be sha256("submitPrice(string,uint256,uint64,bytes)")[0:4] from actual ABI
const SUBMIT_PRICE_SELECTOR = Buffer.from([0x53, 0x75, 0x62, 0x50]); // "SubP" placeholder

export class OpNetSubmitter {
    private readonly factory: TransactionFactory;
    private readonly provider: JSONRpcProvider;
    private readonly limitedProvider: OPNetLimitedProvider;
    private readonly keypair: UniversalSigner;
    private readonly btcNetwork: BtcNetwork;
    private readonly walletAddress: string;

    constructor(
        rpcUrl: string,
        privateKeyHex: string,
        network: Network,
    ) {
        this.btcNetwork = network === 'mainnet' ? networks.bitcoin : networks.testnet;
        this.provider = new JSONRpcProvider(rpcUrl, this.btcNetwork);
        this.limitedProvider = new OPNetLimitedProvider(rpcUrl);
        this.factory = new TransactionFactory();

        const privKeyBytes = Buffer.from(privateKeyHex, 'hex');
        this.keypair = EcKeyPair.fromPrivateKey(privKeyBytes, this.btcNetwork);

        // Derive P2TR wallet address from keypair
        this.walletAddress = EcKeyPair.getTaprootAddress(this.keypair, this.btcNetwork);
    }

    get address(): string {
        return this.walletAddress;
    }

    /**
     * Submit a price to the PriceFeed contract.
     *
     * @param contractAddress — deployed PriceFeed contract address
     * @param calldata — pre-built calldata from OpNetClient.buildSubmitPriceCalldata()
     * @param feeRate — sat/vbyte (default: 5)
     */
    async submitPrice(
        contractAddress: string,
        calldata: Buffer,
        feeRate = 5,
    ): Promise<string> {
        // 1. Fetch UTXOs for our wallet
        const utxos = await this.fetchUTXOs();
        if (utxos.length === 0) {
            throw new Error(`[OpNetSubmitter] No UTXOs available for ${this.walletAddress}`);
        }

        // 2. Fetch epoch challenge (required for all interactions)
        const challenge = await this.provider.getChallenge();

        // 3. Build + sign the interaction transaction
        const response = await this.factory.signInteraction({
            signer: this.keypair,
            to: contractAddress,
            calldata: new Uint8Array(calldata),
            utxos,
            feeRate,
            priorityFee: 0n,
            gasSatFee: 330n,        // minimum gas fee in satoshis
            challenge,
            network: this.btcNetwork,
            from: this.walletAddress,
        });

        // 4. Broadcast funding tx first (if present), then interaction tx
        if (response.fundingTransaction) {
            const fundResult = await this.limitedProvider.broadcastTransaction(
                response.fundingTransaction,
                false,
            );
            if (!fundResult) throw new Error('[OpNetSubmitter] Funding tx broadcast failed');
            console.log(`[OpNetSubmitter] Funding tx broadcast: ${JSON.stringify(fundResult)}`);
        }

        const result = await this.limitedProvider.broadcastTransaction(
            response.interactionTransaction,
            false,
        );

        if (!result) throw new Error('[OpNetSubmitter] Interaction tx broadcast failed');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const txid = (result as any).txid ?? (result as any).result ?? 'unknown';
        console.log(`[OpNetSubmitter] Interaction tx broadcast: ${txid}`);
        return txid;
    }

    private async fetchUTXOs(): Promise<UTXO[]> {
        const params: FetchUTXOParams = {
            address: this.walletAddress,
            minAmount: 1000n,           // 1000 sats minimum per UTXO
            requestedAmount: 100000n,   // ~0.001 BTC should cover fees
            optimized: true,
        };
        return await this.limitedProvider.fetchUTXO(params);
    }

    close(): void {
        this.provider.close().catch(() => {});
    }
}
