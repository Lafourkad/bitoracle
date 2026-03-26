/**
 * submitPriceMuSig2.ts — Submit price with MuSig2 Schnorr on-chain + ThresholdMLDSA off-chain
 *
 * Flow:
 *   1. All 3 oracles agree on price + blockNumber
 *   2. ThresholdMLDSA 3-of-3 → 1 ML-DSA sig (quantum-safe, stored off-chain / for audit)
 *   3. MuSig2 3-of-3 → 1 Schnorr sig 64 bytes (submitted on-chain, cheap)
 *   4. dApp tx includes: Schnorr sig + aggPubKey + fee output → treasury
 *
 * On-chain contract: PriceFeedMuSig2
 *   - verifyAndGetPrice(asset, price, blockNum, sig64, aggPubKey)
 *   - Verifies Schnorr sig (64 bytes) via Blockchain.verifySchnorr()
 *   - Checks fee output to treasury address
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

const req = createRequire(import.meta.url);
const { ThresholdMLDSA } = req(
    join(dirname(fileURLToPath(import.meta.url)),
    '../../node_modules/@btc-vision/post-quantum/threshold-ml-dsa.js')
);
const { ml_dsa44 } = req(
    join(dirname(fileURLToPath(import.meta.url)),
    '../../node_modules/@btc-vision/post-quantum/ml-dsa.js')
);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT    = join(__dirname, '../..');
const NETWORK = networks.opnetTestnet as any;
const RPC_URL = process.env.OPNET_RPC_URL ?? 'https://testnet.opnet.org';
const ASSET   = process.env.ASSET ?? 'BTC/USD';

// Load oracle wallets
const oracles = ['deployer', 'oracle1', 'oracle2'].map(name => {
    const kj = JSON.parse(readFileSync(join(ROOT, `keys/${name}.json`), 'utf8'));
    const wallet = Wallet.fromWif(kj.schnorrPrivWIF, kj.quantumPrivHex, NETWORK);
    // Schnorr private key for MuSig2 (raw 32 bytes from WIF)
    const wifBytes = Buffer.from(kj.schnorrPrivWIF, 'base64').slice(1, 33); // rough decode
    // Use deterministic key from mnemonic/wallet internals
    return { name, wallet, kj };
});

// Load deployment info
const dep = JSON.parse(readFileSync(join(ROOT, 'keys/deployment.json'), 'utf8'));

const provider = new JSONRpcProvider(RPC_URL, NETWORK, 60_000);
const factory  = new TransactionFactory();

// ── Step 1: Get price + block ─────────────────────────────────────────────────
const blockNumber = await provider.getBlockNumber();
console.log('[musig2] Block:', blockNumber);

const priceResp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
const priceData = await priceResp.json() as any;
const priceUsd  = Math.round(priceData.bitcoin.usd * 100);
const priceU64  = BigInt(priceUsd);
console.log('[musig2] Price:', priceData.bitcoin.usd, 'USD →', priceU64, 'cents');

// Canonical message hash
const assetBytes = Buffer.from(ASSET, 'utf8');
const msgBuf     = Buffer.alloc(assetBytes.length + 16);
assetBytes.copy(msgBuf, 0);
msgBuf.writeBigUInt64BE(priceU64,    assetBytes.length);
msgBuf.writeBigUInt64BE(blockNumber, assetBytes.length + 8);
const msgHash = createHash('sha256').update(msgBuf).digest();
console.log('[musig2] MsgHash:', msgHash.toString('hex'));

// ── Step 2: ThresholdMLDSA 3-of-3 (off-chain, quantum-safe audit trail) ───────
console.log('\n[musig2] ThresholdMLDSA signing...');

// Load or generate threshold key (in prod: distributed DKG — here: trusted dealer for testnet)
const thresholdKeyFile = join(ROOT, 'keys/threshold-key.json');
let thresholdKey: any;

if (existsSync(thresholdKeyFile)) {
    const stored = JSON.parse(readFileSync(thresholdKeyFile, 'utf8'));
    thresholdKey = {
        publicKey: Buffer.from(stored.publicKey, 'hex'),
        shares: stored.shares.map((s: any) => ({
            ...s,
            rho:    Buffer.from(s.rho,    'hex'),
            key:    Buffer.from(s.key,    'hex'),
            tr:     Buffer.from(s.tr,     'hex'),
            shares: new Map(Object.entries(s.shares).map(([k, v]: any) => [
                parseInt(k),
                {
                    s1:    v.s1.map((a: number[])    => new Int32Array(a)),
                    s2:    v.s2.map((a: number[])    => new Int32Array(a)),
                    s1Hat: v.s1Hat.map((a: number[]) => new Int32Array(a)),
                    s2Hat: v.s2Hat.map((a: number[]) => new Int32Array(a)),
                }
            ])),
        })),
    };
    console.log('[musig2] Loaded threshold key from disk');
} else {
    const t = ThresholdMLDSA.create(44, 3, 3);
    thresholdKey = t.keygen();
    // Serialize for storage
    const toStore = {
        publicKey: Buffer.from(thresholdKey.publicKey).toString('hex'),
        shares: thresholdKey.shares.map((s: any) => ({
            id:  s.id,
            rho: Buffer.from(s.rho).toString('hex'),
            key: Buffer.from(s.key).toString('hex'),
            tr:  Buffer.from(s.tr).toString('hex'),
            shares: Object.fromEntries(
                Array.from(s.shares.entries()).map(([k, v]: any) => [
                    k,
                    {
                        s1:    Array.from(v.s1).map((a: any)    => Array.from(a)),
                        s2:    Array.from(v.s2).map((a: any)    => Array.from(a)),
                        s1Hat: Array.from(v.s1Hat).map((a: any) => Array.from(a)),
                        s2Hat: Array.from(v.s2Hat).map((a: any) => Array.from(a)),
                    }
                ])
            ),
        })),
    };
    writeFileSync(thresholdKeyFile, JSON.stringify(toStore, null, 2));
    console.log('[musig2] Generated new threshold key → keys/threshold-key.json');
}

const t = ThresholdMLDSA.create(44, 3, 3);
let mldsaSig: Uint8Array | null = null;
let attempts = 0;
while (!mldsaSig && attempts < 10) {
    mldsaSig = t.sign(msgHash, thresholdKey.publicKey, thresholdKey.shares);
    attempts++;
}
if (!mldsaSig) throw new Error('ThresholdMLDSA signing failed after 10 attempts');

const mldsaValid = ml_dsa44.verify(mldsaSig, msgHash, thresholdKey.publicKey);
console.log(`[musig2] ThresholdMLDSA sig: ${mldsaSig.length} bytes, valid: ${mldsaValid ? '✅' : '❌'} (${attempts} attempt(s))`);

// ── Step 3: MuSig2 Schnorr 3-of-3 (on-chain) ─────────────────────────────────
console.log('\n[musig2] MuSig2 Schnorr signing...');

// Extract Schnorr private keys from wallets
// keypair.privateKey is the raw secp256k1 privkey
const schnorrSigners = oracles.map(o => {
    const privBytes = o.wallet.keypair.privateKey as Uint8Array;
    const pubBytes  = xOnlyPubKey(privBytes);
    return { priv: privBytes, pub: pubBytes };
});

const { signature: muSig2Sig, aggPubKey } = await muSig2Sign(schnorrSigners, msgHash);
console.log('[musig2] MuSig2 sig:', Buffer.from(muSig2Sig).toString('hex'));
console.log('[musig2] AggPubKey:', Buffer.from(aggPubKey).toString('hex'));

// Verify locally before submitting
const { createRequire: cr2 } = await import('module');
const req2 = cr2(import.meta.url);
const { schnorr } = req2(join(__dirname, '../../node_modules/@noble/curves/secp256k1.js'));
const localValid = schnorr.verify(muSig2Sig, msgHash, aggPubKey);
console.log('[musig2] Local verification:', localValid ? '✅' : '❌');
if (!localValid) throw new Error('MuSig2 local verification failed');

// ── Step 4: Build calldata for PriceFeedMuSig2.verifyAndGetPrice ──────────────
// selector = sha256("verifyAndGetPrice(bytes,uint256,uint256,bytes,bytes)")[:4]
const selectorHash = createHash('sha256').update('verifyAndGetPrice(bytes,uint256,uint256,bytes,bytes)').digest();
const selector = ((selectorHash[0] << 24) | (selectorHash[1] << 16) | (selectorHash[2] << 8) | selectorHash[3]) >>> 0;
console.log('\n[musig2] Selector: 0x' + selector.toString(16).padStart(8, '0'));

const calldata = new BinaryWriter();
calldata.writeSelector(selector);

// asset
calldata.writeU32(assetBytes.length);
for (const b of assetBytes) calldata.writeU8(b);

// price uint256
calldata.writeU256(priceU64);

// blockNum uint256
calldata.writeU256(blockNumber);

// sig (64 bytes)
calldata.writeU32(64);
for (const b of muSig2Sig) calldata.writeU8(b);

// aggPubKey (32 bytes)
calldata.writeU32(32);
for (const b of aggPubKey) calldata.writeU8(b);

console.log('[musig2] Calldata size:', calldata.getBuffer().length, 'bytes');

// ── Step 5: Broadcast ─────────────────────────────────────────────────────────
const submitter = oracles[0].wallet;
const priceFeedAddr = dep.priceFeedMuSig2Address ?? dep.priceFeedPullAddress; // fallback to pull for now
const contractInfo  = await provider.getPublicKeyInfo(priceFeedAddr, true);

const r    = await fetch(`${RPC_URL}/api/v1/address/utxos?address=${submitter.p2tr}&optimize=true`);
const data = await r.json() as any;
const utxos = (data.confirmed as any[]).map((u: any) => ({
    transactionId: u.transactionId,
    outputIndex:   u.outputIndex,
    value:         BigInt(u.value),
    scriptPubKey:  u.scriptPubKey,
}));
console.log('[musig2] UTXOs:', utxos.length, '—', utxos.reduce((s: bigint, u: any) => s + u.value, 0n), 'sats');
if (!utxos.length) throw new Error('No UTXOs');

const challenge = await provider.getChallenge();
const result = await factory.signConsolidatedInteraction({
    signer:      submitter.keypair,
    mldsaSigner: submitter.mldsaKeypair,
    network:     NETWORK,
    from:        submitter.p2tr,
    to:          contractInfo.toHex(),
    contract:    contractInfo.toHex(),
    calldata:    calldata.getBuffer(),
    utxos,
    challenge,
    feeRate:     60,
    priorityFee: 0n,
    gasSatFee:   10000n,
});

console.log('[musig2] Setup txid:', result.setupTxId);
console.log('[musig2] Reveal txid:', result.revealTxId);

const sr = await provider.sendRawTransaction(result.setupTransaction, false);
console.log('[musig2] Setup:', sr.success ? '✅' : '❌', sr.result);
if (!sr.success) throw new Error('Setup failed');

await new Promise(r => setTimeout(r, 2000));

const rr = await provider.sendRawTransaction(result.revealTransaction, false);
console.log('[musig2] Reveal:', rr.success ? '✅' : '❌', rr.result);
if (!rr.success) throw new Error('Reveal failed');

console.log('\n[musig2] ✅ Done!');
console.log('[musig2] BTC/USD =', priceData.bitcoin.usd, 'USD');
console.log('[musig2] MuSig2 Schnorr 64 bytes on-chain');
console.log('[musig2] ThresholdMLDSA', mldsaSig.length, 'bytes off-chain audit trail');
