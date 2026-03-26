/**
 * deployPriceFeedMuSig2.ts — Deploy PriceFeedMuSig2 + setAggPubKey
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

const r1   = await fetch(`${RPC_URL}/api/v1/address/utxos?address=${deployer.p2tr}&optimize=true`);
const d1   = await r1.json() as any;
const utxos1 = (d1.confirmed as any[]).map((u: any) => ({
    transactionId: u.transactionId, outputIndex: u.outputIndex,
    value: BigInt(u.value), scriptPubKey: u.scriptPubKey,
}));
console.log('[deployPFM] UTXOs:', utxos1.length, '—', utxos1.reduce((s: bigint, u: any) => s + u.value, 0n), 'sats');
if (!utxos1.length) throw new Error('No UTXOs');

const wasm = readFileSync(join(ROOT, '../contracts/build/PriceFeedMuSig2.wasm'));
console.log('[deployPFM] WASM:', wasm.length, 'bytes');

const challenge1 = await provider.getChallenge();
const deployment = await factory.signDeployment({
    signer: deployer.keypair, mldsaSigner: deployer.mldsaKeypair,
    network: NETWORK, bytecode: new Uint8Array(wasm),
    utxos: utxos1, challenge: challenge1,
    feeRate: 60, priorityFee: 0n, gasSatFee: 10000n,
    revealMLDSAPublicKey: true, linkMLDSAPublicKeyToAddress: true,
});

console.log('[deployPFM] Contract address:', deployment.contractAddress);

const fr = await provider.sendRawTransaction(deployment.transaction[0], false);
console.log('[deployPFM] Funding:', fr.success ? '✅' : '❌', fr.result);
if (!fr.success) throw new Error('Funding failed: ' + JSON.stringify(fr));

await new Promise(r => setTimeout(r, 8000));

const dr = await provider.sendRawTransaction(deployment.transaction[1], false);
console.log('[deployPFM] Deploy:', dr.success ? '✅' : '❌', dr.result);
if (!dr.success) throw new Error('Deploy failed');

// Update deployment.json
dep.priceFeedMuSig2Address = deployment.contractAddress;
writeFileSync(join(ROOT, 'keys/deployment.json'), JSON.stringify(dep, null, 2));
console.log('[deployPFM] ✅ PriceFeedMuSig2 deployed:', deployment.contractAddress);

// Wait for indexing then setAggPubKey
console.log('[deployPFM] Waiting 20s for indexing...');
await new Promise(r => setTimeout(r, 20000));

const oracles = ['deployer', 'oracle1', 'oracle2'].map(name => {
    const kj = JSON.parse(readFileSync(join(ROOT, `keys/${name}.json`), 'utf-8'));
    const w  = Wallet.fromWif(kj.schnorrPrivWIF, kj.quantumPrivHex, NETWORK);
    return { priv: w.keypair.privateKey as Uint8Array, pub: xOnlyPubKey(w.keypair.privateKey as Uint8Array) };
});
const dummyMsg = new Uint8Array(32).fill(1);
const { aggPubKey } = await muSig2Sign(oracles, dummyMsg);
const aggU256 = BigInt('0x' + Buffer.from(aggPubKey).toString('hex'));

const contractInfo = await provider.getPublicKeyInfo(deployment.contractAddress, true).catch(() => null);
if (!contractInfo) {
    console.log('[deployPFM] Not indexed yet — run setAggPubKey manually');
    process.exit(0);
}

const selHash  = createHash('sha256').update('setAggPubKey(uint256,uint256)').digest();
const selector = ((selHash[0] << 24) | (selHash[1] << 16) | (selHash[2] << 8) | selHash[3]) >>> 0;

const calldata = new BinaryWriter();
calldata.writeSelector(selector);
calldata.writeU256(aggU256);
calldata.writeU256(0n); // high = 0

const r2   = await fetch(`${RPC_URL}/api/v1/address/utxos?address=${deployer.p2tr}&optimize=true`);
const d2   = await r2.json() as any;
const utxos2 = (d2.confirmed as any[]).map((u: any) => ({
    transactionId: u.transactionId, outputIndex: u.outputIndex,
    value: BigInt(u.value), scriptPubKey: u.scriptPubKey,
}));
if (!utxos2.length) throw new Error('No UTXOs for setAggPubKey');

const challenge2 = await provider.getChallenge();
const result = await factory.signConsolidatedInteraction({
    signer: deployer.keypair, mldsaSigner: deployer.mldsaKeypair,
    network: NETWORK, from: deployer.p2tr,
    to: contractInfo.toHex(), contract: contractInfo.toHex(),
    calldata: calldata.getBuffer(), utxos: utxos2, challenge: challenge2,
    feeRate: 60, priorityFee: 0n, gasSatFee: 10000n,
});

const sr = await provider.sendRawTransaction(result.setupTransaction, false);
console.log('[deployPFM] setAggPubKey setup:', sr.success ? '✅' : '❌', sr.result);
if (!sr.success) { console.log('[deployPFM] Run setAggPubKey manually later'); process.exit(0); }
await new Promise(r => setTimeout(r, 4000));
const rr = await provider.sendRawTransaction(result.revealTransaction, false);
console.log('[deployPFM] setAggPubKey reveal:', rr.success ? '✅' : '❌', rr.result);

console.log('[deployPFM] ✅ Complete! Address:', deployment.contractAddress);
console.log('[deployPFM] aggPubKey:', Buffer.from(aggPubKey).toString('hex'));
