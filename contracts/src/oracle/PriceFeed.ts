/**
 * PriceFeed — On-chain price aggregation for BTC Oracle Network
 *
 * Receives signed price attestations from registered oracles,
 * verifies signatures on-chain, and stores a quorum-backed price.
 *
 * Anti-stale: uses Blockchain.block.number ONLY (never medianTime — miner-manipulable).
 */

import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Blockchain,
    Calldata,
    BytesWriter,
    Address,
    AddressMemoryMap,
    StoredU256,
    Revert,
    SafeMath,
    EMPTY_POINTER,
    OP_NET,
    encodeSelector,
    Selector,
} from '@btc-vision/btc-runtime/runtime';

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_QUORUM:       u64 = 1; // TODO: set to 3 for production
const MAX_STALE_BLOCKS: u64 = 6;

const SEL_IS_ACTIVE: Selector = encodeSelector('isActive(address)');

@final
export class PriceFeed extends OP_NET {

    // ── Storage ───────────────────────────────────────────────────────────────

    /** asset_hash → latest aggregated price (USD cents * 100). */
    private readonly latestPriceMap:  AddressMemoryMap = new AddressMemoryMap(Blockchain.nextPointer);
    /** asset_hash → block number of latest price update. */
    private readonly latestBlockMap:  AddressMemoryMap = new AddressMemoryMap(Blockchain.nextPointer);
    /** roundKey → count of submissions this round. */
    private readonly roundCountMap:   AddressMemoryMap = new AddressMemoryMap(Blockchain.nextPointer);
    /** oracleRoundKey → submitted price. */
    private readonly roundPricesMap:  AddressMemoryMap = new AddressMemoryMap(Blockchain.nextPointer);

    /** OracleRegistry contract address. */
    private readonly registryPtr: u16       = Blockchain.nextPointer;
    private readonly registryStorage: StoredU256 = new StoredU256(this.registryPtr, EMPTY_POINTER);

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor() {
        super();
    }

    public override onDeployment(_calldata: Calldata): void {}

    // ── Entrypoint ────────────────────────────────────────────────────────────

    public override execute(method: Selector, calldata: Calldata): BytesWriter {
        switch (method) {
            case encodeSelector('submitPrice(bytes,u256,u256,bytes)'):
                return this.submitPrice(calldata);
            case encodeSelector('getPrice(bytes)'):
                return this.getPrice(calldata);
            case encodeSelector('getLatestBlock(bytes)'):
                return this.getLatestBlock(calldata);
            case encodeSelector('setRegistry(address)'):
                return this.setRegistry(calldata);
            default:
                return super.execute(method, calldata);
        }
    }

    // ── Write methods ─────────────────────────────────────────────────────────

    @method(
        { name: 'asset',     type: ABIDataTypes.BYTES },
        { name: 'price',     type: ABIDataTypes.UINT256 },
        { name: 'blockNum',  type: ABIDataTypes.UINT256 },
        { name: 'signature', type: ABIDataTypes.BYTES },
    )
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    @emit('PriceSubmitted')
    public submitPrice(calldata: Calldata): BytesWriter {
        const caller = Blockchain.tx.sender;

        const assetLen:   u32         = calldata.readU32();
        const assetBytes: Uint8Array  = calldata.readBytes(assetLen, true);
        const price:      u256        = calldata.readU256();
        const blockNum:   u256        = calldata.readU256();
        const sigLen:     u32         = calldata.readU32();
        const signature:  Uint8Array  = calldata.readBytes(sigLen, true);

        // 1. Anti-stale — block.number only, NEVER medianTime
        const current:   u64 = Blockchain.block.number;
        const submitted: u64 = blockNum.toU64();
        if (submitted > current) throw new Revert('Block in the future');
        if (current - submitted > MAX_STALE_BLOCKS) throw new Revert('Attestation stale');

        // 2. Oracle must be registered and active
        this.verifyOracleActive(caller);

        // 3. Rebuild message hash — must match OracleSigner.buildMessage() exactly
        const msgHash = this.buildMessageHash(assetBytes, price, blockNum);

        // 4. Verify signature (tx.origin = ExtendedAddress of the signer)
        if (!Blockchain.verifySignature(Blockchain.tx.origin, signature, msgHash)) {
            throw new Revert('Invalid oracle signature');
        }

        // 5. Derive storage keys
        const assetKey       = this.hashToAddress(assetBytes);
        const roundKey       = this.roundKeyFor(assetBytes, blockNum);
        const oracleRoundKey = this.oracleRoundKeyFor(roundKey, caller);

        // 6. Dedup
        if (!u256.eq(this.roundPricesMap.get(oracleRoundKey), u256.Zero)) {
            throw new Revert('Already submitted for this round');
        }

        // 7. Store submission
        this.roundPricesMap.set(oracleRoundKey, price);
        const count = SafeMath.add(this.roundCountMap.get(roundKey), u256.One);
        this.roundCountMap.set(roundKey, count);

        // 8. Quorum reached → update latest price
        if (count.toU64() >= MIN_QUORUM) {
            const lastBlock = this.latestBlockMap.get(assetKey);
            if (u256.ge(blockNum, lastBlock)) {
                this.latestPriceMap.set(assetKey, price);
                this.latestBlockMap.set(assetKey, blockNum);
            }
        }

        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    @method({ name: 'oracleRegistry', type: ABIDataTypes.ADDRESS })
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public setRegistry(calldata: Calldata): BytesWriter {
        if (!Blockchain.tx.sender.equals(this.contractDeployer)) {
            throw new Revert('Only deployer');
        }
        const addr = calldata.readAddress();
        // Address IS a Uint8Array — store directly as u256 BE
        this.registryStorage.value = u256.fromUint8ArrayBE(addr);
        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    // ── View methods ──────────────────────────────────────────────────────────

    @method({ name: 'asset', type: ABIDataTypes.BYTES })
    @returns({ name: 'price', type: ABIDataTypes.UINT256 })
    public getPrice(calldata: Calldata): BytesWriter {
        const assetLen   = calldata.readU32();
        const assetBytes = calldata.readBytes(assetLen, true);
        const assetKey   = this.hashToAddress(assetBytes);

        const price     = this.latestPriceMap.get(assetKey);
        const lastBlock = this.latestBlockMap.get(assetKey);

        if (u256.eq(price, u256.Zero)) throw new Revert('No price available');
        if (Blockchain.block.number - lastBlock.toU64() > MAX_STALE_BLOCKS) throw new Revert('Price stale');

        const w = new BytesWriter(32);
        w.writeU256(price);
        return w;
    }

    @method({ name: 'asset', type: ABIDataTypes.BYTES })
    @returns({ name: 'blockNumber', type: ABIDataTypes.UINT256 })
    public getLatestBlock(calldata: Calldata): BytesWriter {
        const assetLen   = calldata.readU32();
        const assetBytes = calldata.readBytes(assetLen, true);
        const w = new BytesWriter(32);
        w.writeU256(this.latestBlockMap.get(this.hashToAddress(assetBytes)));
        return w;
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    private verifyOracleActive(oracleAddr: Address): void {
        const regU256 = this.registryStorage.value;
        if (u256.eq(regU256, u256.Zero)) return; // not set — skip (dev/testing)

        const regBytes = regU256.toUint8Array(true);
        const regAddr  = Address.fromUint8Array(regBytes);
        const cd       = new BytesWriter(36);
        cd.writeSelector(SEL_IS_ACTIVE);
        cd.writeAddress(oracleAddr);

        const result = Blockchain.call(regAddr, cd, true);
        if (!result.success) throw new Revert('OracleRegistry call failed');
        if (!result.data.readBoolean()) throw new Revert('Oracle not active');
    }

    /** sha256(asset || price_u64be || blockNumber_u64be) */
    private buildMessageHash(assetBytes: Uint8Array, price: u256, blockNumber: u256): Uint8Array {
        const pU64 = price.toU64();
        const bU64 = blockNumber.toU64();
        const pre  = new Uint8Array(assetBytes.length + 16);

        for (let i: i32 = 0; i < assetBytes.length; i++) pre[i] = assetBytes[i];
        const o: i32 = assetBytes.length;
        pre[o]    = u8((pU64 >> 56) & 0xff); pre[o+1]  = u8((pU64 >> 48) & 0xff);
        pre[o+2]  = u8((pU64 >> 40) & 0xff); pre[o+3]  = u8((pU64 >> 32) & 0xff);
        pre[o+4]  = u8((pU64 >> 24) & 0xff); pre[o+5]  = u8((pU64 >> 16) & 0xff);
        pre[o+6]  = u8((pU64 >>  8) & 0xff); pre[o+7]  = u8( pU64        & 0xff);
        pre[o+8]  = u8((bU64 >> 56) & 0xff); pre[o+9]  = u8((bU64 >> 48) & 0xff);
        pre[o+10] = u8((bU64 >> 40) & 0xff); pre[o+11] = u8((bU64 >> 32) & 0xff);
        pre[o+12] = u8((bU64 >> 24) & 0xff); pre[o+13] = u8((bU64 >> 16) & 0xff);
        pre[o+14] = u8((bU64 >>  8) & 0xff); pre[o+15] = u8( bU64        & 0xff);

        return Blockchain.sha256(pre);
    }

    private hashToAddress(data: Uint8Array): Address {
        return Address.fromUint8Array(Blockchain.sha256(data));
    }

    private roundKeyFor(assetBytes: Uint8Array, blockNum: u256): Address {
        const bU64 = blockNum.toU64();
        const buf  = new Uint8Array(assetBytes.length + 8);
        for (let i: i32 = 0; i < assetBytes.length; i++) buf[i] = assetBytes[i];
        const o: i32 = assetBytes.length;
        buf[o]   = u8((bU64 >> 56) & 0xff); buf[o+1] = u8((bU64 >> 48) & 0xff);
        buf[o+2] = u8((bU64 >> 40) & 0xff); buf[o+3] = u8((bU64 >> 32) & 0xff);
        buf[o+4] = u8((bU64 >> 24) & 0xff); buf[o+5] = u8((bU64 >> 16) & 0xff);
        buf[o+6] = u8((bU64 >>  8) & 0xff); buf[o+7] = u8( bU64        & 0xff);
        return this.hashToAddress(buf);
    }

    private oracleRoundKeyFor(roundKey: Address, oracle: Address): Address {
        // Combine roundKey + oracle into a 64-byte buffer and hash to Address
        // We use the string representations to get stable byte sequences
        const rHex = roundKey.toHex();
        const oHex = oracle.toHex();
        const combined = rHex + oHex;
        const buf = new Uint8Array(combined.length);
        for (let i: i32 = 0; i < combined.length; i++) {
            buf[i] = u8(combined.charCodeAt(i));
        }
        return this.hashToAddress(buf);
    }
}
