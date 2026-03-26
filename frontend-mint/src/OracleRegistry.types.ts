import type { IOP_NETContract } from 'opnet';

export interface IOracleRegistry extends IOP_NETContract {
    getOracleCount(): Promise<{ revert?: string; properties: { count: bigint } }>;
    getOracleAtIndex(index: bigint): Promise<{ revert?: string; properties: { oracleAddress: string } }>;
    getOracleInfo(oracleAddress: string): Promise<{
        revert?: string;
        properties: {
            status:        bigint;
            pubKeyLow:     bigint;
            registerBlock: bigint;
            slashCount:    bigint;
            stake:         bigint;
        };
    }>;
    isActive(oracleAddress: string): Promise<{ revert?: string; properties: { active: boolean } }>;
    isSlashed(oracleAddress: string): Promise<{ revert?: string; properties: { slashed: boolean } }>;
}
