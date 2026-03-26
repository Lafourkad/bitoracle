import { Address, AddressMap, ExtendedAddressMap, SchnorrSignature } from '@btc-vision/transaction';
import { CallResult, OPNetEvent, IOP_NETContract } from 'opnet';

// ------------------------------------------------------------------
// Event Definitions
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Call Results
// ------------------------------------------------------------------

/**
 * @description Represents the result of the setAggPubKey function call.
 */
export type SetAggPubKey = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the requestRandom function call.
 */
export type RequestRandom = CallResult<
    {
        requestId: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the fulfillRandom function call.
 */
export type FulfillRandom = CallResult<
    {
        output: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getOutput function call.
 */
export type GetOutput = CallResult<
    {
        output: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getRequest function call.
 */
export type GetRequest = CallResult<{}, OPNetEvent<never>[]>;

// ------------------------------------------------------------------
// IVRFContract
// ------------------------------------------------------------------
export interface IVRFContract extends IOP_NETContract {
    setAggPubKey(pubKeyLow: bigint): Promise<SetAggPubKey>;
    requestRandom(seed: bigint): Promise<RequestRandom>;
    fulfillRandom(requestId: bigint, proof: Uint8Array, blockHashBytes: Uint8Array): Promise<FulfillRandom>;
    getOutput(requestId: bigint): Promise<GetOutput>;
    getRequest(requestId: bigint): Promise<GetRequest>;
}
