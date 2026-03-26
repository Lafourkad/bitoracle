/**
 * DLCManager — Bitcoin L1 DLC lifecycle for oracle staking.
 *
 * Model:
 *   Oracle stakes BTC in a P2WSH script with two spending paths:
 *
 *   Path A (normal unstake):
 *     OP_IF
 *       <oracle_pubkey> OP_CHECKSIG   -- oracle signs to withdraw after timelock
 *     OP_ELSE
 *       <timelock> OP_CHECKSEQUENCEVERIFY OP_DROP
 *       <oracle_pubkey> OP_CHECKSIG
 *     OP_ENDIF
 *
 *   Path B (slash):
 *     <protocol_pubkey> OP_CHECKSIG   -- protocol signs when fraud proof published
 *
 *   In practice: 2-of-2 multisig where both paths require protocol signature,
 *   but normal path adds a timelock for dispute window.
 *
 * The OracleRegistry OpNet contract:
 *   - Records the stake (UTXO txid + amount) when oracle sends tx with correct output
 *   - Publishes fraud proofs that enable the slash path
 *   - Authorizes withdrawals after unbonding period
 *
 * NOTE: Full DLC construction (adaptor signatures, CETs) is a future milestone.
 * This implementation uses a simpler 2-of-2 multisig P2WSH as a functional
 * equivalent for staking/slashing without the full DLC complexity.
 */

import {
    payments,
    script as btcScript,
    opcodes,
    networks,
    Psbt,
    toSatoshi,
    type Script,
} from '@btc-vision/bitcoin';

// Helper to cast Buffer/Uint8Array to branded Script type
const asScript = (b: Uint8Array | Buffer): Script => b as unknown as Script;
import { EcKeyPair, OPNetLimitedProvider } from '@btc-vision/transaction';
import type { UTXO } from '@btc-vision/transaction';
import type { Network } from '../config/config.js';

export interface StakeInfo {
    txid: string;
    outputIndex: number;
    amount: bigint;          // satoshis
    scriptHex: string;       // P2WSH redeem script hex
    oraclePubKey: string;    // hex
    protocolPubKey: string;  // hex
    unbondingBlocks: number; // CSV timelock for normal withdrawal
}

export interface DLCConfig {
    btcPrivateKeyHex: string;
    protocolPubKeyHex: string;   // protocol's pubkey for slash path
    network: Network;
    rpcUrl: string;
    unbondingBlocks?: number;    // default: 144 (~24h)
}

// Script: OP_2 <oracle_pub> <protocol_pub> OP_2 OP_CHECKMULTISIG
// Slash path: protocol signs unilaterally (needs adaptor sig in full DLC)
// Normal path: both sign cooperatively after unbonding
function buildStakeScript(oraclePub: Uint8Array, protocolPub: Uint8Array): Script {
    return btcScript.compile([
        opcodes.OP_2,
        oraclePub,
        protocolPub,
        opcodes.OP_2,
        opcodes.OP_CHECKMULTISIG,
    ]);
}

export class DLCManager {
    private readonly btcNetwork: typeof networks.bitcoin;
    private readonly keypair: ReturnType<typeof EcKeyPair.fromPrivateKey>;
    private readonly protocolPubKey: Buffer;
    private readonly limitedProvider: OPNetLimitedProvider;
    private readonly unbondingBlocks: number;

    constructor(config: DLCConfig) {
        this.btcNetwork = config.network === 'mainnet' ? networks.bitcoin : networks.testnet;
        const privKey = Buffer.from(config.btcPrivateKeyHex, 'hex');
        this.keypair = EcKeyPair.fromPrivateKey(privKey, this.btcNetwork);
        this.protocolPubKey = Buffer.from(config.protocolPubKeyHex, 'hex');
        this.limitedProvider = new OPNetLimitedProvider(config.rpcUrl);
        this.unbondingBlocks = config.unbondingBlocks ?? 144;
    }

    get oraclePubKey(): Uint8Array {
        return new Uint8Array(this.keypair.publicKey);
    }

    get oracleAddress(): string {
        return EcKeyPair.getTaprootAddress(this.keypair, this.btcNetwork);
    }

    /**
     * Build the P2WSH stake address.
     * Oracle sends BTC here to stake — the OpNet contract verifies this output.
     */
    getStakeAddress(): { address: string; redeemScript: Script } {
        const redeemScript = buildStakeScript(this.oraclePubKey, this.protocolPubKey);
        const p2wsh = payments.p2wsh({ redeem: { output: redeemScript }, network: this.btcNetwork });

        if (!p2wsh.address) throw new Error('[DLC] Failed to derive P2WSH address');

        return { address: p2wsh.address, redeemScript };
    }

    /**
     * Build the staking transaction.
     * Sends `amountSats` to the P2WSH stake address.
     * The caller broadcasts this tx and passes the txid to OpNet OracleRegistry.
     *
     * Returns: { psbtHex, stakeAddress, redeemScript }
     */
    async buildStakeTx(
        amountSats: bigint,
        feeRate = 5,
    ): Promise<{ psbtHex: string; stakeAddress: string; redeemScript: Script }> {
        const { address: stakeAddress, redeemScript } = this.getStakeAddress();

        // Fetch UTXOs from oracle's own address to fund the stake
        const utxos = await this.limitedProvider.fetchUTXO({
            address: this.oracleAddress,
            minAmount: amountSats + 10000n, // stake + fees buffer
            requestedAmount: amountSats + 50000n,
            optimized: true,
        });

        if (!utxos || utxos.length === 0) {
            throw new Error(`[DLC] No UTXOs available at ${this.oracleAddress}`);
        }

        const psbt = new Psbt({ network: this.btcNetwork });

        // Add inputs
        let inputTotal = 0n;
        for (const utxo of utxos as UTXO[]) {
            psbt.addInput({
                hash: utxo.transactionId,
                index: utxo.outputIndex,
                witnessUtxo: {
                    script: asScript(Buffer.from(utxo.scriptPubKey.hex, 'hex')),
                    value: toSatoshi(utxo.value),
                },
            });
            inputTotal += utxo.value;
        }

        // Add stake output (P2WSH)
        psbt.addOutput({ address: stakeAddress, value: toSatoshi(amountSats) });

        // Change output (rough estimate — real impl needs proper fee calc)
        const estimatedFee = BigInt(feeRate * 200); // ~200 vbytes
        const change = inputTotal - amountSats - estimatedFee;
        if (change > 546n) { // dust threshold
            psbt.addOutput({ address: this.oracleAddress, value: toSatoshi(change) });
        }

        // Sign inputs
        psbt.signAllInputs(this.keypair as Parameters<typeof psbt.signAllInputs>[0]);
        psbt.finalizeAllInputs();

        return {
            psbtHex: psbt.extractTransaction().toHex(),
            stakeAddress,
            redeemScript,
        };
    }

    /**
     * Build a cooperative withdrawal tx (normal unstake).
     * Requires both oracle + protocol signatures.
     * In production: request protocol co-signature via OpNet OracleRegistry.
     *
     * TODO: integrate OpNet RPC call to request protocol co-signature.
     */
    async buildWithdrawTx(
        stake: StakeInfo,
        destinationAddress: string,
        feeRate = 5,
    ): Promise<string> {
        const redeemScript = Buffer.from(stake.scriptHex, 'hex');
        const psbt = new Psbt({ network: this.btcNetwork });

        const p2wshOutput = payments.p2wsh({
            redeem: { output: asScript(redeemScript) },
            network: this.btcNetwork,
        }).output!;

        psbt.addInput({
            hash: stake.txid,
            index: stake.outputIndex,
            witnessUtxo: {
                script: p2wshOutput,
                value: toSatoshi(stake.amount),
            },
            witnessScript: asScript(redeemScript),
            sequence: stake.unbondingBlocks,
        });

        const fee = BigInt(feeRate * 150);
        psbt.addOutput({ address: destinationAddress, value: toSatoshi(stake.amount - fee) });

        // Oracle signs
        psbt.signInput(0, this.keypair as Parameters<typeof psbt.signInput>[1]);

        // TODO: protocol co-signature via OpNet
        console.log('[DLC] Withdrawal tx built — awaiting protocol co-signature');
        return psbt.toBase64(); // return unsigned PSBT for protocol to co-sign
    }

    /**
     * Monitor OpNet OracleRegistry for slash events targeting this oracle.
     * Polls every N blocks — in production, use event subscription.
     */
    async startSlashWatcher(
        registryAddress: string,
        stake: StakeInfo,
        onSlash: (stake: StakeInfo) => Promise<void>,
        pollIntervalMs = 60_000,
    ): Promise<NodeJS.Timeout> {
        console.log(`[DLC] Slash watcher started for stake ${stake.txid.slice(0, 16)}...`);

        return setInterval(async () => {
            try {
                const slashed = await this.checkIfSlashed(registryAddress, stake);
                if (slashed) {
                    console.warn(`[DLC] Slash detected for ${stake.txid.slice(0, 16)}!`);
                    await onSlash(stake);
                }
            } catch (err) {
                console.error('[DLC] Slash watcher error:', err);
            }
        }, pollIntervalMs);
    }

    private async checkIfSlashed(
        _registryAddress: string,
        _stake: StakeInfo,
    ): Promise<boolean> {
        // TODO: call OracleRegistry.isSlashed(oracleAddress) via OpNet RPC
        // For now returns false — will be wired once contracts are deployed
        return false;
    }
}
