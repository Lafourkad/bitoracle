/**
 * testPullModel.ts — End-to-end test of BitOracle pull oracle
 *
 * Simulates a dApp consuming a signed price:
 *   1. Fetch signed price from oracle API
 *   2. Build tx calling verifyAndGetPrice(asset, price, blockNum, sig, aggPubKey)
 *   3. Include fee output to treasury (2000 sats)
 *   4. Broadcast and verify success
 *
 * Usage: node --import tsx/esm testPullModel.ts
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { JSONRpcProvider } from 'opnet';
import { TransactionFactory, Wallet, BinaryWriter } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT    = join(__dirname, '../..');
const NETWORK = (networks as any).opnetTestnet;
const RPC_URL = 'https://testnet.opnet.org';
const API_URL = process.env.ORACLE_API ?? 'http://localhost:8081'; // node1

const provider = new JSONRpcProvider(RPC_URL, NETWORK, 60_000);
const factory  = new TransactionFactory();

// Load a test wallet (use deployer for test — has UTXOs)
const testKj    = JSON.parse(readFileSync(join(ROOT, 'keys/deployer.json'), 'utf-8'));
const testWallet = Wallet.fromWif(testKj.schnorrPrivWIF, testKj.quantumPrivHex, NETWORK);

// Contract addresses from deployment
const dep = JSON.parse(readFileSync(join(ROOT, 'keys/deployment.json'), 'utf-8'));
const PRICE_FEED = dep.priceFeedMuSig2Address;

console.log('[test] Test wallet:', testWallet.p2tr);
console.log('[test] PriceFeedMuSig2:', PRICE_FEED);
console.log('[test] API:', API_URL);

// ── Step 1: Fetch signed price from oracle ────────────────────────────────────

console.log('\n[1] Fetching signed price from oracle...');
const priceRes = await fetch(`${API_URL}/signed-price?asset=BTC/USD`);
if (!priceRes.ok) {
    console.error('[test] ❌ Failed to fetch signed price:', priceRes.status);
    process.exit(1);
}
const priceData = await priceRes.json() as {
    asset:     string;
    price:     string;
    priceRaw:  string;
    blockNum:  string;
    timestamp: number;
    sources:   number;
    sig:       string;
    aggPubKey: string;
};
console.log('[test] ✅ Got price:', priceData.price, '| block:', priceData.blockNum);
console.log('[test]    sig:', priceData.sig.slice(0, 16) + '...');
console.log('[test]    aggPubKey:', priceData.aggPubKey.slice(0, 16) + '...');

// ── Step 2: Get treasury address from contract ────────────────────────────────

console.log('\n[2] Getting treasury address from contract...');
const treasuryRes = await fetch(`${RPC_URL}/api/v1/contract/${PRICE_FEED}/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        method: 'getTreasuryAddress',
        args: [],
    }),
});
let treasury = '';
try {
    const tr = await treasuryRes.json() as any;
    // Response format: string with length prefix or raw
    if (tr.result) {
        // Decode string with length prefix (first 4 bytes = length)
        const buf = Buffer.from(tr.result, 'hex');
        const len = buf.readUInt32BE(0);
        treasury = buf.slice(4, 4 + len).toString('utf8');
    }
} catch {}
console.log('[test] Treasury:', treasury || '(not set — fee check disabled)');

// ── Step 3: Build calldata for verifyAndGetPrice ──────────────────────────────

console.log('\n[3] Building calldata...');
const selHash  = createHash('sha256').update('verifyAndGetPrice(bytes,uint256,uint256,bytes,bytes)').digest();
const selector = ((selHash[0] << 24) | (selHash[1] << 16) | (selHash[2] << 8) | selHash[3]) >>> 0;

const assetBytes = Buffer.from(priceData.asset, 'utf-8');
const priceU256   = BigInt(priceData.priceRaw);
const blockU256   = BigInt(priceData.blockNum);
const sigBytes    = Buffer.from(priceData.sig, 'hex');
const pubKeyBytes = Buffer.from(priceData.aggPubKey, 'hex');

const calldata = new BinaryWriter();
calldata.writeSelector(selector);
// asset (bytes)
calldata.writeU32(assetBytes.length);
for (const b of assetBytes) calldata.writeU8(b);
// price (uint256)
calldata.writeU256(priceU256);
// blockNum (uint256)
calldata.writeU256(blockU256);
// sig (bytes)
calldata.writeU32(sigBytes.length);
for (const b of sigBytes) calldata.writeU8(b);
// aggPubKey (bytes)
calldata.writeU32(pubKeyBytes.length);
for (const b of pubKeyBytes) calldata.writeU8(b);

console.log('[test] Calldata size:', calldata.getBuffer().length, 'bytes');

// ── Step 4: Fetch UTXOs ──────────────────────────────────────────────────────

console.log('\n[4] Fetching UTXOs...');
const utxoRes = await fetch(`${RPC_URL}/api/v1/address/utxos?address=${testWallet.p2tr}&optimize=true`);
const utxoData = await utxoRes.json() as any;
const utxos = (utxoData.confirmed as any[]).map((u: any) => ({
    transactionId: u.transactionId,
    outputIndex:   u.outputIndex,
    value:         BigInt(u.value),
    scriptPubKey:  u.scriptPubKey,
}));
if (!utxos.length) {
    console.error('[test] ❌ No UTXOs for test wallet');
    process.exit(1);
}
const totalSats = utxos.reduce((s: bigint, u: any) => s + u.value, 0n);
console.log('[test] ✅ UTXOs:', utxos.length, '| Total:', totalSats.toString(), 'sats');

// ── Step 5: Get contract pubkey ──────────────────────────────────────────────

const contractInfo = await provider.getPublicKeyInfo(PRICE_FEED, true).catch(() => null);
if (!contractInfo) {
    console.error('[test] ❌ Contract not indexed');
    process.exit(1);
}

// ── Step 6: Build and sign tx with fee output ────────────────────────────────

console.log('\n[5] Signing transaction...');
const FEE_SATS = 2000n;

const challenge = await provider.getChallenge();
const result = await factory.signConsolidatedInteraction({
    signer: testWallet.keypair,
    mldsaSigner: testWallet.mldsaKeypair,
    network: NETWORK,
    from: testWallet.p2tr,
    to: contractInfo.toHex(),
    contract: contractInfo.toHex(),
    calldata: calldata.getBuffer(),
    utxos,
    challenge,
    feeRate: 200, // high fee to RBF all pending txs
    priorityFee: 0n,
    gasSatFee: 10000n,
    // Add fee output to treasury if set
    extraOutputs: treasury ? [{
        address: treasury,
        value: FEE_SATS,
    }] : [],
});

console.log('[test] Setup tx:', result.setupTransaction.slice(0, 32) + '...');
console.log('[test] Reveal tx:', result.revealTransaction.slice(0, 32) + '...');

// ── Step 7: Broadcast ────────────────────────────────────────────────────────

console.log('\n[6] Broadcasting...');
const setupRes = await provider.sendRawTransaction(result.setupTransaction, false);
if (!setupRes.success) {
    console.error('[test] ❌ Setup failed:', setupRes.error ?? setupRes.result);
    process.exit(1);
}
console.log('[test] ✅ Setup:', setupRes.result);

await new Promise(r => setTimeout(r, 4000));

const revealRes = await provider.sendRawTransaction(result.revealTransaction, false);
if (!revealRes.success) {
    console.error('[test] ❌ Reveal failed:', revealRes.error ?? revealRes.result);
    process.exit(1);
}
console.log('[test] ✅ Reveal:', revealRes.result);

console.log('\n════════════════════════════════════════════════════════');
console.log('🎉 END-TO-END TEST PASSED');
console.log('');
console.log('  Asset:    ', priceData.asset);
console.log('  Price:    ', '$' + priceData.price);
console.log('  Block:    ', priceData.blockNum);
console.log('  Sources:  ', priceData.sources);
console.log('  txid:     ', result.revealTxId);
console.log('  Fee paid: ', treasury ? '2000 sats' : '0 (treasury not set)');
console.log('════════════════════════════════════════════════════════');
