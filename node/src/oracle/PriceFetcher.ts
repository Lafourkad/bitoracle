/**
 * Fetches prices from external sources and aggregates them locally
 * before signing the attestation.
 */

import type { PriceSourceConfig } from '../config/config.js';

export class PriceFetcher {
    constructor(private readonly sources: PriceSourceConfig[]) {}

    /**
     * Fetch price for an asset from all configured sources.
     * Returns median price in integer form (e.g. USD cents or satoshis).
     */
    async fetchPrice(asset: string): Promise<bigint> {
        const prices = await Promise.allSettled(
            this.sources.map((s) => this.fetchFromSource(s, asset)),
        );

        const valid = prices
            .filter((r): r is PromiseFulfilledResult<bigint> => r.status === 'fulfilled')
            .map((r) => r.value);

        if (valid.length === 0) {
            throw new Error(`[PriceFetcher] No valid prices for ${asset}`);
        }

        return this.median(valid);
    }

    private async fetchFromSource(source: PriceSourceConfig, asset: string): Promise<bigint> {
        switch (source.type) {
            case 'binance':
                return this.fetchBinance(asset);
            case 'coinbase':
                return this.fetchCoinbase(asset);
            case 'kraken':
                return this.fetchKraken(asset);
            default:
                throw new Error(`Unknown source type: ${source.type}`);
        }
    }

    private async fetchBinance(asset: string): Promise<bigint> {
        const symbol = asset.replace('/', ''); // BTC/USD → BTCUSD
        const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}T`; // BTCUSDT
        const res = await fetch(url);
        const data = await res.json() as { price: string };
        // Convert to integer cents (price * 100, no floats on-chain)
        return BigInt(Math.round(parseFloat(data.price) * 100));
    }

    private async fetchCoinbase(asset: string): Promise<bigint> {
        const pair = asset.replace('/', '-'); // BTC/USD → BTC-USD
        const url = `https://api.coinbase.com/v2/prices/${pair}/spot`;
        const res = await fetch(url);
        const data = await res.json() as { data: { amount: string } };
        return BigInt(Math.round(parseFloat(data.data.amount) * 100));
    }

    private async fetchKraken(asset: string): Promise<bigint> {
        const pair = asset.replace('/', ''); // BTC/USD → BTCUSD
        const url = `https://api.kraken.com/0/public/Ticker?pair=X${pair}`;
        const res = await fetch(url);
        const data = await res.json() as { result: Record<string, { c: string[] }> };
        const result = Object.values(data.result)[0];
        return BigInt(Math.round(parseFloat(result.c[0]) * 100));
    }

    private median(values: bigint[]): bigint {
        const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        const mid = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 0) {
            return (sorted[mid - 1] + sorted[mid]) / 2n;
        }
        return sorted[mid];
    }
}
