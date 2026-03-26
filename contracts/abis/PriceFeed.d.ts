import { Address, AddressMap, ExtendedAddressMap, SchnorrSignature } from '@btc-vision/transaction';
import { CallResult, OPNetEvent, IOP_NETContract } from 'opnet';

// ------------------------------------------------------------------
// Event Definitions
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Call Results
// ------------------------------------------------------------------

/**
 * @description Represents the result of the submitPrice function call.
 */
export type SubmitPrice = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<PriceSubmittedEvent>[]
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

/**
 * @description Represents the result of the getPrice function call.
 */
export type GetPrice = CallResult<
    {
        price: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getLatestBlock function call.
 */
export type GetLatestBlock = CallResult<
    {
        blockNumber: bigint;
    },
    OPNetEvent<never>[]
>;

// ------------------------------------------------------------------
// IPriceFeed
// ------------------------------------------------------------------
export interface IPriceFeed extends IOP_NETContract {
    submitPrice(asset: Uint8Array, price: bigint, blockNum: bigint, signature: Uint8Array): Promise<SubmitPrice>;
    setRegistry(oracleRegistry: Address): Promise<SetRegistry>;
    getPrice(asset: Uint8Array): Promise<GetPrice>;
    getLatestBlock(asset: Uint8Array): Promise<GetLatestBlock>;
}
