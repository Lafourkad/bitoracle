/**
 * submitPriceQuorum.ts — Test quorum: 3 oracles sign the same price, submit together
 *
 * Calls PriceFeedPull.verifyAndGetPriceQuorum(asset, price, blockNum, oracles[], sigs[])
 * Contract verifies MIN_QUORUM (3) valid distinct oracle signatures → returns price
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { JSONRpcProvider } from 'opnet';
import { TransactionFactory, Wallet, BinaryWriter } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import { createRequire } from 'module';

const require2 = createRequire(import.meta.url);
const { MessageSigner } = require2(
    join(dirname(fileURLToPath(import.meta.url)),
    '../../node_modules/@btc-vision/transaction/build/keypair/MessageSigner.js')
);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '../..');
const NETWORK   = networks.opnetTestnet as any;
const RPC_URL   = process.env.OPNET_RPC_URL ?? 'https://testnet.opnet.org';
const ASSET     = process.env.ASSET ?? 'BTC/USD';

const dep = JSON.parse(readFileSync(join(ROOT, 'keys/deployment.json'), 'utf8'));
const PULL_ADDR = dep.priceFeedPullAddress as string;

// Load all 3 oracle wallets
const oracles = ['deployer', 'oracle1', 'oracle2'].map(name => {
    const kj = JSON.parse(readFileSync(join(ROOT, `keys/${name}.json`), 'utf8'));
    return {
        name,
        wallet: Wallet.fromWif(kj.schnorrPrivWIF, kj.quantumPrivHex, NETWORK),
        quantumPubHex: kj.quantumPubHex,
    };
});

const provider = new JSONRpcProvider(RPC_URL, NETWORK, 60_000);
const factory  = new TransactionFactory();

// Use deployer wallet for tx submission
const submitter = oracles[0].wallet;

function sel(sig: string): number {
    const h = createHash('sha256').update(sig).digest();
    return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
}

// ── Step 1: All oracles sign the same price ───────────────────────────────────

const blockNumber = await provider.getBlockNumber();
console.log('[quorum] Block:', blockNumber);

const priceResp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
const priceData = await priceResp.json();
const priceUsd  = Math.round((priceData as any).bitcoin.usd * 100);
const priceU64  = BigInt(priceUsd);
console.log('[quorum] Price:', (priceData as any).bitcoin.usd, 'USD →', priceU64, 'cents');

// Canonical message hash
const assetBytes = Buffer.from(ASSET, 'utf8');
const msgBuf     = Buffer.alloc(assetBytes.length + 16);
assetBytes.copy(msgBuf, 0);
msgBuf.writeBigUInt64BE(priceU64,    assetBytes.length);
msgBuf.writeBigUInt64BE(blockNumber, assetBytes.length + 8);
const msgHash = createHash('sha256').update(msgBuf).digest();
console.log('[quorum] MsgHash:', msgHash.toString('hex'));

// Each oracle signs with their ML-DSA key
const signatures: Uint8Array[] = [];
for (const oracle of oracles) {
    const signed = MessageSigner.signMLDSAMessage(oracle.wallet.mldsaKeypair, msgHash);
    signatures.push(signed.signature);
    console.log(`[quorum] ${oracle.name} signed ✅ (${signed.signature.length} bytes)`);
}

// ── Step 2: Build oracle addresses (mldsaHashedPublicKey = sha256(mldsaPubKey)) ──

const oracleAddrs: Uint8Array[] = oracles.map(o => {
    const qPub = Buffer.from(o.quantumPubHex, 'hex');
    return new Uint8Array(createHash('sha256').update(qPub).digest());
});

// ── Step 3: Build calldata for verifyAndGetPriceQuorum ────────────────────────
// Encoding: bytes asset | uint256 price | uint256 blockNum | uint32 count | address[count] | uint32 count | bytes[count]

const pullAddr = await provider.getPublicKeyInfo(PULL_ADDR, true);
console.log('[quorum] PriceFeedPull:', pullAddr.toHex());

const selector = sel('verifyAndGetPriceQuorum(bytes,uint256,uint256,address,bytes)');
console.log('[quorum] Selector: 0x' + selector.toString(16).padStart(8, '0'));

const calldata = new BinaryWriter();
calldata.writeSelector(selector);

// asset bytes
calldata.writeU32(assetBytes.length);
for (const b of assetBytes) calldata.writeU8(b);

// price uint256
calldata.writeU256(priceU64);

// blockNum uint256
calldata.writeU256(blockNumber);

// oracle count
calldata.writeU32(oracleAddrs.length);

// oracle addresses
for (const addr of oracleAddrs) {
    calldata.writeAddress(addr);
}

// sig count
calldata.writeU32(signatures.length);

// signatures
for (const sig of signatures) {
    calldata.writeU32(sig.length);
    for (const b of sig) calldata.writeU8(b);
}

// ── Step 4: Broadcast via consolidated tx ────────────────────────────────────

const r    = await fetch(`${RPC_URL}/api/v1/address/utxos?address=${submitter.p2tr}&optimize=true`);
const data = await r.json();
const utxos = (data.confirmed as any[]).map((u: any) => ({
    transactionId: u.transactionId,
    outputIndex:   u.outputIndex,
    value:         BigInt(u.value),
    scriptPubKey:  u.scriptPubKey,
}));
console.log('[quorum] UTXOs:', utxos.length, '—', utxos.reduce((s: bigint, u: any) => s + u.value, 0n), 'sats');
if (!utxos.length) throw new Error('No UTXOs');

const challenge = await provider.getChallenge();
const result = await factory.signConsolidatedInteraction({
    signer:      submitter.keypair,
    mldsaSigner: submitter.mldsaKeypair,
    network:     NETWORK,
    from:        submitter.p2tr,
    to:          pullAddr.toHex(),
    contract:    pullAddr.toHex(),
    calldata:    calldata.getBuffer(),
    utxos,
    challenge,
    feeRate:     60,
    priorityFee: 0n,
    gasSatFee:   10000n,
});

console.log('[quorum] Setup txid:', result.setupTxId);
console.log('[quorum] Reveal txid:', result.revealTxId);

const sr = await provider.sendRawTransaction(result.setupTransaction, false);
console.log('[quorum] Setup:', sr.success ? '✅' : '❌', sr.result ?? (sr as any).error);
if (!sr.success) throw new Error('Setup failed: ' + ((sr as any).error ?? sr.result));

await new Promise(r => setTimeout(r, 2000));

const rr = await provider.sendRawTransaction(result.revealTransaction, false);
console.log('[quorum] Reveal:', rr.success ? '✅' : '❌', rr.result ?? (rr as any).error);
if (!rr.success) throw new Error('Reveal failed: ' + ((rr as any).error ?? rr.result));

console.log('[quorum] ✅ Done! txid:', result.revealTxId);
console.log('[quorum] BTC/USD =', (priceData as any).bitcoin.usd, 'USD — quorum 3/3 signé');
