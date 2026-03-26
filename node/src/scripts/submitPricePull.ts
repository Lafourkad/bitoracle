/**
 * submitPricePull.ts — Test the pull oracle model
 *
 * Simulates a dApp that:
 *   1. Fetches a signed price payload from the oracle
 *   2. Embeds it in its own tx calldata
 *   3. Calls PriceFeedPull.verifyAndGetPrice() — atomically verified in-block
 *
 * In production: the dApp's contract calls PriceFeedPull.verifyAndGetPrice()
 * as part of its own execution (e.g. before approving a loan).
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { JSONRpcProvider } from 'opnet';
import { TransactionFactory, Wallet, BinaryWriter } from '@btc-vision/transaction';
import { createRequire } from 'module';
import { resolve } from 'path';
const require2 = createRequire(import.meta.url);
const _msgSignerPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../node_modules/@btc-vision/transaction/build/keypair/MessageSigner.js'
);
const { MessageSigner } = require2(_msgSignerPath);
import { networks } from '@btc-vision/bitcoin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '../..');
const NETWORK   = networks.opnetTestnet as any;
const RPC_URL   = process.env.OPNET_RPC_URL ?? 'https://testnet.opnet.org';
const ASSET     = process.env.ASSET ?? 'BTC/USD';

const dj  = JSON.parse(readFileSync(join(ROOT, 'keys/deployer.json'), 'utf8'));
const dep = JSON.parse(readFileSync(join(ROOT, 'keys/deployment.json'), 'utf8'));

const PULL_ADDR     = dep.priceFeedPullAddress as string;
const REGISTRY_ADDR = dep.registryAddress as string;

const wallet   = Wallet.fromWif(dj.schnorrPrivWIF, dj.quantumPrivHex, NETWORK);
const provider = new JSONRpcProvider(RPC_URL, NETWORK, 60_000);
const factory  = new TransactionFactory();

function sel(sig: string): number {
    const h = createHash('sha256').update(sig).digest();
    return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
}

// ── Step 1: Oracle signs the price (off-chain) ────────────────────────────────

const blockNumber = await provider.getBlockNumber();
console.log('[pull] Block:', blockNumber);

// Fetch price
const priceResp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
const priceData = await priceResp.json();
const priceUsd  = Math.round((priceData as any).bitcoin.usd * 100);
const priceU64  = BigInt(priceUsd);
console.log('[pull] Price:', (priceData as any).bitcoin.usd, 'USD →', priceU64, 'cents');

// Build message hash: sha256(asset_utf8 || price_u64be || blockNum_u64be)
const assetBytes = Buffer.from(ASSET, 'utf8');
const msgBuf     = Buffer.alloc(assetBytes.length + 16);
assetBytes.copy(msgBuf, 0);
msgBuf.writeBigUInt64BE(priceU64,   assetBytes.length);
msgBuf.writeBigUInt64BE(blockNumber, assetBytes.length + 8);
const msgHash = createHash('sha256').update(msgBuf).digest();
console.log('[pull] MsgHash:', msgHash.toString('hex'));

// Oracle signs with ML-DSA
const mldsaSigned = MessageSigner.signMLDSAMessage(wallet.mldsaKeypair, msgHash);
const signature   = mldsaSigned.signature;
console.log('[pull] Signature len:', signature.length, 'bytes (ML-DSA ✅)');

// ── Step 2: dApp builds calldata with embedded oracle payload ─────────────────

const pullAddr = await provider.getPublicKeyInfo(PULL_ADDR, true);
console.log('[pull] PriceFeedPull pubkey:', pullAddr.toHex());

const deployerAddr = await provider.getPublicKeyInfo(wallet.p2tr, false);

const selector = sel('verifyAndGetPrice(bytes,uint256,uint256,address,bytes)');
console.log('[pull] Selector: 0x' + selector.toString(16).padStart(8, '0'));

const calldata = new BinaryWriter();
calldata.writeSelector(selector);

// asset: bytes
calldata.writeU32(assetBytes.length);
for (const b of assetBytes) calldata.writeU8(b);

// price: uint256
calldata.writeU256(priceU64);

// blockNum: uint256
calldata.writeU256(blockNumber);

// oracleAddr: address
calldata.writeAddress(deployerAddr);

// signature: bytes
calldata.writeU32(signature.length);
for (const b of signature) calldata.writeU8(b);

// ── Step 3: Broadcast via consolidated tx (ML-DSA sig = 2420 bytes) ──────────

const r    = await fetch(`${RPC_URL}/api/v1/address/utxos?address=${wallet.p2tr}&optimize=true`);
const data = await r.json();
const utxos = (data.confirmed as any[]).map((u: any) => ({
    transactionId: u.transactionId,
    outputIndex:   u.outputIndex,
    value:         BigInt(u.value),
    scriptPubKey:  u.scriptPubKey,
}));
console.log('[pull] UTXOs:', utxos.length, '—', utxos.reduce((s: bigint, u: any) => s + u.value, 0n), 'sats');
if (!utxos.length) throw new Error('No UTXOs');

const challenge = await provider.getChallenge();
const result = await factory.signConsolidatedInteraction({
    signer:      wallet.keypair,
    mldsaSigner: wallet.mldsaKeypair,
    network:     NETWORK,
    from:        wallet.p2tr,
    to:          pullAddr.toHex(),
    contract:    pullAddr.toHex(),
    calldata:    calldata.getBuffer(),
    utxos,
    challenge,
    feeRate:     80,
    priorityFee: 0n,
    gasSatFee:   500n,
});

console.log('[pull] Setup txid:', result.setupTxId);
console.log('[pull] Reveal txid:', result.revealTxId);

const sr = await provider.sendRawTransaction(result.setupTransaction, false);
console.log('[pull] Setup:', sr.success ? '✅' : '❌', sr.result ?? (sr as any).error);
if (!sr.success) throw new Error('Setup failed');

await new Promise(r => setTimeout(r, 2000));

const rr = await provider.sendRawTransaction(result.revealTransaction, false);
console.log('[pull] Reveal:', rr.success ? '✅' : '❌', rr.result ?? (rr as any).error);
if (!rr.success) throw new Error('Reveal failed');

console.log('[pull] ✅ Done! Reveal txid:', result.revealTxId);
console.log('[pull] Prix soumis:', (priceData as any).bitcoin.usd, 'USD');
console.log('[pull] Attends confirmation → vérifie sur opscan (pas de storage = résultat dans events/receipt)');
