/**
 * OpNet RPC client — wraps JSONRpcProvider for oracle use cases.
 *
 * Responsibilities:
 * - Get current block height
 * - Call read methods on contracts (future: verify oracle registry state)
 * - Build + broadcast submitPrice interaction
 */

import { JSONRpcProvider } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
import {
    OPNetLimitedProvider,
    EcKeyPair,
    CalldataGenerator,
} from '@btc-vision/transaction';
import type { OpNetConfig, Network } from '../config/config.js';

export class OpNetClient {
    private readonly provider: JSONRpcProvider;
    private readonly limitedProvider: OPNetLimitedProvider;

    constructor(private readonly config: OpNetConfig, network: Network) {
        const btcNetwork = network === 'mainnet' ? networks.bitcoin : networks.testnet;
        this.provider = new JSONRpcProvider(config.rpcUrl, btcNetwork);
        this.limitedProvider = new OPNetLimitedProvider(config.rpcUrl);
    }

    /**
     * Get the current Bitcoin block height from OpNet node.
     */
    async getBlockNumber(): Promise<bigint> {
        return await this.provider.getBlockNumber();
    }

    /**
     * Call a read-only contract method.
     * Returns raw CallResult data.
     */
    async callContract(
        contractAddress: string,
        calldata: Buffer,
    ): Promise<Buffer> {
        const result = await this.provider.call(contractAddress, calldata);

        if ('error' in result) {
            throw new Error(`[OpNetClient] Contract call failed: ${JSON.stringify(result.error)}`);
        }

        // result.result is a BinaryReader — no direct buffer access, serialize via unknown
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const reader = (result as any).result;
        if (!reader) return Buffer.alloc(0);
        // BinaryReader exposes remaining bytes via readBytes(bytesLeft())
        const bytesLeft: number = reader.bytesLeft?.() ?? 0;
        if (bytesLeft === 0) return Buffer.alloc(0);
        return Buffer.from(reader.readBytes(bytesLeft) as Uint8Array);
    }

    /**
     * Build calldata for PriceFeed.submitPrice(asset, price, blockNumber, signature)
     *
     * Selector: sha256("submitPrice(string,uint256,uint64,bytes)")[0:4]
     * We hardcode the selector for now — will match the contract ABI.
     *
     * Encoding (manual, BytesWriter style):
     *   4 bytes  — method selector
     *   var      — asset (length-prefixed UTF-8)
     *   32 bytes — price (u256 big-endian)
     *   8 bytes  — blockNumber (u64 big-endian)
     *   var      — signature (length-prefixed bytes)
     */
    static buildSubmitPriceCalldata(
        asset: string,
        price: bigint,
        blockNumber: bigint,
        signature: Uint8Array,
    ): Buffer {
        const assetBytes = Buffer.from(asset, 'utf8');
        const priceBuf = Buffer.alloc(32);
        // Write u256 as big-endian (price fits in 8 bytes for now)
        priceBuf.writeBigUInt64BE(price, 24);

        const blockBuf = Buffer.alloc(8);
        blockBuf.writeBigUInt64BE(blockNumber);

        // Selector placeholder — will be replaced with real selector from ABI
        const SUBMIT_PRICE_SELECTOR = Buffer.from([0x00, 0x00, 0x00, 0x00]);

        const assetLenBuf = Buffer.alloc(4);
        assetLenBuf.writeUInt32BE(assetBytes.length);

        const sigLenBuf = Buffer.alloc(4);
        sigLenBuf.writeUInt32BE(signature.length);

        return Buffer.concat([
            SUBMIT_PRICE_SELECTOR,
            assetLenBuf,
            assetBytes,
            priceBuf,
            blockBuf,
            sigLenBuf,
            Buffer.from(signature),
        ]);
    }

    /**
     * Broadcast a raw transaction to the OpNet network.
     */
    async broadcastTransaction(rawTx: string): Promise<string> {
        const result = await this.limitedProvider.broadcastTransaction(rawTx, false);
        if (!result) throw new Error('[OpNetClient] Broadcast returned no result');
        if ('error' in result) throw new Error(`[OpNetClient] Broadcast failed: ${result}`);
        return (result as { txid?: string }).txid ?? '';
    }

    close(): void {
        this.provider.close().catch(() => {});
    }
}
