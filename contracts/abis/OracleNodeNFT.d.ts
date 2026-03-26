import { Address, AddressMap, ExtendedAddressMap, SchnorrSignature } from '@btc-vision/transaction';
import { CallResult, OPNetEvent, IOP_NETContract } from 'opnet';

// ------------------------------------------------------------------
// Event Definitions
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Call Results
// ------------------------------------------------------------------

/**
 * @description Represents the result of the adminMint function call.
 */
export type AdminMint = CallResult<{}, OPNetEvent<never>[]>;

/**
 * @description Represents the result of the mint function call.
 */
export type Mint = CallResult<{}, OPNetEvent<never>[]>;

/**
 * @description Represents the result of the setPayoutAddress function call.
 */
export type SetPayoutAddress = CallResult<{}, OPNetEvent<never>[]>;

/**
 * @description Represents the result of the getPayoutAddress function call.
 */
export type GetPayoutAddress = CallResult<{}, OPNetEvent<never>[]>;

/**
 * @description Represents the result of the setOracleKey function call.
 */
export type SetOracleKey = CallResult<{}, OPNetEvent<never>[]>;

/**
 * @description Represents the result of the getOracleKey function call.
 */
export type GetOracleKey = CallResult<{}, OPNetEvent<never>[]>;

/**
 * @description Represents the result of the setMintPrice function call.
 */
export type SetMintPrice = CallResult<{}, OPNetEvent<never>[]>;

/**
 * @description Represents the result of the setTreasuryAddress function call.
 */
export type SetTreasuryAddress = CallResult<{}, OPNetEvent<never>[]>;

// ------------------------------------------------------------------
// IOracleNodeNFT
// ------------------------------------------------------------------
export interface IOracleNodeNFT extends IOP_NETContract {
    adminMint(to: Address): Promise<AdminMint>;
    mint(to: Address): Promise<Mint>;
    setPayoutAddress(tokenId: bigint, btcAddress: string): Promise<SetPayoutAddress>;
    getPayoutAddress(tokenId: bigint): Promise<GetPayoutAddress>;
    setOracleKey(tokenId: bigint, schnorrPubKey: bigint): Promise<SetOracleKey>;
    getOracleKey(tokenId: bigint): Promise<GetOracleKey>;
    setMintPrice(price: bigint): Promise<SetMintPrice>;
    setTreasuryAddress(btcAddress: string): Promise<SetTreasuryAddress>;
}
