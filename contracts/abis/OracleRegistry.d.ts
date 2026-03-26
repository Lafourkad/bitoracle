import { Address, AddressMap, ExtendedAddressMap, SchnorrSignature } from '@btc-vision/transaction';
import { CallResult, OPNetEvent, IOP_NETContract } from 'opnet';

// ------------------------------------------------------------------
// Event Definitions
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Call Results
// ------------------------------------------------------------------

/**
 * @description Represents the result of the registerOracle function call.
 */
export type RegisterOracle = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<OracleRegisteredEvent>[]
>;

/**
 * @description Represents the result of the addOracle function call.
 */
export type AddOracle = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<OracleRegisteredEvent>[]
>;

/**
 * @description Represents the result of the setNFTAddress function call.
 */
export type SetNFTAddress = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the registerNode function call.
 */
export type RegisterNode = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<OracleRegisteredEvent>[]
>;

/**
 * @description Represents the result of the getNFTAddress function call.
 */
export type GetNFTAddress = CallResult<
    {
        nftAddress: Address;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the requestUnstake function call.
 */
export type RequestUnstake = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<UnstakeRequestedEvent>[]
>;

/**
 * @description Represents the result of the publishFraudProof function call.
 */
export type PublishFraudProof = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<OracleSlashedEvent>[]
>;

/**
 * @description Represents the result of the isActive function call.
 */
export type IsActive = CallResult<
    {
        active: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getStake function call.
 */
export type GetStake = CallResult<
    {
        stake: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the isSlashed function call.
 */
export type IsSlashed = CallResult<
    {
        slashed: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getPubKey function call.
 */
export type GetPubKey = CallResult<
    {
        pubKeyLow: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getOracleCount function call.
 */
export type GetOracleCount = CallResult<
    {
        count: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getOracleAtIndex function call.
 */
export type GetOracleAtIndex = CallResult<
    {
        oracleAddress: Address;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getOracleInfo function call.
 */
export type GetOracleInfo = CallResult<{}, OPNetEvent<never>[]>;

// ------------------------------------------------------------------
// IOracleRegistry
// ------------------------------------------------------------------
export interface IOracleRegistry extends IOP_NETContract {
    registerOracle(pubKeyLow: bigint, pubKeyHigh: bigint, stakeAmount: bigint): Promise<RegisterOracle>;
    addOracle(oracle: Address, pubKeyLow: bigint, pubKeyHigh: bigint): Promise<AddOracle>;
    setNFTAddress(nftAddress: Address): Promise<SetNFTAddress>;
    registerNode(tokenId: bigint, schnorrPubKey: bigint): Promise<RegisterNode>;
    getNFTAddress(): Promise<GetNFTAddress>;
    requestUnstake(): Promise<RequestUnstake>;
    publishFraudProof(
        oracleAddress: Address,
        price1: bigint,
        price2: bigint,
        blockNum: bigint,
        sig1: Uint8Array,
        sig2: Uint8Array,
        asset: Uint8Array,
    ): Promise<PublishFraudProof>;
    isActive(oracleAddress: Address): Promise<IsActive>;
    getStake(oracleAddress: Address): Promise<GetStake>;
    isSlashed(oracleAddress: Address): Promise<IsSlashed>;
    getPubKey(oracleAddress: Address): Promise<GetPubKey>;
    getOracleCount(): Promise<GetOracleCount>;
    getOracleAtIndex(index: bigint): Promise<GetOracleAtIndex>;
    getOracleInfo(oracleAddress: Address): Promise<GetOracleInfo>;
}
