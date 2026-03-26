/**
 * PriceFeedMuSig2 — Pull oracle with MuSig2 Schnorr verification
 *
 * Pull model: oracles sign prices off-chain, dApps verify on-chain in their own tx.
 * Oracle pays 0 gas. dApp pays gas + optional fee.
 *
 * verifyAndGetPrice(asset, price, blockNum, sig, aggPubKey)
 *   - MAX_STALE_BLOCKS = 3 (~30 min) to prevent stale price exploitation
 *   - sha256(asset || price_u64be || blockNum_u64be)
 *   - Verifies BIP-340 Schnorr sig against registered aggPubKey
 *   - Returns (price, blockNum)
 */

import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Blockchain,
    Calldata,
    BytesWriter,
    Address,
    ExtendedAddress,
    StoredU256,
    StoredString,
    Revert,
    OP_NET,
    encodeSelector,
    Selector,
    EMPTY_POINTER,
    SignaturesMethods,
} from '@btc-vision/btc-runtime/runtime';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_STALE_BLOCKS: u64 = 3;     // ~30 min — prevents stale price exploitation
const MAX_OUTPUTS_SCAN: i32 = 20;    // max outputs to scan for fee
const DEFAULT_FEE_SATS: u64 = 2_000; // 2000 sats per price verification (testnet)

// ── Pointers ──────────────────────────────────────────────────────────────────

const PTR_AGG_PUBKEY_LOW:  u16 = 200;
const PTR_AGG_PUBKEY_HIGH: u16 = 201;
const PTR_REGISTRY:        u16 = 202;
const PTR_OWNER:           u16 = 203;
const PTR_FEE_SATS:        u16 = 204; // configurable fee in sats
const PTR_TREASURY_ADDR:   u16 = 205; // BTC address to receive fees

// ── Contract ──────────────────────────────────────────────────────────────────

@final
export class PriceFeedMuSig2 extends OP_NET {

    private readonly aggPubKeyLow:    StoredU256  = new StoredU256(PTR_AGG_PUBKEY_LOW,  EMPTY_POINTER);
    private readonly aggPubKeyHigh:   StoredU256  = new StoredU256(PTR_AGG_PUBKEY_HIGH, EMPTY_POINTER);
    private readonly registryStorage: StoredU256  = new StoredU256(PTR_REGISTRY, EMPTY_POINTER);
    private readonly ownerStorage:    StoredU256  = new StoredU256(PTR_OWNER, EMPTY_POINTER);
    private readonly feeSatsStorage:  StoredU256  = new StoredU256(PTR_FEE_SATS, EMPTY_POINTER);
    private readonly treasuryStorage: StoredString = new StoredString(PTR_TREASURY_ADDR, 0);

    public override onDeployment(_calldata: Calldata): void {
        this.ownerStorage.value    = u256.fromUint8ArrayBE(Blockchain.tx.sender);
        this.feeSatsStorage.value  = u256.fromU64(DEFAULT_FEE_SATS);
        // Treasury not set on deploy — fee check skipped until setTreasuryAddress called
    }

    public override execute(method: Selector, calldata: Calldata): BytesWriter {
        switch (method) {
            case encodeSelector('verifyAndGetPrice(bytes,uint256,uint256,bytes,bytes)'):
                return this.verifyAndGetPrice(calldata);
            case encodeSelector('setAggPubKey(uint256,uint256)'):
                return this.setAggPubKey(calldata);
            case encodeSelector('setRegistry(address)'):
                return this.setRegistry(calldata);
            case encodeSelector('getAggPubKey()'):
                return this.getAggPubKey();
            case encodeSelector('setTreasuryAddress(string)'):
                return this.setTreasuryAddress(calldata);
            case encodeSelector('setFeeSats(uint256)'):
                return this.setFeeSats(calldata);
            case encodeSelector('getTreasuryAddress()'):
                return this.getTreasuryAddress(calldata);
            case encodeSelector('getFeeSats()'):
                return this.getFeeSats(calldata);
            default:
                return super.execute(method, calldata);
        }
    }

    // ── verifyAndGetPrice ─────────────────────────────────────────────────────

    @method(
        { name: 'asset',     type: ABIDataTypes.BYTES   },
        { name: 'price',     type: ABIDataTypes.UINT256 },
        { name: 'blockNum',  type: ABIDataTypes.UINT256 },
        { name: 'sig',       type: ABIDataTypes.BYTES   },
        { name: 'aggPubKey', type: ABIDataTypes.BYTES   },
    )
    private verifyAndGetPrice(calldata: Calldata): BytesWriter {
        // Read asset (variable length)
        const assetLen   = calldata.readU32();
        if (assetLen === 0 || assetLen > 32) revert('Invalid asset length');
        const assetBytes = calldata.readBytes(assetLen, true);

        // Read price and blockNum
        const price    = calldata.readU256();
        const blockNum = calldata.readU256();
        if (price.isZero()) revert('Price cannot be zero');

        // Read sig — must be exactly 64 bytes
        const sigLen = calldata.readU32();
        if (sigLen !== 64) revert('sig must be 64 bytes');
        const sig = calldata.readBytes(64, true);

        // Read aggPubKey — must be exactly 32 bytes
        const pubKeyLen = calldata.readU32();
        if (pubKeyLen !== 32) revert('aggPubKey must be 32 bytes');
        const aggPubKey = calldata.readBytes(32, true);

        // Freshness check
        const currentBlock = Blockchain.block.number;
        const blockNumU64  = blockNum.lo1;
        if (currentBlock < blockNumU64) revert('Block in the future');
        if (currentBlock - blockNumU64 > MAX_STALE_BLOCKS) revert('Price too stale');

        // Verify aggPubKey matches registered key (if set)
        const storedLow = this.aggPubKeyLow.value;
        if (!storedLow.isZero()) {
            const keyFromCalldata = u256.fromUint8ArrayBE(aggPubKey);
            if (!u256.eq(storedLow, keyFromCalldata)) revert('aggPubKey not registered');
        }

        // Build canonical message: sha256(asset || price_u64be || blockNum_u64be)
        const msgLen = assetLen + 16;
        const msgBuf = new Uint8Array(msgLen);
        for (let i: u32 = 0; i < assetLen; i++) msgBuf[i] = assetBytes[i];

        const priceU64 = price.lo1;
        const o: u32   = assetLen;
        msgBuf[o]    = u8((priceU64 >> 56) & 0xff); msgBuf[o+1]  = u8((priceU64 >> 48) & 0xff);
        msgBuf[o+2]  = u8((priceU64 >> 40) & 0xff); msgBuf[o+3]  = u8((priceU64 >> 32) & 0xff);
        msgBuf[o+4]  = u8((priceU64 >> 24) & 0xff); msgBuf[o+5]  = u8((priceU64 >> 16) & 0xff);
        msgBuf[o+6]  = u8((priceU64 >>  8) & 0xff); msgBuf[o+7]  = u8( priceU64        & 0xff);

        const bU64 = blockNumU64;
        msgBuf[o+8]  = u8((bU64 >> 56) & 0xff); msgBuf[o+9]  = u8((bU64 >> 48) & 0xff);
        msgBuf[o+10] = u8((bU64 >> 40) & 0xff); msgBuf[o+11] = u8((bU64 >> 32) & 0xff);
        msgBuf[o+12] = u8((bU64 >> 24) & 0xff); msgBuf[o+13] = u8((bU64 >> 16) & 0xff);
        msgBuf[o+14] = u8((bU64 >>  8) & 0xff); msgBuf[o+15] = u8( bU64        & 0xff);

        const msgHash = Blockchain.sha256(msgBuf);

        // Verify BIP-340 Schnorr via verifySignature
        const tweakedArr = new Array<u8>(32);
        for (let i: u32 = 0; i < 32; i++) tweakedArr[i] = aggPubKey[i];
        const dummyArr = new Array<u8>(32);
        const extAddr  = new ExtendedAddress(tweakedArr, dummyArr);

        const valid = Blockchain.verifySignature(extAddr, sig, msgHash, SignaturesMethods.Schnorr);
        if (!valid) revert('Invalid MuSig2 Schnorr signature');

        // Fee check: tx must include output ≥ feeSats to treasury address
        // Skip if treasury not configured (allows free usage during setup)
        const treasury = this.treasuryStorage.value;
        if (treasury.length > 0) {
            const feeSats  = this.feeSatsStorage.value.toU64();
            this.verifyFeeOutput(treasury, feeSats);
        }

        // Return (price, blockNum)
        const writer = new BytesWriter(64);
        writer.writeU256(price);
        writer.writeU256(blockNum);
        return writer;
    }

    // ── Fee verification ──────────────────────────────────────────────────────

    private verifyFeeOutput(treasuryAddr: string, feeSats: u64): void {
        const outputs = Blockchain.tx.outputs;
        const limit: i32 = outputs.length < MAX_OUTPUTS_SCAN ? outputs.length : MAX_OUTPUTS_SCAN;
        for (let i: i32 = 0; i < limit; i++) {
            const out = outputs[i];
            if (out.value >= feeSats && out.to !== null && out.to === treasuryAddr) {
                return; // fee paid
            }
        }
        revert('Fee not paid: include output of ≥' + feeSats.toString() + ' sats to treasury');
    }

    // ── setAggPubKey (admin only) ─────────────────────────────────────────────

    @method(
        { name: 'pubKeyLow',  type: ABIDataTypes.UINT256 },
        { name: 'pubKeyHigh', type: ABIDataTypes.UINT256 },
    )
    private setAggPubKey(calldata: Calldata): BytesWriter {
        this.onlyOwner();
        const low  = calldata.readU256();
        const high = calldata.readU256();
        if (low.isZero()) revert('aggPubKey cannot be zero');
        this.aggPubKeyLow.value  = low;
        this.aggPubKeyHigh.value = high;
        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    // ── setTreasuryAddress / setFeeSats (admin only) ─────────────────────────

    @method({ name: 'btcAddress', type: ABIDataTypes.STRING })
    private setTreasuryAddress(calldata: Calldata): BytesWriter {
        this.onlyOwner();
        const addr = calldata.readStringWithLength();
        if (addr.length === 0) revert('Treasury address cannot be empty');
        this.treasuryStorage.value = addr;
        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    @method({ name: 'feeSats', type: ABIDataTypes.UINT256 })
    private setFeeSats(calldata: Calldata): BytesWriter {
        this.onlyOwner();
        const fee = calldata.readU256();
        this.feeSatsStorage.value = fee;
        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    @method()
    private getTreasuryAddress(_calldata: Calldata): BytesWriter {
        const addr = this.treasuryStorage.value;
        const w    = new BytesWriter(4 + addr.length);
        w.writeStringWithLength(addr);
        return w;
    }

    @method()
    private getFeeSats(_calldata: Calldata): BytesWriter {
        const w = new BytesWriter(32);
        w.writeU256(this.feeSatsStorage.value);
        return w;
    }

    // ── setRegistry (admin only) ──────────────────────────────────────────────

    @method({ name: 'registry', type: ABIDataTypes.ADDRESS })
    private setRegistry(calldata: Calldata): BytesWriter {
        this.onlyOwner();
        const addr = calldata.readAddress();
        this.registryStorage.value = u256.fromUint8ArrayBE(addr);
        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    // ── getAggPubKey ──────────────────────────────────────────────────────────

    @method()
    @returns({ name: 'pubKeyLow', type: ABIDataTypes.UINT256 })
    private getAggPubKey(_calldata: Calldata): BytesWriter {
        const writer = new BytesWriter(64);
        writer.writeU256(this.aggPubKeyLow.value);
        writer.writeU256(this.aggPubKeyHigh.value);
        return writer;
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private onlyOwner(): void {
        const caller = u256.fromUint8ArrayBE(Blockchain.tx.sender);
        if (!u256.eq(caller, this.ownerStorage.value)) revert('Not owner');
    }
}

function revert(msg: string): void {
    throw new Revert(msg);
}
