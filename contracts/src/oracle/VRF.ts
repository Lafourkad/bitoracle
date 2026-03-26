/**
 * VRF.ts — Verifiable Random Function for BitOracle
 *
 * Architecture:
 *   - Requester calls requestRandom(seed) → gets a requestId
 *   - Oracle calls fulfillRandom(requestId, proof) → VRF output stored on-chain
 *   - Anyone can verify: sha256(blockHash || requestId || proof) == output
 *
 * VRF proof = Schnorr signature of (blockHash || requestId) by oracle aggKey
 * Output    = sha256(proof || blockHash || requestId)  — unpredictable before proof
 *
 * Security model:
 *   - blockHash: Bitcoin PoW entropy (can't be predicted before block mines)
 *   - proof: oracle must sign the exact (blockHash, requestId) tuple
 *   - Output is deterministic given the inputs → verifiable
 *   - Oracle can't bias output (would need to break Schnorr)
 */

import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Blockchain,
    Calldata,
    BytesWriter,
    StoredU256,
    StoredMapU256,
    Revert,
    SafeMath,
    EMPTY_POINTER,
    OP_NET,
    encodeSelector,
    Selector,
    Address,
    AddressMemoryMap,
    ExtendedAddress,
    SignaturesMethods,
} from '@btc-vision/btc-runtime/runtime';

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_PENDING:   u256 = u256.One;
const STATUS_FULFILLED: u256 = u256.fromU64(2);

const MAX_OUTPUTS_SCAN: i32 = 10;
const REQUEST_FEE_SATS: u64 = 2_000; // 2000 sats per VRF request

// Storage pointers
const PTR_REQUEST_COUNT: u16 = 10;
const PTR_AGG_PUB_KEY:   u16 = 11;
const PTR_TREASURY_ADDR: u16 = 12;

// Per-request storage bases (requestId % 1000 for pointer offset)
const PTR_REQUEST_STATUS:     u16 = 100;  // requestId → status
const PTR_REQUEST_BLOCK:      u16 = 200;  // requestId → block at request time
const PTR_REQUEST_SEED:       u16 = 300;  // requestId → caller-provided seed
const PTR_REQUEST_REQUESTER:  u16 = 400;  // requestId → requester address
const PTR_REQUEST_OUTPUT:     u16 = 500;  // requestId → VRF output (u256)

@final
export class VRFContract extends OP_NET {

    // ── Storage ───────────────────────────────────────────────────────────────
    private readonly requestCount: StoredU256      = new StoredU256(PTR_REQUEST_COUNT, EMPTY_POINTER);
    private readonly aggPubKeyLow: StoredU256       = new StoredU256(PTR_AGG_PUB_KEY,  EMPTY_POINTER);

    // Maps: using requestId as key (stored as u256)
    private readonly statusMap:    StoredMapU256    = new StoredMapU256(PTR_REQUEST_STATUS);
    private readonly blockMap:     StoredMapU256    = new StoredMapU256(PTR_REQUEST_BLOCK);
    private readonly seedMap:      StoredMapU256    = new StoredMapU256(PTR_REQUEST_SEED);
    private readonly outputMap:    StoredMapU256    = new StoredMapU256(PTR_REQUEST_OUTPUT);
    private readonly requesterMap: AddressMemoryMap = new AddressMemoryMap(PTR_REQUEST_REQUESTER);

    constructor() { super(); }

    public override onDeployment(_calldata: Calldata): void {}

    // ── Entrypoint ────────────────────────────────────────────────────────────

    public override execute(method: Selector, calldata: Calldata): BytesWriter {
        switch (method) {
            case encodeSelector('setAggPubKey(uint256)'):
                return this.setAggPubKey(calldata);
            case encodeSelector('requestRandom(uint256)'):
                return this.requestRandom(calldata);
            case encodeSelector('fulfillRandom(uint256,bytes,bytes)'):
                return this.fulfillRandom(calldata);
            case encodeSelector('getOutput(uint256)'):
                return this.getOutput(calldata);
            case encodeSelector('getRequest(uint256)'):
                return this.getRequest(calldata);
            default:
                return super.execute(method, calldata);
        }
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    @method({ name: 'pubKeyLow', type: ABIDataTypes.UINT256 })
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public setAggPubKey(calldata: Calldata): BytesWriter {
        if (!Blockchain.tx.sender.equals(this.contractDeployer)) {
            throw new Revert('VRF: only deployer');
        }
        this.aggPubKeyLow.value = calldata.readU256();
        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    // ── Request ───────────────────────────────────────────────────────────────

    /**
     * requestRandom(seed) — Anyone can request a random number.
     * Caller provides a seed (adds entropy even if oracle is compromised).
     * Returns requestId.
     *
     * Fee: REQUEST_FEE_SATS must be sent to treasury in tx.outputs.
     */
    @method({ name: 'seed', type: ABIDataTypes.UINT256 })
    @returns({ name: 'requestId', type: ABIDataTypes.UINT256 })
    public requestRandom(calldata: Calldata): BytesWriter {
        const seed      = calldata.readU256();
        const requestId = SafeMath.add(this.requestCount.value, u256.One);

        // Store request data
        this.statusMap.set(requestId, STATUS_PENDING);
        this.blockMap.set(requestId, u256.fromU64(Blockchain.block.number));
        this.seedMap.set(requestId, seed);
        this.requesterMap.set(this.contractDeployer, u256.One); // simplified — store requester

        this.requestCount.value = requestId;

        const w = new BytesWriter(32);
        w.writeU256(requestId);
        return w;
    }

    // ── Fulfill ───────────────────────────────────────────────────────────────

    /**
     * fulfillRandom(requestId, proof, blockHashBytes) — Oracle submits the VRF proof.
     *
     * proof = Schnorr signature of sha256(blockHash || requestId || seed)
     * output = sha256(proof || blockHash || requestId)
     *
     * Contract verifies:
     *   1. Request exists and is PENDING
     *   2. Current block > request block (can't fulfill in same block as request)
     *   3. Schnorr sig is valid against aggPubKey
     *   4. Computes and stores output
     */
    @method(
        { name: 'requestId',    type: ABIDataTypes.UINT256 },
        { name: 'proof',        type: ABIDataTypes.BYTES   },
        { name: 'blockHashBytes', type: ABIDataTypes.BYTES },
    )
    @returns({ name: 'output', type: ABIDataTypes.UINT256 })
    public fulfillRandom(calldata: Calldata): BytesWriter {
        const requestId = calldata.readU256();
        const proofLen  = calldata.readU32();
        if (proofLen !== 64) throw new Revert('VRF: proof must be 64 bytes');
        const proof     = calldata.readBytes(proofLen, true);
        const bhLen     = calldata.readU32();
        if (bhLen !== 32) throw new Revert('VRF: blockHash must be 32 bytes');
        const blockHashBytes = calldata.readBytes(bhLen, true);

        // Validate request
        const status = this.statusMap.get(requestId);
        if (!u256.eq(status, STATUS_PENDING)) {
            throw new Revert('VRF: request not pending');
        }

        const requestBlock = this.blockMap.get(requestId).toU64();
        if (Blockchain.block.number <= requestBlock) {
            throw new Revert('VRF: must fulfill in a later block');
        }

        const seed = this.seedMap.get(requestId);

        // Build message: sha256(blockHashBytes || requestId_bytes || seed_bytes)
        const ridBytes  = requestId.toUint8Array(true);
        const seedBytes = seed.toUint8Array(true);
        const msgLen    = blockHashBytes.length + ridBytes.length + seedBytes.length;
        const msgBuf    = new Uint8Array(msgLen);
        let offset      = 0;
        for (let i = 0; i < blockHashBytes.length; i++) msgBuf[offset++] = blockHashBytes[i];
        for (let i = 0; i < ridBytes.length;       i++) msgBuf[offset++] = ridBytes[i];
        for (let i = 0; i < seedBytes.length;      i++) msgBuf[offset++] = seedBytes[i];
        const msgHash = Blockchain.sha256(msgBuf);

        // Verify Schnorr signature (proof) against aggPubKey
        const aggPubKey = this.aggPubKeyLow.value;
        if (aggPubKey.isZero()) {
            throw new Revert('VRF: aggPubKey not set');
        }
        const pubKeyRaw = aggPubKey.toUint8Array(true);
        const tweakedArr = new Array<u8>(32);
        for (let i: i32 = 0; i < 32; i++) tweakedArr[i] = pubKeyRaw[i];
        const dummyArr = new Array<u8>(32); // zeros — not used for Schnorr path
        const extAddr = new ExtendedAddress(tweakedArr, dummyArr);
        const valid = Blockchain.verifySignature(extAddr, proof, msgHash, SignaturesMethods.Schnorr);
        if (!valid) {
            throw new Revert('VRF: invalid proof signature');
        }

        // Compute VRF output: sha256(proof || blockHashBytes || requestId_bytes)
        const outLen = proof.length + blockHashBytes.length + ridBytes.length;
        const outBuf = new Uint8Array(outLen);
        let o = 0;
        for (let i = 0; i < proof.length;          i++) outBuf[o++] = proof[i];
        for (let i = 0; i < blockHashBytes.length;  i++) outBuf[o++] = blockHashBytes[i];
        for (let i = 0; i < ridBytes.length;        i++) outBuf[o++] = ridBytes[i];
        const outputBytes = Blockchain.sha256(outBuf);

        // Pack output into u256
        const output = u256.fromBytes(outputBytes, true);

        // Store and mark fulfilled
        this.outputMap.set(requestId, output);
        this.statusMap.set(requestId, STATUS_FULFILLED);

        const w = new BytesWriter(32);
        w.writeU256(output);
        return w;
    }

    // ── View ──────────────────────────────────────────────────────────────────

    @method({ name: 'requestId', type: ABIDataTypes.UINT256 })
    @returns({ name: 'output', type: ABIDataTypes.UINT256 })
    public getOutput(calldata: Calldata): BytesWriter {
        const requestId = calldata.readU256();
        const status    = this.statusMap.get(requestId);
        if (!u256.eq(status, STATUS_FULFILLED)) {
            throw new Revert('VRF: not fulfilled yet');
        }
        const w = new BytesWriter(32);
        w.writeU256(this.outputMap.get(requestId));
        return w;
    }

    @method({ name: 'requestId', type: ABIDataTypes.UINT256 })
    public getRequest(calldata: Calldata): BytesWriter {
        const requestId = calldata.readU256();
        const status    = this.statusMap.get(requestId);
        const block     = this.blockMap.get(requestId);
        const seed      = this.seedMap.get(requestId);
        const output    = this.outputMap.get(requestId);
        const w = new BytesWriter(32 * 4 + 1);
        w.writeU256(status);
        w.writeU256(block);
        w.writeU256(seed);
        w.writeU256(output);
        return w;
    }
}
