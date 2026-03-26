import type { Address } from '@btc-vision/transaction';
import type { CallResult, OPNetEvent, IOP_NETContract } from 'opnet';

export type AdminMint        = CallResult<Record<string, never>, OPNetEvent<never>[]>;
export type Mint             = CallResult<{ tokenId: bigint }, OPNetEvent<never>[]>;
export type TotalSupply      = CallResult<{ totalSupply: bigint }, OPNetEvent<never>[]>;
export type BalanceOf        = CallResult<{ balance: bigint }, OPNetEvent<never>[]>;
export type TokenOfOwnerByIndex = CallResult<{ tokenId: bigint }, OPNetEvent<never>[]>;
export type SetPayoutAddress = CallResult<Record<string, never>, OPNetEvent<never>[]>;
export type GetPayoutAddress = CallResult<{ btcAddress: string }, OPNetEvent<never>[]>;
export type SetOracleKey     = CallResult<Record<string, never>, OPNetEvent<never>[]>;
export type GetOracleKey     = CallResult<{ schnorrPubKey: bigint }, OPNetEvent<never>[]>;

export interface IOracleNodeNFT extends IOP_NETContract {
    mint(to: Address): Promise<Mint>;
    adminMint(to: Address): Promise<AdminMint>;
    totalSupply(): Promise<TotalSupply>;
    balanceOf(owner: Address): Promise<BalanceOf>;
    tokenOfOwnerByIndex(owner: Address, index: bigint): Promise<TokenOfOwnerByIndex>;
    setPayoutAddress(tokenId: bigint, btcAddress: string): Promise<SetPayoutAddress>;
    getPayoutAddress(tokenId: bigint): Promise<GetPayoutAddress>;
    setOracleKey(tokenId: bigint, schnorrPubKey: bigint): Promise<SetOracleKey>;
    getOracleKey(tokenId: bigint): Promise<GetOracleKey>;
}
