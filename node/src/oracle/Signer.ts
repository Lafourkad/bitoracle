/**
 * Signs price attestations with the oracle's Schnorr key.
 * Uses @btc-vision/transaction MessageSigner + EcKeyPair (backend mode).
 */

import { createHash } from 'crypto';
import { MessageSigner, EcKeyPair } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import type { UniversalSigner } from '@btc-vision/ecpair';
import type { PriceAttestation } from './types.js';
import type { OracleConfig } from '../config/config.js';

export class OracleSigner {
    private readonly keypair: UniversalSigner;
    private readonly address: string;

    constructor(config: OracleConfig) {
        if (!config.schnorrPrivateKey) throw new Error('SCHNORR_PRIVATE_KEY is required');

        const network = config.network === 'mainnet' ? networks.bitcoin : networks.testnet;
        const privKeyBytes = Buffer.from(config.schnorrPrivateKey, 'hex');
        this.keypair = EcKeyPair.fromPrivateKey(privKeyBytes, network);

        // Derive address from public key (x-only Schnorr pubkey, 32 bytes hex)
        this.address = Buffer.from(this.keypair.publicKey).slice(1).toString('hex');
    }

    get oracleAddress(): string {
        return this.address;
    }

    get publicKey(): Uint8Array {
        // x-only Schnorr pubkey (32 bytes, strip 0x02/0x03 prefix)
        return new Uint8Array(Buffer.from(this.keypair.publicKey).slice(1));
    }

    /**
     * Canonical message: sha256(asset_utf8 || price_u64_be || blockNumber_u64_be)
     * This is what the OpNet contract will verify on-chain.
     */
    static buildMessage(asset: string, price: bigint, blockNumber: bigint): Uint8Array {
        const assetBytes = Buffer.from(asset, 'utf8');
        const priceBuf = Buffer.allocUnsafe(8);
        priceBuf.writeBigUInt64BE(price);
        const blockBuf = Buffer.allocUnsafe(8);
        blockBuf.writeBigUInt64BE(blockNumber);
        const preimage = Buffer.concat([assetBytes, priceBuf, blockBuf]);
        return new Uint8Array(createHash('sha256').update(preimage).digest());
    }

    /**
     * Sign a price attestation with Schnorr BIP340.
     * MessageSigner.signMessage() uses the untweaked key directly — correct for
     * oracle attestations (not Taproot address spending).
     */
    async sign(
        asset: string,
        price: bigint,
        blockNumber: bigint,
    ): Promise<PriceAttestation> {
        const msgHash = OracleSigner.buildMessage(asset, price, blockNumber);
        const signed = MessageSigner.signMessage(this.keypair, msgHash);

        return {
            asset,
            price,
            blockNumber,
            oracleAddress: this.address,
            signature: signed.signature,
            timestamp: Date.now(),
        };
    }

    /**
     * Verify a peer attestation locally before adding to round buffer.
     */
    static verify(attestation: PriceAttestation, pubKey: Uint8Array): boolean {
        const msgHash = OracleSigner.buildMessage(
            attestation.asset,
            attestation.price,
            attestation.blockNumber,
        );
        // MessageSigner.verifySignature expects untweaked 33-byte pubkey
        const fullPubKey = new Uint8Array(33);
        fullPubKey[0] = 0x02;
        fullPubKey.set(pubKey, 1);
        return MessageSigner.verifySignature(fullPubKey, msgHash, attestation.signature);
    }
}
