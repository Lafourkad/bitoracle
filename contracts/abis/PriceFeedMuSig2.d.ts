import { Address, AddressMap, ExtendedAddressMap, SchnorrSignature } from '@btc-vision/transaction';
import { CallResult, OPNetEvent, IOP_NETContract } from 'opnet';

// ------------------------------------------------------------------
// Event Definitions
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Call Results
// ------------------------------------------------------------------

/**
 * @description Represents the result of the verifyAndGetPrice function call.
 */
export type VerifyAndGetPrice = CallResult<{}, OPNetEvent<never>[]>;

/**
 * @description Represents the result of the setAggPubKey function call.
 */
export type SetAggPubKey = CallResult<{}, OPNetEvent<never>[]>;

/**
 * @description Represents the result of the setTreasuryAddress function call.
 */
export type SetTreasuryAddress = CallResult<{}, OPNetEvent<never>[]>;

/**
 * @description Represents the result of the setFeeSats function call.
 */
export type SetFeeSats = CallResult<{}, OPNetEvent<never>[]>;

/**
 * @description Represents the result of the getTreasuryAddress function call.
 */
export type GetTreasuryAddress = CallResult<{}, OPNetEvent<never>[]>;

/**
 * @description Represents the result of the getFeeSats function call.
 */
export type GetFeeSats = CallResult<{}, OPNetEvent<never>[]>;

/**
 * @description Represents the result of the setRegistry function call.
 */
export type SetRegistry = CallResult<{}, OPNetEvent<never>[]>;

/**
 * @description Represents the result of the getAggPubKey function call.
 */
export type GetAggPubKey = CallResult<
    {
        pubKeyLow: bigint;
    },
    OPNetEvent<never>[]
>;

// ------------------------------------------------------------------
// IPriceFeedMuSig2
// ------------------------------------------------------------------
export interface IPriceFeedMuSig2 extends IOP_NETContract {
    verifyAndGetPrice(
        asset: Uint8Array,
        price: bigint,
        blockNum: bigint,
        sig: Uint8Array,
        aggPubKey: Uint8Array,
    ): Promise<VerifyAndGetPrice>;
    setAggPubKey(pubKeyLow: bigint, pubKeyHigh: bigint): Promise<SetAggPubKey>;
    setTreasuryAddress(btcAddress: string): Promise<SetTreasuryAddress>;
    setFeeSats(feeSats: bigint): Promise<SetFeeSats>;
    getTreasuryAddress(): Promise<GetTreasuryAddress>;
    getFeeSats(): Promise<GetFeeSats>;
    setRegistry(registry: Address): Promise<SetRegistry>;
    getAggPubKey(): Promise<GetAggPubKey>;
}
