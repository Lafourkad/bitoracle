/**
 * submitPrice.ts — Soumet un prix signé au contrat PriceFeed
 *
 * Flow:
 *   1. Fetch prix BTC/USD depuis CoinGecko
 *   2. Signe sha256(asset_utf8 || price_u64be || blockNumber_u64be)
 *   3. Build calldata submitPrice(bytes,uint256,uint256,bytes)
 *   4. Broadcast via signInteraction
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { JSONRpcProvider } from 'opnet';
import { TransactionFactory, OPNetLimitedProvider, Wallet, BinaryWriter, MessageSigner } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '../..');
const NETWORK   = networks.opnetTestnet as any;
const RPC_URL   = process.env.OPNET_RPC_URL ?? 'https://testnet.opnet.org';
const ASSET     = process.env.ASSET ?? 'BTC/USD';

const dj  = JSON.parse(readFileSync(join(ROOT, 'keys/deployer.json'), 'utf8'));
const dep = JSON.parse(readFileSync(join(ROOT, 'keys/deployment.json'), 'utf8'));

const FEED_ADDR = dep.priceFeedAddress as string;

const wallet   = Wallet.fromWif(dj.schnorrPrivWIF, dj.quantumPrivHex, NETWORK);
const provider = new JSONRpcProvider(RPC_URL, NETWORK, 60_000);
const limProv  = new OPNetLimitedProvider(RPC_URL);
const factory  = new TransactionFactory();

// Selector: transform génère uint256 style
function sel(sig: string): number {
    const h = createHash('sha256').update(sig).digest();
    return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
}

// 1. Fetch block number
const blockNumber = await provider.getBlockNumber();
console.log('[submitPrice] Block:', blockNumber);

// 2. Fetch BTC/USD price
const priceResp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
const priceData = await priceResp.json();
const priceUsd  = Math.round((priceData as any).bitcoin.usd * 100); // cents
const priceU64  = BigInt(priceUsd);
console.log('[submitPrice] Price:', (priceData as any).bitcoin.usd, 'USD →', priceUsd, 'cents →', priceU64);
console.log('[submitPrice] Asset:', ASSET);

// 3. Build message hash: sha256(asset_utf8 || price_u64be || blockNumber_u64be)
const assetBytes = Buffer.from(ASSET, 'utf8');
const msgBuf     = Buffer.alloc(assetBytes.length + 16);
assetBytes.copy(msgBuf, 0);

const bNum = blockNumber;
const price = priceU64;

// price u64be
msgBuf.writeBigUInt64BE(price,  assetBytes.length);
// blockNumber u64be
msgBuf.writeBigUInt64BE(bNum, assetBytes.length + 8);

const msgHash = createHash('sha256').update(msgBuf).digest();
console.log('[submitPrice] MsgHash:', msgHash.toString('hex'));

// 4. Sign avec ML-DSA (quantum — ce que Blockchain.verifySignature attend avec ExtendedAddress)
const mldsaSigned = MessageSigner.signMLDSAMessage(wallet.mldsaKeypair, msgHash);
const signature   = mldsaSigned.signature;
console.log('[submitPrice] Signature (ML-DSA):', Buffer.from(signature).toString('hex').slice(0, 32) + '... len:', signature.length);

// 5. UTXOs via REST
const r    = await fetch(`${RPC_URL}/api/v1/address/utxos?address=${wallet.p2tr}&optimize=true`);
const data = await r.json();
const utxos = (data.confirmed as any[]).map((u: any) => ({
    transactionId: u.transactionId,
    outputIndex:   u.outputIndex,
    value:         BigInt(u.value),
    scriptPubKey:  u.scriptPubKey,
}));
console.log('[submitPrice] UTXOs:', utxos.length, '—', utxos.reduce((s: bigint, u: any) => s + u.value, 0n), 'sats');
if (!utxos.length) throw new Error('No UTXOs');

// 6. Résoudre l'adresse PriceFeed
const feedAddr = await provider.getPublicKeyInfo(FEED_ADDR, true);
console.log('[submitPrice] Feed pubkey:', feedAddr.toHex());

// 7. Build calldata: submitPrice(bytes,uint256,uint256,bytes)
//    bytes = u32 length + raw bytes
const selector = sel('submitPrice(bytes,uint256,uint256,bytes)');
console.log('[submitPrice] Selector:', '0x' + selector.toString(16).padStart(8, '0'));

const calldata = new BinaryWriter();
calldata.writeSelector(selector);

// asset: bytes (u32 len + data)
calldata.writeU32(assetBytes.length);
for (const b of assetBytes) calldata.writeU8(b);

// price: uint256
calldata.writeU256(price);

// blockNum: uint256
calldata.writeU256(bNum);

// signature: bytes (u32 len + data)
calldata.writeU32(signature.length);
for (const b of signature) calldata.writeU8(b);

// 8. signConsolidatedInteraction — bypass limite taille (ML-DSA sig = 2420 bytes)
const challenge = await provider.getChallenge();
const result = await factory.signConsolidatedInteraction({
    signer:      wallet.keypair,
    mldsaSigner: wallet.mldsaKeypair,
    network:     NETWORK,
    from:        wallet.p2tr,
    to:          feedAddr.toHex(),
    contract:    feedAddr.toHex(),
    calldata:    calldata.getBuffer(),
    utxos,
    challenge,
    feeRate:     60,
    priorityFee: 0n,
    gasSatFee:   500n,
});

console.log('[submitPrice] Setup txid:', result.setupTxId);
console.log('[submitPrice] Reveal txid:', result.revealTxId);

// 9. Broadcast setup
const sr = await provider.sendRawTransaction(result.setupTransaction, false);
console.log('[submitPrice] Setup:', sr.success ? '✅' : '❌', sr.result ?? (sr as any).error);
if (!sr.success) throw new Error('Setup failed: ' + ((sr as any).error ?? sr.result));

await new Promise(r => setTimeout(r, 2000));

// Broadcast reveal
const rr = await provider.sendRawTransaction(result.revealTransaction, false);
console.log('[submitPrice] Reveal:', rr.success ? '✅' : '❌', rr.result ?? (rr as any).error);
if (!rr.success) throw new Error('Reveal failed: ' + ((rr as any).error ?? rr.result));

console.log('[submitPrice] ✅ Done! txid:', result.revealTxId);
console.log('[submitPrice] Attends confirmation, puis appelle getPrice(BTC/USD)');
