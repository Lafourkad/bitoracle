/**
 * runDaemon.ts — BitOracle Pull Oracle Daemon v2
 *
 * Pull model: oracles sign prices off-chain, dApps fetch and verify on-chain.
 * No on-chain tx from the daemon (except heartbeat + VRF fulfillment).
 *
 * Cycle (every 30s):
 *   1. Fetch prices for all assets from multiple sources → median
 *   2. Sign batch: MuSig2(sha256(asset || price || blockNum)) per asset
 *   3. Store signed prices in memory
 *   4. Expose via HTTP API:
 *      GET /signed-price?asset=BTC/USD  → { price, sig, blockNum, aggPubKey }
 *      GET /signed-prices               → batch of all assets
 *      GET /price?asset=BTC/USD         → raw price (no sig)
 *      GET /health                      → uptime
 *      GET /status                      → full status
 *
 * dApps call PriceFeedMuSig2.verifyAndGetPrice(asset, price, blockNum, sig, aggPubKey)
 * directly in their own tx — oracle pays zero gas.
 *
 * Heartbeat: 1 on-chain tx every HEARTBEAT_BLOCKS to prove liveness (leader only).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import { JSONRpcProvider } from 'opnet';
import { TransactionFactory, Wallet, BinaryWriter } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import { muSig2Sign, xOnlyPubKey } from '../musig2/MuSig2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const express            = req('express');
const { ThresholdMLDSA } = req(join(__dirname, '../../node_modules/@btc-vision/post-quantum/threshold-ml-dsa.js'));
const { ml_dsa44 }       = req(join(__dirname, '../../node_modules/@btc-vision/post-quantum/ml-dsa.js'));

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT     = join(__dirname, '../..');
const NODE_ID  = process.env.NODE_ID  ?? 'node1';
const IS_LEADER = NODE_ID === 'node1';
const NETWORK  = (networks as any).opnetTestnet;
const RPC_URL  = process.env.OPNET_RPC_URL ?? 'https://testnet.opnet.org';
const ASSETS   = (process.env.ASSETS ?? 'BTC/USD').split(',').map(s => s.trim());
const PORT     = parseInt(process.env.API_PORT     ?? '8080');
const INTERVAL = parseInt(process.env.INTERVAL_MS  ?? '30000');
const HEARTBEAT_BLOCKS = parseInt(process.env.HEARTBEAT ?? '10');

// ── Load keys ─────────────────────────────────────────────────────────────────

const dep     = JSON.parse(readFileSync(join(ROOT, 'keys/deployment.json'), 'utf-8'));
const oracles = ['deployer', 'oracle1', 'oracle2'].map(name => {
    const kj = JSON.parse(readFileSync(join(ROOT, `keys/${name}.json`), 'utf-8'));
    return { name, wallet: Wallet.fromWif(kj.schnorrPrivWIF, kj.quantumPrivHex, NETWORK) };
});

const nodeKeyMap: Record<string, string> = { node1: 'deployer', node2: 'oracle1', node3: 'oracle2' };
const myKj     = JSON.parse(readFileSync(join(ROOT, `keys/${nodeKeyMap[NODE_ID] ?? 'deployer'}.json`), 'utf-8'));
const myWallet = Wallet.fromWif(myKj.schnorrPrivWIF, myKj.quantumPrivHex, NETWORK);

const provider = new JSONRpcProvider(RPC_URL, NETWORK, 60_000);
const factory  = new TransactionFactory();

// Pre-compute aggPubKey once
const signers = oracles.map(o => ({
    priv: o.wallet.keypair.privateKey as Uint8Array,
    pub:  xOnlyPubKey(o.wallet.keypair.privateKey as Uint8Array),
}));
const dummyMsg = new Uint8Array(32).fill(1);
const { aggPubKey } = await muSig2Sign(signers, dummyMsg);
const AGG_PUB_KEY_HEX = Buffer.from(aggPubKey).toString('hex');

// ── ThresholdMLDSA (audit trail) ──────────────────────────────────────────────

const thresholdKeyFile = join(ROOT, 'keys/threshold-key.json');
let thresholdKey: any;
if (existsSync(thresholdKeyFile)) {
    const stored = JSON.parse(readFileSync(thresholdKeyFile, 'utf-8'));
    thresholdKey = {
        publicKey: Buffer.from(stored.publicKey, 'hex'),
        shares: stored.shares.map((s: any) => ({
            ...s,
            rho: Buffer.from(s.rho, 'hex'), key: Buffer.from(s.key, 'hex'), tr: Buffer.from(s.tr, 'hex'),
            shares: new Map(Object.entries(s.shares).map(([k, v]: any) => [parseInt(k), {
                s1: v.s1.map((a: number[]) => new Int32Array(a)), s2: v.s2.map((a: number[]) => new Int32Array(a)),
                s1Hat: v.s1Hat.map((a: number[]) => new Int32Array(a)), s2Hat: v.s2Hat.map((a: number[]) => new Int32Array(a)),
            }])),
        })),
    };
    console.log(`[${NODE_ID}] Loaded threshold key`);
} else {
    console.log(`[${NODE_ID}] Generating threshold key...`);
    const tgen = ThresholdMLDSA.create(44, 3, 3);
    thresholdKey = tgen.keygen();
    const toStore = {
        publicKey: Buffer.from(thresholdKey.publicKey).toString('hex'),
        shares: thresholdKey.shares.map((s: any) => ({
            id: s.id, rho: Buffer.from(s.rho).toString('hex'), key: Buffer.from(s.key).toString('hex'), tr: Buffer.from(s.tr).toString('hex'),
            shares: Object.fromEntries(Array.from(s.shares.entries()).map(([k, v]: any) => [k, {
                s1: Array.from(v.s1).map((a: any) => Array.from(a)), s2: Array.from(v.s2).map((a: any) => Array.from(a)),
                s1Hat: Array.from(v.s1Hat).map((a: any) => Array.from(a)), s2Hat: Array.from(v.s2Hat).map((a: any) => Array.from(a)),
            }])),
        })),
    };
    writeFileSync(thresholdKeyFile, JSON.stringify(toStore, null, 2));
    console.log(`[${NODE_ID}] Threshold key saved`);
}
const t = ThresholdMLDSA.create(44, 3, 3);

// ── State ─────────────────────────────────────────────────────────────────────

interface SignedPrice {
    asset:      string;
    price:      bigint;
    priceStr:   string;
    blockNum:   bigint;
    timestamp:  number;
    sources:    number;
    sig:        string;   // hex 64 bytes MuSig2
    aggPubKey:  string;   // hex 32 bytes
    mldsaSig?:  string;   // hex audit trail
}

let lastBlock       = 0n;
let lastHeartbeat   = 0n;
let startTime       = Date.now();
const signedPrices  = new Map<string, SignedPrice>();

// ── Price fetchers ────────────────────────────────────────────────────────────

function median(vals: bigint[]): bigint {
    const s = [...vals].sort((a, b) => (a < b ? -1 : 1));
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m-1] + s[m]) / 2n : s[m];
}
function formatPrice(p: bigint): string { return `${p/100n}.${(p%100n).toString().padStart(2,'0')}`; }

async function fetchBtcUsd(): Promise<{ price: bigint; sources: number }> {
    const results = await Promise.allSettled([
        fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')
            .then(r => r.json() as any).then(d => BigInt(Math.round(parseFloat(d.price) * 100))),
        fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot')
            .then(r => r.json() as any).then(d => BigInt(Math.round(parseFloat(d.data.amount) * 100))),
        fetch('https://api.kraken.com/0/public/Ticker?pair=XBTCUSD')
            .then(r => r.json() as any).then(d => {
                const ticker: any = Object.values(d.result as any)[0];
                return BigInt(Math.round(parseFloat(ticker.c[0]) * 100));
            }),
    ]);
    const valid = results
        .filter((r): r is PromiseFulfilledResult<bigint> => r.status === 'fulfilled')
        .map(r => r.value);
    if (!valid.length) throw new Error('All BTC/USD sources failed');
    return { price: median(valid), sources: valid.length };
}

async function fetchPrice(asset: string): Promise<{ price: bigint; sources: number }> {
    if (asset === 'BTC/USD') return fetchBtcUsd();
    throw new Error(`Unknown asset: ${asset}`);
}

// ── Sign price (MuSig2 + ThresholdMLDSA) ─────────────────────────────────────

async function signPrice(asset: string, price: bigint, blockNum: bigint): Promise<SignedPrice> {
    const assetBytes = Buffer.from(asset, 'utf-8');
    const msgBuf     = Buffer.alloc(assetBytes.length + 16);
    assetBytes.copy(msgBuf, 0);
    msgBuf.writeBigUInt64BE(price,    assetBytes.length);
    msgBuf.writeBigUInt64BE(blockNum, assetBytes.length + 8);
    const msgHash = createHash('sha256').update(msgBuf).digest();

    // MuSig2 — the on-chain verifiable sig
    const { signature: muSig2Sig, aggPubKey: aggKey } = await muSig2Sign(signers, msgHash);

    // ThresholdMLDSA — off-chain audit trail only
    let mldsaHex: string | undefined;
    let mldsaSig: Uint8Array | null = null;
    let attempts = 0;
    while (!mldsaSig && attempts < 10) { mldsaSig = t.sign(msgHash, thresholdKey.publicKey, thresholdKey.shares); attempts++; }
    if (mldsaSig) {
        mldsaHex = Buffer.from(mldsaSig).toString('hex');
    }

    const sp: SignedPrice = {
        asset,
        price,
        priceStr:  formatPrice(price),
        blockNum,
        timestamp: Date.now(),
        sources:   0, // set by caller
        sig:       Buffer.from(muSig2Sig).toString('hex'),
        aggPubKey: Buffer.from(aggKey).toString('hex'),
        mldsaSig:  mldsaHex,
    };
    return sp;
}

// ── Heartbeat (on-chain liveness proof) ──────────────────────────────────────

async function sendHeartbeat(blockNumber: bigint): Promise<void> {
    if (!IS_LEADER) return;
    const blocksSince = Number(blockNumber - lastHeartbeat);
    if (blocksSince < HEARTBEAT_BLOCKS) return;

    const sp = signedPrices.get('BTC/USD');
    if (!sp) return;

    console.log(`[${NODE_ID}] Heartbeat — ${blocksSince} blocks since last`);

    try {
        const assetBytes = Buffer.from(sp.asset, 'utf-8');
        const sigBytes   = Buffer.from(sp.sig, 'hex');
        const pubBytes   = Buffer.from(sp.aggPubKey, 'hex');

        const selHash = createHash('sha256')
            .update('verifyAndGetPrice(bytes,uint256,uint256,bytes,bytes)').digest();
        const selector = ((selHash[0] << 24) | (selHash[1] << 16) | (selHash[2] << 8) | selHash[3]) >>> 0;

        const calldata = new BinaryWriter();
        calldata.writeSelector(selector);
        calldata.writeU32(assetBytes.length);
        for (const b of assetBytes) calldata.writeU8(b);
        calldata.writeU256(sp.price);
        calldata.writeU256(sp.blockNum);
        calldata.writeU32(64);
        for (const b of sigBytes) calldata.writeU8(b);
        calldata.writeU32(32);
        for (const b of pubBytes) calldata.writeU8(b);

        const contractAddr = dep.priceFeedMuSig2Address;
        const contractInfo = await provider.getPublicKeyInfo(contractAddr, true).catch(() => null);
        if (!contractInfo) { console.warn(`[${NODE_ID}] Contract not indexed — heartbeat skipped`); return; }

        const r    = await fetch(`${RPC_URL}/api/v1/address/utxos?address=${myWallet.p2tr}&optimize=true`);
        const data = await r.json() as any;
        const utxos = (data.confirmed as any[]).map((u: any) => ({
            transactionId: u.transactionId, outputIndex: u.outputIndex,
            value: BigInt(u.value), scriptPubKey: u.scriptPubKey,
        }));
        if (!utxos.length) { console.warn(`[${NODE_ID}] No UTXOs for heartbeat`); return; }

        const challenge = await provider.getChallenge();
        const result = await factory.signConsolidatedInteraction({
            signer: myWallet.keypair, mldsaSigner: myWallet.mldsaKeypair,
            network: NETWORK, from: myWallet.p2tr,
            to: contractInfo.toHex(), contract: contractInfo.toHex(),
            calldata: calldata.getBuffer(), utxos, challenge,
            feeRate: 60, priorityFee: 0n, gasSatFee: 10000n,
        });

        const sr = await provider.sendRawTransaction(result.setupTransaction, false);
        if (!sr.success) { console.warn(`[${NODE_ID}] Heartbeat setup failed:`, sr.result); return; }
        await new Promise(r => setTimeout(r, 2000));
        const rr = await provider.sendRawTransaction(result.revealTransaction, false);
        if (rr.success) {
            console.log(`[${NODE_ID}] ✅ Heartbeat txid: ${result.revealTxId}`);
            lastHeartbeat = blockNumber;
        } else {
            console.warn(`[${NODE_ID}] Heartbeat reveal failed:`, rr.result);
        }
    } catch (err: any) {
        console.warn(`[${NODE_ID}] Heartbeat error:`, err.message);
    }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
    try {
        const blockNumber = await provider.getBlockNumber();
        lastBlock = blockNumber;

        for (const asset of ASSETS) {
            try {
                const { price, sources } = await fetchPrice(asset);
                const signed = await signPrice(asset, price, blockNumber);
                signed.sources = sources;
                signedPrices.set(asset, signed);
                console.log(`[${NODE_ID}] ${asset} = $${signed.priceStr} (${sources}/3) block=${blockNumber} sig=${signed.sig.slice(0,16)}…`);
            } catch (err: any) {
                console.warn(`[${NODE_ID}] ${asset} error:`, err.message);
            }
        }

        // Heartbeat (liveness proof, infrequent)
        await sendHeartbeat(blockNumber);

    } catch (err: any) {
        console.error(`[${NODE_ID}] Tick error:`, err.message);
    }
}

// ── HTTP API ──────────────────────────────────────────────────────────────────

const app = express();
app.use((_: any, res: any, next: any) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});

// GET /health
app.get('/health', (_: any, res: any) => res.json({
    ok: true, nodeId: NODE_ID, uptime: Math.floor((Date.now()-startTime)/1000),
}));

// GET /signed-price?asset=BTC/USD
// Returns everything a dApp needs to call verifyAndGetPrice on-chain
app.get('/signed-price', (req: any, res: any) => {
    const asset = (req.query.asset as string)?.toUpperCase().replace('-', '/');
    if (!asset) return res.status(400).json({ error: 'Missing asset param' });
    const sp = signedPrices.get(asset);
    if (!sp) return res.status(404).json({ error: `No signed price for ${asset}` });
    res.json({
        asset:     sp.asset,
        price:     sp.priceStr,
        priceRaw:  sp.price.toString(),
        blockNum:  sp.blockNum.toString(),
        timestamp: sp.timestamp,
        sources:   sp.sources,
        sig:       sp.sig,        // 64 bytes hex — for verifyAndGetPrice
        aggPubKey: sp.aggPubKey,  // 32 bytes hex — for verifyAndGetPrice
    });
});

// GET /signed-prices
// Returns all assets as a batch — dApp can submit multiple in one tx
app.get('/signed-prices', (_: any, res: any) => {
    res.json([...signedPrices.values()].map(sp => ({
        asset:     sp.asset,
        price:     sp.priceStr,
        priceRaw:  sp.price.toString(),
        blockNum:  sp.blockNum.toString(),
        timestamp: sp.timestamp,
        sources:   sp.sources,
        sig:       sp.sig,
        aggPubKey: sp.aggPubKey,
    })));
});

// GET /price?asset=BTC/USD (backwards compat, no sig)
app.get('/price', (req: any, res: any) => {
    const asset = (req.query.asset as string)?.toUpperCase().replace('-', '/');
    const sp = asset ? signedPrices.get(asset) : null;
    if (!sp) return res.status(404).json({ error: `No price for ${asset}` });
    res.json({ asset: sp.asset, price: sp.priceStr, priceRaw: sp.price.toString(), timestamp: sp.timestamp, sources: sp.sources });
});

// GET /prices (backwards compat)
app.get('/prices', (_: any, res: any) => {
    res.json([...signedPrices.values()].map(sp => ({
        asset: sp.asset, price: sp.priceStr, priceRaw: sp.price.toString(), timestamp: sp.timestamp, sources: sp.sources,
    })));
});

// GET /status
app.get('/status', (_: any, res: any) => res.json({
    version: '2.0.0', model: 'pull', nodeId: NODE_ID, isLeader: IS_LEADER,
    network: 'testnet', uptime: Math.floor((Date.now()-startTime)/1000),
    lastBlock: lastBlock.toString(), lastHeartbeat: lastHeartbeat.toString(),
    aggPubKey: AGG_PUB_KEY_HEX,
    assets: ASSETS, priceCount: signedPrices.size,
    priceFeedContract: dep.priceFeedMuSig2Address ?? null,
}));

// ── Start ─────────────────────────────────────────────────────────────────────

await new Promise<void>(resolve => app.listen(PORT, () => {
    console.log(`[${NODE_ID}] 🚀 Pull oracle API :${PORT} | Leader: ${IS_LEADER} | Assets: ${ASSETS.join(', ')}`);
    resolve();
}));

console.log(`[${NODE_ID}] aggPubKey: ${AGG_PUB_KEY_HEX}`);
console.log(`[${NODE_ID}] Starting pull oracle — signing every ${INTERVAL/1000}s, heartbeat every ${HEARTBEAT_BLOCKS} blocks`);

await tick();
const timer = setInterval(tick, INTERVAL);
process.on('SIGINT', () => { clearInterval(timer); console.log(`[${NODE_ID}] Stopped.`); process.exit(0); });
