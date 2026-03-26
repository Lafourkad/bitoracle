/**
 * OracleNodeNFT — Founder Node NFT for BitOracle network (OP-721)
 *
 * 100 tokens max. Each NFT = 1 oracle node operator slot.
 * Holders earn BTC fees monthly from the oracle network treasury.
 *
 * Per-token data:
 *   - payoutAddress: Bitcoin address for fee distribution (updatable by owner)
 *   - oracleKey: Schnorr x-only pubkey used for oracle signing (updatable by owner)
 */

import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Blockchain,
    Calldata,
    BytesWriter,
    StoredU256,
    StoredString,
    Revert,
    encodeSelector,
    Selector,
    EMPTY_POINTER,
    Address,
} from '@btc-vision/btc-runtime/runtime';
import { OP721 } from '@btc-vision/btc-runtime/runtime/contracts/OP721';
import { OP721InitParameters } from '@btc-vision/btc-runtime/runtime/contracts/interfaces/OP721InitParameters';
// ABIDataTypes injected globally by @btc-vision/opnet-transform

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_SUPPLY: u256 = u256.fromU32(100);
const MINT_PRICE: u64  = 5_000; // sats testnet (mainnet: 5_000_000)

// Storage pointer bases (each token uses ptr_base + tokenId)
const PTR_MINT_PRICE:        u16 = 150;
const PTR_TREASURY_ADDR:     u16 = 151; // treasury BTC address (set by deployer)
const PTR_ORACLE_KEY_BASE:   u16 = 200; // 200..299: schnorrPubKey per token
const PTR_PAYOUT_ADDR_BASE:  u16 = 300; // 300..399: btcPayoutAddress per token

// Max outputs to scan for fee verification
const MAX_OUTPUTS_SCAN: i32 = 20;

// ── Contract ──────────────────────────────────────────────────────────────────

@final
export class OracleNodeNFT extends OP721 {

    private readonly mintPriceStorage:   StoredU256  = new StoredU256(PTR_MINT_PRICE, EMPTY_POINTER);
    private readonly treasuryAddrStorage: StoredString = new StoredString(PTR_TREASURY_ADDR, 0);

    constructor() {
        super();
    }

    public override onDeployment(_calldata: Calldata): void {
        const params = new OP721InitParameters(
            'OracleNodeNFT',
            'BITO',
            'https://bitoracle.xyz/metadata/',
            MAX_SUPPLY,
            '',
            '',
            'https://bitoracle.xyz',
            'BitOracle Founder Node — earn BTC fees by operating an oracle node',
        );
        this.instantiate(params, true);
        this.mintPriceStorage.value = u256.fromU64(MINT_PRICE);
    }

    public override execute(method: Selector, calldata: Calldata): BytesWriter {
        switch (method) {
            case encodeSelector('adminMint(address)'):
                return this.adminMint(calldata);
            case encodeSelector('mint(address)'):
                return this.mint(calldata);
            case encodeSelector('setPayoutAddress(uint256,string)'):
                return this.setPayoutAddress(calldata);
            case encodeSelector('getPayoutAddress(uint256)'):
                return this.getPayoutAddress(calldata);
            case encodeSelector('setOracleKey(uint256,uint256)'):
                return this.setOracleKey(calldata);
            case encodeSelector('getOracleKey(uint256)'):
                return this.getOracleKey(calldata);
            case encodeSelector('setMintPrice(uint256)'):
                return this.setMintPrice(calldata);
            case encodeSelector('getMintPrice()'):
                return this.getMintPrice();
            case encodeSelector('setTreasuryAddress(string)'):
                return this.setTreasuryAddress(calldata);
            case encodeSelector('getTreasuryAddress()'):
                return this.getTreasuryAddress();
            default:
                return super.execute(method, calldata);
        }
    }

    // ── Admin mint (free, deployer only) ─────────────────────────────────────

    @method(
        { name: 'to', type: ABIDataTypes.ADDRESS },
    )
    private adminMint(calldata: Calldata): BytesWriter {
        this.checkDeployer();
        const to      = calldata.readAddress();
        const tokenId = this._nextTokenId.value;

        if (u256.ge(this._totalSupply.value, this._maxSupply.value)) {
            throw new Revert('OracleNodeNFT: max supply reached');
        }

        this._mint(to, tokenId);

        const writer = new BytesWriter(32);
        writer.writeU256(tokenId);
        return writer;
    }

    // ── Public mint (anyone can mint) ────────────────────────────────────────

    @method(
        { name: 'to', type: ABIDataTypes.ADDRESS },
    )
    private mint(calldata: Calldata): BytesWriter {
        const to      = calldata.readAddress();
        const tokenId = this._nextTokenId.value;

        if (u256.ge(this._totalSupply.value, this._maxSupply.value)) {
            throw new Revert('OracleNodeNFT: max supply reached');
        }

        // Verify mint fee sent to treasury (skip if treasury not configured yet)
        const treasury = this.treasuryAddrStorage.value;
        if (treasury.length > 0) {
            const price = this.mintPriceStorage.value.toU64();
            this.verifyFeeOutput(treasury, price);
        }

        this._mint(to, tokenId);

        const writer = new BytesWriter(32);
        writer.writeU256(tokenId);
        return writer;
    }

    // ── Payout address ────────────────────────────────────────────────────────

    @method(
        { name: 'tokenId',    type: ABIDataTypes.UINT256 },
        { name: 'btcAddress', type: ABIDataTypes.STRING  },
    )
    private setPayoutAddress(calldata: Calldata): BytesWriter {
        const tokenId    = calldata.readU256();
        const btcAddress = calldata.readStringWithLength();
        this.onlyTokenOwner(tokenId); // also validates existence
        // Bounds check: tokenId must be within valid storage range
        if (tokenId.toU32() >= 100) throw new Revert('OracleNodeNFT: tokenId out of range');

        const tid    = <u32>tokenId.toU32();
        const ptr    = <u16>(PTR_PAYOUT_ADDR_BASE + tid);
        const stored = new StoredString(ptr, 0);
        stored.value = btcAddress;

        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    @method(
        { name: 'tokenId', type: ABIDataTypes.UINT256 },
    )
    private getPayoutAddress(calldata: Calldata): BytesWriter {
        const tokenId = calldata.readU256();
        const ptr     = <u16>(PTR_PAYOUT_ADDR_BASE + tokenId.toU32());
        const stored  = new StoredString(ptr, 0);
        const addr    = stored.value;

        const writer  = new BytesWriter(4 + addr.length);
        writer.writeStringWithLength(addr);
        return writer;
    }

    // ── Oracle key ────────────────────────────────────────────────────────────

    @method(
        { name: 'tokenId',       type: ABIDataTypes.UINT256 },
        { name: 'schnorrPubKey', type: ABIDataTypes.UINT256 },
    )
    private setOracleKey(calldata: Calldata): BytesWriter {
        const tokenId       = calldata.readU256();
        const schnorrPubKey = calldata.readU256();
        this.onlyTokenOwner(tokenId); // also validates existence
        // Bounds check: tokenId must be within valid storage range
        if (tokenId.toU32() >= 100) throw new Revert('OracleNodeNFT: tokenId out of range');
        // Key must not be zero
        if (schnorrPubKey.isZero()) throw new Revert('OracleNodeNFT: oracle key cannot be zero');

        const ptr    = <u16>(PTR_ORACLE_KEY_BASE + tokenId.toU32());
        const stored = new StoredU256(ptr, EMPTY_POINTER);
        stored.value = schnorrPubKey;

        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    @method(
        { name: 'tokenId', type: ABIDataTypes.UINT256 },
    )
    private getOracleKey(calldata: Calldata): BytesWriter {
        const tokenId = calldata.readU256();
        const ptr     = <u16>(PTR_ORACLE_KEY_BASE + tokenId.toU32());
        const stored  = new StoredU256(ptr, EMPTY_POINTER);

        const writer = new BytesWriter(32);
        writer.writeU256(stored.value);
        return writer;
    }

    // ── Mint price ────────────────────────────────────────────────────────────

    @method(
        { name: 'price', type: ABIDataTypes.UINT256 },
    )
    private setMintPrice(calldata: Calldata): BytesWriter {
        this.checkDeployer();
        this.mintPriceStorage.value = calldata.readU256();
        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    private getMintPrice(): BytesWriter {
        const writer = new BytesWriter(32);
        writer.writeU256(this.mintPriceStorage.value);
        return writer;
    }

    // ── Treasury address ──────────────────────────────────────────────────────

    @method(
        { name: 'btcAddress', type: ABIDataTypes.STRING },
    )
    private setTreasuryAddress(calldata: Calldata): BytesWriter {
        this.checkDeployer();
        const addr = calldata.readStringWithLength();
        this.treasuryAddrStorage.value = addr;
        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    private getTreasuryAddress(): BytesWriter {
        const addr   = this.treasuryAddrStorage.value;
        const writer = new BytesWriter(4 + addr.length);
        writer.writeStringWithLength(addr);
        return writer;
    }

    // ── Fee verification ──────────────────────────────────────────────────────

    /**
     * Verify that the tx contains an output of at least `amount` sats to `treasuryAddr`.
     * Revert if no matching output found.
     */
    private verifyFeeOutput(treasuryAddr: string, amount: u64): void {
        const outputs = Blockchain.tx.outputs;
        const limit: i32 = outputs.length < MAX_OUTPUTS_SCAN ? outputs.length : MAX_OUTPUTS_SCAN;

        for (let i: i32 = 0; i < limit; i++) {
            const out = outputs[i];
            if (out.value >= amount && out.to !== null && out.to === treasuryAddr) {
                return; // found valid fee output
            }
        }
        throw new Revert('OracleNodeNFT: mint fee not paid to treasury');
    }

    // ── Guards ────────────────────────────────────────────────────────────────

    private checkDeployer(): void {
        this.onlyDeployer(Blockchain.tx.sender);
    }

    private onlyTokenOwner(tokenId: u256): void {
        const ownerU256 = this.ownerOfMap.get(tokenId);
        if (ownerU256.isZero()) throw new Revert('OracleNodeNFT: token does not exist');

        // Compare caller address as u256
        const callerU256 = this._u256FromAddress(Blockchain.tx.sender);
        if (!u256.eq(callerU256, ownerU256)) throw new Revert('OracleNodeNFT: not token owner');
    }
}
