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
export type VerifyAndGetPrice = CallResult<
    {
        price: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the verifyAndGetPriceQuorum function call.
 */
export type VerifyAndGetPriceQuorum = CallResult<
    {
        price: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the setRegistry function call.
 */
export type SetRegistry = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

// ------------------------------------------------------------------
// IPriceFeedPull
// ------------------------------------------------------------------
export interface IPriceFeedPull extends IOP_NETContract {
    verifyAndGetPrice(
        asset: Uint8Array,
        price: bigint,
        blockNum: bigint,
        oracleAddr: Address,
        signature: Uint8Array,
    ): Promise<VerifyAndGetPrice>;
    verifyAndGetPriceQuorum(
        asset: Uint8Array,
        price: bigint,
        blockNum: bigint,
        oracles: Address,
        sigs: Uint8Array,
    ): Promise<VerifyAndGetPriceQuorum>;
    setRegistry(registry: Address): Promise<SetRegistry>;
}
