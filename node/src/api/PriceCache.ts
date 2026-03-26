/**
 * PriceCache — thread-safe in-memory cache for latest oracle prices.
 * Written by OracleNode after each successful aggregation.
 * Read by the HTTP API server.
 */

export interface PriceEntry {
    asset: string;
    price: bigint;          // integer cents (e.g. 8_450_000n = $84,500.00)
    blockNumber: bigint;
    timestamp: number;      // Unix ms
    quorum: number;         // how many oracles signed
    txid?: string;          // last on-chain submission txid
}

export class PriceCache {
    private static readonly instance = new PriceCache();
    private readonly cache = new Map<string, PriceEntry>();

    private constructor() {}

    static getInstance(): PriceCache {
        return PriceCache.instance;
    }

    set(entry: PriceEntry): void {
        this.cache.set(entry.asset, entry);
    }

    get(asset: string): PriceEntry | undefined {
        return this.cache.get(asset);
    }

    getAll(): PriceEntry[] {
        return [...this.cache.values()];
    }

    /** Format price as decimal string with 2 decimals (cents → dollars) */
    static formatPrice(price: bigint): string {
        const dollars = price / 100n;
        const cents   = price % 100n;
        return `${dollars}.${cents.toString().padStart(2, '0')}`;
    }
}
