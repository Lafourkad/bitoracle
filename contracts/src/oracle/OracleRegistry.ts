/**
 * OracleRegistry — Oracle membership and stake tracking for BTC Oracle Network
 *
 * Manages which oracle nodes are active, their stake proofs (verified via tx.outputs),
 * and fraud proof publication for the DLC slash mechanism.
 *
 * IMPORTANT: This contract CANNOT hold or send BTC.
 * It only VERIFIES that BTC was sent to the stake address by reading tx.outputs.
 * The actual BTC lives in a P2WSH 2-of-2 multisig on Bitcoin L1.
 */

import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Blockchain,
    Calldata,
    BytesWriter,
    Address,
    ExtendedAddress,
    AddressMemoryMap,
    StoredU256,
    StoredAddress,
    Revert,
    SafeMath,
    EMPTY_POINTER,
    OP_NET,
    encodeSelector,
    Selector,
} from '@btc-vision/btc-runtime/runtime';

// ── Status constants ──────────────────────────────────────────────────────────

const STATUS_INACTIVE:        u256 = u256.Zero;
const STATUS_ACTIVE:          u256 = u256.One;
const STATUS_SLASHED:         u256 = u256.fromU64(2);
const STATUS_PENDING_UNSTAKE: u256 = u256.fromU64(3);

// ── Protocol constants ────────────────────────────────────────────────────────

const MIN_STAKE_PERIOD: u64 = 144;
const MAX_OUTPUTS_SCAN: i32 = 20;
const MIN_STAKE_SATS:  u256 = u256.fromU64(100_000);

// Storage pointers for NFT integration
const PTR_NFT_ADDRESS:   u16 = 50;  // Stored NFT contract address
const PTR_TOKEN_OWNER:   u16 = 51;  // tokenId → oracle address map
const PTR_ORACLE_INDEX:  u16 = 52;  // index (u256) → oracle address (for enumeration)
const PTR_ORACLE_ADDR_IDX: u16 = 53; // oracle address → index (reverse lookup)

@final
export class OracleRegistry extends OP_NET {

    // ── Storage ───────────────────────────────────────────────────────────────

    private readonly oracleCountPtr: u16     = Blockchain.nextPointer;
    private readonly oracleCount: StoredU256 = new StoredU256(this.oracleCountPtr, EMPTY_POINTER);

    private readonly statusMap:        AddressMemoryMap = new AddressMemoryMap(Blockchain.nextPointer);
    private readonly stakeMap:         AddressMemoryMap = new AddressMemoryMap(Blockchain.nextPointer);
    private readonly registerBlockMap: AddressMemoryMap = new AddressMemoryMap(Blockchain.nextPointer);
    private readonly pubKeyLowMap:     AddressMemoryMap = new AddressMemoryMap(Blockchain.nextPointer);
    private readonly pubKeyHighMap:    AddressMemoryMap = new AddressMemoryMap(Blockchain.nextPointer);
    private readonly slashCountMap:    AddressMemoryMap = new AddressMemoryMap(Blockchain.nextPointer);

    // NFT integration — v4
    private readonly nftAddressStorage: StoredAddress     = new StoredAddress(PTR_NFT_ADDRESS);
    private readonly tokenToOracle:     AddressMemoryMap  = new AddressMemoryMap(PTR_TOKEN_OWNER);

    // Oracle enumeration (for dashboard)
    private readonly oracleByIndex:     AddressMemoryMap  = new AddressMemoryMap(PTR_ORACLE_INDEX);
    private readonly oracleIndexOf:     AddressMemoryMap  = new AddressMemoryMap(PTR_ORACLE_ADDR_IDX);

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor() {
        super();
    }

    public override onDeployment(_calldata: Calldata): void {
        // Nothing to initialise on deploy
    }

    // ── Entrypoint ────────────────────────────────────────────────────────────

    public override execute(method: Selector, calldata: Calldata): BytesWriter {
        switch (method) {
            case encodeSelector('registerOracle(u256,u256,u256)'):
                return this.registerOracle(calldata);
            case encodeSelector('setNFTAddress(address)'):
                return this.setNFTAddress(calldata);
            case encodeSelector('registerNode(uint256,uint256)'):
                return this.registerNode(calldata);
            case encodeSelector('getNFTAddress()'):
                return this.getNFTAddress(calldata);
            case encodeSelector('requestUnstake()'):
                return this.requestUnstake(calldata);
            case encodeSelector('publishFraudProof(address,u256,u256,u256,bytes,bytes,bytes)'):
                return this.publishFraudProof(calldata);
            case encodeSelector('isActive(address)'):
                return this.isActive(calldata);
            case encodeSelector('getStake(address)'):
                return this.getStake(calldata);
            case encodeSelector('isSlashed(address)'):
                return this.isSlashed(calldata);
            case encodeSelector('getPubKey(address)'):
                return this.getPubKey(calldata);
            case encodeSelector('getOracleCount()'):
                return this.getOracleCount(calldata);
            case encodeSelector('getOracleAtIndex(uint256)'):
                return this.getOracleAtIndex(calldata);
            case encodeSelector('getOracleInfo(address)'):
                return this.getOracleInfo(calldata);
            default:
                return super.execute(method, calldata);
        }
    }

    // ── Write methods ─────────────────────────────────────────────────────────

    @method(
        { name: 'pubKeyLow',   type: ABIDataTypes.UINT256 },
        { name: 'pubKeyHigh',  type: ABIDataTypes.UINT256 },
        { name: 'stakeAmount', type: ABIDataTypes.UINT256 },
    )
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    @emit('OracleRegistered')
    public registerOracle(calldata: Calldata): BytesWriter {
        const caller = Blockchain.tx.sender;

        const currentStatus = this.statusMap.get(caller);
        if (u256.eq(currentStatus, STATUS_ACTIVE)) {
            throw new Revert('Oracle already registered');
        }
        if (u256.eq(currentStatus, STATUS_SLASHED)) {
            throw new Revert('Slashed oracle cannot re-register');
        }

        const pubKeyLow:   u256 = calldata.readU256();
        const pubKeyHigh:  u256 = calldata.readU256();
        const stakeAmount: u256 = calldata.readU256();

        if (u256.lt(stakeAmount, MIN_STAKE_SATS)) {
            throw new Revert('Stake below minimum (100000 sats)');
        }

        this.verifyStakeOutput(stakeAmount);

        this.pubKeyLowMap.set(caller, pubKeyLow);
        this.pubKeyHighMap.set(caller, pubKeyHigh);
        this.stakeMap.set(caller, stakeAmount);
        this.statusMap.set(caller, STATUS_ACTIVE);
        this.registerBlockMap.set(caller, u256.fromU64(Blockchain.block.number));
        this.oracleCount.value = SafeMath.add(this.oracleCount.value, u256.One);
        this._indexOracle(caller, this.oracleCount.value);

        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    /**
     * addOracle — deployer-only, registers an oracle without requiring stake output.
     * For bootstrapping and testing. Sets stake to MIN_STAKE_SATS.
     */
    @method(
        { name: 'oracle',      type: ABIDataTypes.ADDRESS },
        { name: 'pubKeyLow',   type: ABIDataTypes.UINT256 },
        { name: 'pubKeyHigh',  type: ABIDataTypes.UINT256 },
    )
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    @emit('OracleRegistered')
    public addOracle(calldata: Calldata): BytesWriter {
        if (!Blockchain.tx.sender.equals(this.contractDeployer)) {
            throw new Revert('Only deployer');
        }

        const oracle:     Address = calldata.readAddress();
        const pubKeyLow:  u256    = calldata.readU256();
        const pubKeyHigh: u256    = calldata.readU256();

        const currentStatus = this.statusMap.get(oracle);
        if (u256.eq(currentStatus, STATUS_ACTIVE)) {
            throw new Revert('Oracle already registered');
        }

        this.pubKeyLowMap.set(oracle, pubKeyLow);
        this.pubKeyHighMap.set(oracle, pubKeyHigh);
        this.stakeMap.set(oracle, MIN_STAKE_SATS);
        this.statusMap.set(oracle, STATUS_ACTIVE);
        this.registerBlockMap.set(oracle, u256.fromU64(Blockchain.block.number));
        this.oracleCount.value = SafeMath.add(this.oracleCount.value, u256.One);
        this._indexOracle(oracle, this.oracleCount.value);

        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    // ── NFT integration — v4 ──────────────────────────────────────────────────

    /**
     * setNFTAddress — deployer-only, sets the OracleNodeNFT contract address.
     * Must be called once after both contracts are deployed.
     */
    @method({ name: 'nftAddress', type: ABIDataTypes.ADDRESS })
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public setNFTAddress(calldata: Calldata): BytesWriter {
        if (!Blockchain.tx.sender.equals(this.contractDeployer)) {
            throw new Revert('Only deployer');
        }
        const nftAddr: Address = calldata.readAddress();
        this.nftAddressStorage.value = nftAddr;

        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    /**
     * registerNode — anyone holding an OracleNodeNFT can register their oracle.
     * Verifies NFT ownership via cross-contract call to ownerOf(tokenId).
     * Registers caller as oracle with the provided Schnorr pubkey.
     */
    @method(
        { name: 'tokenId',      type: ABIDataTypes.UINT256 },
        { name: 'schnorrPubKey', type: ABIDataTypes.UINT256 },
    )
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    @emit('OracleRegistered')
    public registerNode(calldata: Calldata): BytesWriter {
        const nftAddr = this.nftAddressStorage.value;
        if (nftAddr.isZero()) {
            throw new Revert('NFT address not set');
        }

        const tokenId:      u256 = calldata.readU256();
        const schnorrPubKey: u256 = calldata.readU256();
        const caller: Address    = Blockchain.tx.sender;

        // Cross-contract call: ownerOf(tokenId)
        const ownerCalldata = new BytesWriter(4 + 32);
        ownerCalldata.writeSelector(encodeSelector('ownerOf(uint256)'));
        ownerCalldata.writeU256(tokenId);

        const result = Blockchain.call(nftAddr, ownerCalldata);
        if (!result.success) {
            throw new Revert('ownerOf call failed');
        }

        // ownerOf returns a 30-byte address
        const owner: Address = result.data.readAddress();
        if (!owner.equals(caller)) {
            throw new Revert('Caller is not NFT owner');
        }

        // Check not already registered with this token
        const existingOracle = this.tokenToOracle.get(this._addressFromU256(tokenId));
        if (!existingOracle.isZero()) {
            throw new Revert('Token already used to register an oracle');
        }

        // Check oracle status
        const currentStatus = this.statusMap.get(caller);
        if (u256.eq(currentStatus, STATUS_SLASHED)) {
            throw new Revert('Slashed oracle cannot re-register');
        }
        if (u256.eq(currentStatus, STATUS_ACTIVE)) {
            throw new Revert('Oracle already registered — use updateOracleKey to change key');
        }

        // Store pubkey (schnorrPubKey goes in pubKeyLow, pubKeyHigh = 0 for Schnorr)
        this.pubKeyLowMap.set(caller, schnorrPubKey);
        this.pubKeyHighMap.set(caller, u256.Zero);
        this.stakeMap.set(caller, MIN_STAKE_SATS);
        this.statusMap.set(caller, STATUS_ACTIVE);
        this.registerBlockMap.set(caller, u256.fromU64(Blockchain.block.number));
        this.tokenToOracle.set(this._addressFromU256(tokenId), u256.One); // mark token as used

        if (!u256.eq(currentStatus, STATUS_ACTIVE)) {
            this.oracleCount.value = SafeMath.add(this.oracleCount.value, u256.One);
            this._indexOracle(caller, this.oracleCount.value);
        }

        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    /**
     * getNFTAddress — returns the configured NFT contract address.
     */
    @method()
    @returns({ name: 'nftAddress', type: ABIDataTypes.ADDRESS })
    public getNFTAddress(_calldata: Calldata): BytesWriter {
        const w = new BytesWriter(32);
        w.writeAddress(this.nftAddressStorage.value);
        return w;
    }

    // ─────────────────────────────────────────────────────────────────────────

    @method()
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    @emit('UnstakeRequested')
    public requestUnstake(_calldata: Calldata): BytesWriter {
        const caller = Blockchain.tx.sender;
        const status = this.statusMap.get(caller);

        if (!u256.eq(status, STATUS_ACTIVE)) {
            throw new Revert('Oracle not active');
        }

        const registeredAt:  u256 = this.registerBlockMap.get(caller);
        const blocksSince:   u64  = Blockchain.block.number - registeredAt.toU64();
        if (blocksSince < MIN_STAKE_PERIOD) {
            throw new Revert('Min stake period not elapsed');
        }

        this.statusMap.set(caller, STATUS_PENDING_UNSTAKE);

        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    @method(
        { name: 'oracleAddress', type: ABIDataTypes.ADDRESS },
        { name: 'price1',        type: ABIDataTypes.UINT256 },
        { name: 'price2',        type: ABIDataTypes.UINT256 },
        { name: 'blockNum',      type: ABIDataTypes.UINT256 },
        { name: 'sig1',          type: ABIDataTypes.BYTES },
        { name: 'sig2',          type: ABIDataTypes.BYTES },
        { name: 'asset',         type: ABIDataTypes.BYTES },
    )
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    @emit('OracleSlashed')
    public publishFraudProof(calldata: Calldata): BytesWriter {
        const oracleAddr: Address    = calldata.readAddress();
        const price1:     u256       = calldata.readU256();
        const price2:     u256       = calldata.readU256();
        const blockNum:   u256       = calldata.readU256();
        const sig1Len:    u32        = calldata.readU32();
        const sig1:       Uint8Array = calldata.readBytes(sig1Len, true);
        const sig2Len:    u32        = calldata.readU32();
        const sig2:       Uint8Array = calldata.readBytes(sig2Len, true);
        const assetLen:   u32        = calldata.readU32();
        const assetBytes: Uint8Array = calldata.readBytes(assetLen, true);

        const status = this.statusMap.get(oracleAddr);
        if (!u256.eq(status, STATUS_ACTIVE) && !u256.eq(status, STATUS_PENDING_UNSTAKE)) {
            throw new Revert('Oracle not active');
        }
        if (u256.eq(price1, price2)) {
            throw new Revert('Prices identical — not a fraud proof');
        }

        const pubLow  = this.pubKeyLowMap.get(oracleAddr);
        const pubHigh = this.pubKeyHighMap.get(oracleAddr);
        const extAddr = this.buildExtendedAddress(pubLow, pubHigh);
        const hash1   = this.buildMessageHash(assetBytes, price1, blockNum);
        const hash2   = this.buildMessageHash(assetBytes, price2, blockNum);

        if (!Blockchain.verifySignature(extAddr, sig1, hash1)) {
            throw new Revert('Signature 1 invalid');
        }
        if (!Blockchain.verifySignature(extAddr, sig2, hash2)) {
            throw new Revert('Signature 2 invalid');
        }

        this.statusMap.set(oracleAddr, STATUS_SLASHED);
        this.slashCountMap.set(oracleAddr, SafeMath.add(this.slashCountMap.get(oracleAddr), u256.One));

        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    // ── View methods ──────────────────────────────────────────────────────────

    @method({ name: 'oracleAddress', type: ABIDataTypes.ADDRESS })
    @returns({ name: 'active', type: ABIDataTypes.BOOL })
    public isActive(calldata: Calldata): BytesWriter {
        const addr = calldata.readAddress();
        const w = new BytesWriter(1);
        w.writeBoolean(u256.eq(this.statusMap.get(addr), STATUS_ACTIVE));
        return w;
    }

    @method({ name: 'oracleAddress', type: ABIDataTypes.ADDRESS })
    @returns({ name: 'stake', type: ABIDataTypes.UINT256 })
    public getStake(calldata: Calldata): BytesWriter {
        const addr = calldata.readAddress();
        const w = new BytesWriter(32);
        w.writeU256(this.stakeMap.get(addr));
        return w;
    }

    @method({ name: 'oracleAddress', type: ABIDataTypes.ADDRESS })
    @returns({ name: 'slashed', type: ABIDataTypes.BOOL })
    public isSlashed(calldata: Calldata): BytesWriter {
        const addr = calldata.readAddress();
        const w = new BytesWriter(1);
        w.writeBoolean(u256.eq(this.statusMap.get(addr), STATUS_SLASHED));
        return w;
    }

    @method({ name: 'oracleAddress', type: ABIDataTypes.ADDRESS })
    @returns({ name: 'pubKeyLow', type: ABIDataTypes.UINT256 })
    public getPubKey(calldata: Calldata): BytesWriter {
        const addr = calldata.readAddress();
        const w = new BytesWriter(64);
        w.writeU256(this.pubKeyLowMap.get(addr));
        w.writeU256(this.pubKeyHighMap.get(addr));
        return w;
    }

    // ── Dashboard view methods ────────────────────────────────────────────────

    /**
     * getOracleCount() — total number of registered oracles
     */
    @method()
    @returns({ name: 'count', type: ABIDataTypes.UINT256 })
    public getOracleCount(_calldata: Calldata): BytesWriter {
        const w = new BytesWriter(32);
        w.writeU256(this.oracleCount.value);
        return w;
    }

    /**
     * getOracleAtIndex(index) — get oracle address at position `index` (1-based)
     */
    @method({ name: 'index', type: ABIDataTypes.UINT256 })
    @returns({ name: 'oracleAddress', type: ABIDataTypes.ADDRESS })
    public getOracleAtIndex(calldata: Calldata): BytesWriter {
        const index    = calldata.readU256();
        const addrU256 = this.oracleByIndex.get(this._addressFromU256(index));
        const addr     = this._addressFromU256(addrU256);
        const w = new BytesWriter(32);
        w.writeAddress(addr);
        return w;
    }

    /**
     * getOracleInfo(address) — returns (status, pubKeyLow, registerBlock, slashCount)
     * For dashboard display
     */
    @method({ name: 'oracleAddress', type: ABIDataTypes.ADDRESS })
    public getOracleInfo(calldata: Calldata): BytesWriter {
        const addr      = calldata.readAddress();
        const status    = this.statusMap.get(addr);
        const pubKeyLow = this.pubKeyLowMap.get(addr);
        const regBlock  = this.registerBlockMap.get(addr);
        const slashes   = this.slashCountMap.get(addr);
        const stake     = this.stakeMap.get(addr);

        const w = new BytesWriter(32 * 5);
        w.writeU256(status);
        w.writeU256(pubKeyLow);
        w.writeU256(regBlock);
        w.writeU256(slashes);
        w.writeU256(stake);
        return w;
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    private _indexOracle(addr: Address, index: u256): void {
        // oracleByIndex: uses index (as Address-key via _addressFromU256) → addrU256
        this.oracleByIndex.set(this._addressFromU256(index), u256.fromUint8ArrayBE(addr));
        // oracleIndexOf: oracle address → its index
        this.oracleIndexOf.set(addr, index);
    }

    private _addressFromU256(val: u256): Address {
        const bytes = val.toUint8Array(true);
        const addr: u8[] = [];
        // Address is 30 bytes — take last 30 bytes
        const start = bytes.length > 30 ? bytes.length - 30 : 0;
        for (let i: i32 = start; i < bytes.length; i++) addr.push(bytes[i]);
        while (addr.length < 30) addr.unshift(0);
        return new Address(addr);
    }

    private buildExtendedAddress(pubLow: u256, pubHigh: u256): ExtendedAddress {
        const tweakedBytes = pubLow.toUint8Array(true);
        const mldsaBytes   = pubHigh.toUint8Array(true);
        const tweaked: u8[] = [];
        const mldsa:   u8[] = [];
        for (let i: i32 = 0; i < tweakedBytes.length; i++) tweaked.push(tweakedBytes[i]);
        for (let i: i32 = 0; i < mldsaBytes.length;   i++) mldsa.push(mldsaBytes[i]);
        return new ExtendedAddress(tweaked, mldsa);
    }

    /**
     * Verify stake output: tx must contain an output ≥ stakeAmount sats
     * to a NON-self address (prevent self-send bypass).
     * The output must go to a different address than tx.sender.
     */
    private verifyStakeOutput(stakeAmount: u256): void {
        const outputs        = Blockchain.tx.outputs;
        const stakeAmountU64 = stakeAmount.toU64();
        let found            = false;
        const limit: i32     = outputs.length < MAX_OUTPUTS_SCAN ? outputs.length : MAX_OUTPUTS_SCAN;
        const senderStr      = Blockchain.tx.sender.toString();

        for (let i: i32 = 0; i < limit; i++) {
            const out = outputs[i];
            // Must be ≥ stake amount, have a destination, and not be back to sender
            if (out.value >= stakeAmountU64 && out.to !== null && out.to !== senderStr) {
                found = true;
                break;
            }
        }
        if (!found) throw new Revert('Stake output must send to external address with sufficient value');
    }

    /**
     * sha256(asset_utf8 || price_u64be || blockNumber_u64be)
     * Must match OracleSigner.buildMessage() in the TypeScript node exactly.
     */
    private buildMessageHash(assetBytes: Uint8Array, price: u256, blockNumber: u256): Uint8Array {
        const pU64  = price.toU64();
        const bU64  = blockNumber.toU64();
        const pre   = new Uint8Array(assetBytes.length + 16);

        for (let i: i32 = 0; i < assetBytes.length; i++) pre[i] = assetBytes[i];

        const o: i32 = assetBytes.length;
        pre[o]     = u8((pU64 >> 56) & 0xff); pre[o+1]  = u8((pU64 >> 48) & 0xff);
        pre[o+2]   = u8((pU64 >> 40) & 0xff); pre[o+3]  = u8((pU64 >> 32) & 0xff);
        pre[o+4]   = u8((pU64 >> 24) & 0xff); pre[o+5]  = u8((pU64 >> 16) & 0xff);
        pre[o+6]   = u8((pU64 >>  8) & 0xff); pre[o+7]  = u8( pU64        & 0xff);
        pre[o+8]   = u8((bU64 >> 56) & 0xff); pre[o+9]  = u8((bU64 >> 48) & 0xff);
        pre[o+10]  = u8((bU64 >> 40) & 0xff); pre[o+11] = u8((bU64 >> 32) & 0xff);
        pre[o+12]  = u8((bU64 >> 24) & 0xff); pre[o+13] = u8((bU64 >> 16) & 0xff);
        pre[o+14]  = u8((bU64 >>  8) & 0xff); pre[o+15] = u8( bU64        & 0xff);

        return Blockchain.sha256(pre);
    }
}
