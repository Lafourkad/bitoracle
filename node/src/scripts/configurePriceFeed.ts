/**
 * configurePriceFeed.ts — setAggPubKey + setTreasuryAddress + setFeeSats
 * Run after PriceFeedMuSig2 is indexed (~10 min post-deploy)
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { JSONRpcProvider } from 'opnet';
import { TransactionFactory, Wallet, BinaryWriter } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import { muSig2Sign, xOnlyPubKey } from '../musig2/MuSig2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT    = join(__dirname, '../..');
const NETWORK = (networks as any).opnetTestnet;
const RPC_URL = 'https://testnet.opnet.org';

const provider = new JSONRpcProvider(RPC_URL, NETWORK, 60_000);
const factory  = new TransactionFactory();
const dep      = JSON.parse(readFileSync(join(ROOT, 'keys/deployment.json'), 'utf-8'));
const depKj    = JSON.parse(readFileSync(join(ROOT, 'keys/deployer.json'), 'utf-8'));
const deployer = Wallet.fromWif(depKj.schnorrPrivWIF, depKj.quantumPrivHex, NETWORK);

const CONTRACT = dep.priceFeedMuSig2Address;
const TREASURY = deployer.p2tr; // testnet: deployer address

console.log('[config] PriceFeedMuSig2:', CONTRACT);
console.log('[config] Treasury:', TREASURY);

// Check indexed
const contractInfo = await provider.getPublicKeyInfo(CONTRACT, true).catch(() => null);
if (!contractInfo) {
    console.error('[config] ❌ Contract not indexed yet. Wait ~10 min and retry.');
    process.exit(1);
}
console.log('[config] ✅ Contract indexed');

// Derive aggPubKey
const oracles = ['deployer', 'oracle1', 'oracle2'].map(name => {
    const kj = JSON.parse(readFileSync(join(ROOT, `keys/${name}.json`), 'utf-8'));
    const w  = Wallet.fromWif(kj.schnorrPrivWIF, kj.quantumPrivHex, NETWORK);
    return { priv: w.keypair.privateKey as Uint8Array, pub: xOnlyPubKey(w.keypair.privateKey as Uint8Array) };
});
const dummyMsg = new Uint8Array(32).fill(1);
const { aggPubKey } = await muSig2Sign(oracles, dummyMsg);
const aggU256 = BigInt('0x' + Buffer.from(aggPubKey).toString('hex'));
console.log('[config] aggPubKey:', Buffer.from(aggPubKey).toString('hex'));

async function sendInteraction(label: string, selector: string, writeArgs: (c: BinaryWriter) => void) {
    const r    = await fetch(`${RPC_URL}/api/v1/address/utxos?address=${deployer.p2tr}&optimize=true`);
    const data = await r.json() as any;
    const utxos = (data.confirmed as any[]).map((u: any) => ({
        transactionId: u.transactionId, outputIndex: u.outputIndex,
        value: BigInt(u.value), scriptPubKey: u.scriptPubKey,
    }));
    if (!utxos.length) throw new Error(`No UTXOs for ${label}`);

    const selHash = createHash('sha256').update(selector).digest();
    const sel     = ((selHash[0] << 24) | (selHash[1] << 16) | (selHash[2] << 8) | selHash[3]) >>> 0;

    const calldata = new BinaryWriter();
    calldata.writeSelector(sel);
    writeArgs(calldata);

    const challenge = await provider.getChallenge();
    const result = await factory.signConsolidatedInteraction({
        signer: deployer.keypair, mldsaSigner: deployer.mldsaKeypair,
        network: NETWORK, from: deployer.p2tr,
        to: contractInfo.toHex(), contract: contractInfo.toHex(),
        calldata: calldata.getBuffer(), utxos, challenge,
        feeRate: 800, priorityFee: 0n, gasSatFee: 10000n,
    });

    const sr = await provider.sendRawTransaction(result.setupTransaction, false);
    console.log(`[config] ${label} setup:`, sr.success ? '✅' : '❌', JSON.stringify(sr));
    if (!sr.success) throw new Error(`${label} setup failed`);
    await new Promise(r => setTimeout(r, 4000));
    const rr = await provider.sendRawTransaction(result.revealTransaction, false);
    console.log(`[config] ${label} reveal:`, rr.success ? '✅' : '❌', rr.result);
    if (!rr.success) throw new Error(`${label} reveal failed`);
    await new Promise(r => setTimeout(r, 3000));
}

// 1. setAggPubKey — skip if already set (re-run safe)
const SKIP_AGG = process.env.SKIP_AGG === '1';
if (!SKIP_AGG) {
    await sendInteraction('setAggPubKey', 'setAggPubKey(uint256,uint256)', c => {
        c.writeU256(aggU256);
        c.writeU256(0n);
    });
}

// 2. setTreasuryAddress
const treasuryBytes = Buffer.from(TREASURY, 'utf-8');
await sendInteraction('setTreasuryAddress', 'setTreasuryAddress(string)', c => {
    c.writeU32(treasuryBytes.length);
    for (const b of treasuryBytes) c.writeU8(b);
});

// 3. setFeeSats (2000 sats testnet)
await sendInteraction('setFeeSats', 'setFeeSats(uint256)', c => {
    c.writeU256(2000n);
});

console.log('[config] ✅ PriceFeedMuSig2 fully configured');
console.log('[config] aggPubKey:', Buffer.from(aggPubKey).toString('hex'));
console.log('[config] treasury:', TREASURY);
console.log('[config] fee: 2000 sats');
