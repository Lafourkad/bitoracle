/**
 * HttpServer — REST API for BitOracle price feeds
 *
 * Endpoints:
 *   GET /health                  → liveness check
 *   GET /price?asset=BTC/USD     → latest price for one asset
 *   GET /prices                  → all latest prices
 *   GET /status                  → node status (uptime, block, quorum)
 */

import express, { Request, Response } from 'express';
import type { Server } from 'http';
import { PriceCache } from './PriceCache.js';

export interface NodeStatus {
    version: string;
    network: string;
    uptime: number;          // seconds
    lastBlock: bigint;
    oracleAddress: string;
    assets: string[];
    quorum: { required: number; connected: number };
}

export class HttpServer {
    private readonly app = express();
    private server: Server | null = null;
    private readonly startTime = Date.now();
    private statusFn: (() => NodeStatus) | null = null;

    constructor(private readonly port: number = 8080) {
        this.app.use(express.json());
        this.app.disable('x-powered-by');
        this.registerRoutes();
    }

    /** Register a callback to get live node status */
    onStatus(fn: () => NodeStatus): void {
        this.statusFn = fn;
    }

    start(): Promise<void> {
        return new Promise((resolve) => {
            this.server = this.app.listen(this.port, () => {
                console.log(`[HttpServer] Listening on :${this.port}`);
                resolve();
            });
        });
    }

    stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.server) return resolve();
            this.server.close((err) => err ? reject(err) : resolve());
        });
    }

    // ── Routes ────────────────────────────────────────────────────────────────

    private registerRoutes(): void {
        // Liveness
        this.app.get('/health', (_req: Request, res: Response) => {
            res.json({ ok: true, uptime: Math.floor((Date.now() - this.startTime) / 1000) });
        });

        // Single asset price
        this.app.get('/price', (req: Request, res: Response) => {
            const asset = (req.query.asset as string)?.toUpperCase();
            if (!asset) {
                res.status(400).json({ error: 'Missing ?asset= parameter (e.g. BTC/USD)' });
                return;
            }

            const entry = PriceCache.getInstance().get(asset);
            if (!entry) {
                res.status(404).json({ error: `No price available for ${asset}` });
                return;
            }

            res.json({
                asset: entry.asset,
                price: PriceCache.formatPrice(entry.price),
                priceRaw: entry.price.toString(),
                blockNumber: entry.blockNumber.toString(),
                timestamp: entry.timestamp,
                quorum: entry.quorum,
                txid: entry.txid ?? null,
            });
        });

        // All prices
        this.app.get('/prices', (_req: Request, res: Response) => {
            const entries = PriceCache.getInstance().getAll();
            res.json(entries.map(e => ({
                asset: e.asset,
                price: PriceCache.formatPrice(e.price),
                priceRaw: e.price.toString(),
                blockNumber: e.blockNumber.toString(),
                timestamp: e.timestamp,
                quorum: e.quorum,
                txid: e.txid ?? null,
            })));
        });

        // Node status
        this.app.get('/status', (_req: Request, res: Response) => {
            if (!this.statusFn) {
                res.status(503).json({ error: 'Node not started' });
                return;
            }
            const s = this.statusFn();
            res.json({
                ...s,
                lastBlock: s.lastBlock.toString(),
                uptime: Math.floor((Date.now() - this.startTime) / 1000),
            });
        });

        // 404 catch-all
        this.app.use((_req: Request, res: Response) => {
            res.status(404).json({ error: 'Not found' });
        });
    }
}
