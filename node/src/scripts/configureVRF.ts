/**
 * configureVRF.ts — setAggPubKey on VRF contract
 */
import { readFileSync } from 'fs';
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

const VRF_ADDR = dep.vrfAddress;
if (!VRF_ADDR) throw new Error('vrfAddress not in deployment.json');

console.log('[configVRF] VRF contract:', VRF_ADDR);

const contractInfo = await provider.getPublicKeyInfo(VRF_ADDR, true).catch(() => null);
if (!contractInfo) {
    console.error('[configVRF] ❌ Contract not indexed yet');
    process.exit(1);
}
console.log('[configVRF] ✅ Contract indexed');

// Derive aggPubKey
const oracles = ['deployer', 'oracle1', 'oracle2'].map(name => {
    const kj = JSON.parse(readFileSync(join(ROOT, `keys/${name}.json`), 'utf-8'));
    const w  = Wallet.fromWif(kj.schnorrPrivWIF, kj.quantumPrivHex, NETWORK);
    return { priv: w.keypair.privateKey as Uint8Array, pub: xOnlyPubKey(w.keypair.privateKey as Uint8Array) };
});
const dummyMsg = new Uint8Array(32).fill(1);
const { aggPubKey } = await muSig2Sign(oracles, dummyMsg);
const aggU256 = BigInt('0x' + Buffer.from(aggPubKey).toString('hex'));
console.log('[configVRF] aggPubKey:', Buffer.from(aggPubKey).toString('hex'));

// Fetch UTXOs
const r    = await fetch(`${RPC_URL}/api/v1/address/utxos?address=${deployer.p2tr}&optimize=true`);
const data = await r.json() as any;
const utxos = (data.confirmed as any[]).map((u: any) => ({
    transactionId: u.transactionId, outputIndex: u.outputIndex,
    value: BigInt(u.value), scriptPubKey: u.scriptPubKey,
}));
if (!utxos.length) throw new Error('No UTXOs');
console.log('[configVRF] UTXOs:', utxos.length);

// Build calldata: setAggPubKey(uint256)
const selHash  = createHash('sha256').update('setAggPubKey(uint256)').digest();
const selector = ((selHash[0] << 24) | (selHash[1] << 16) | (selHash[2] << 8) | selHash[3]) >>> 0;

const calldata = new BinaryWriter();
calldata.writeSelector(selector);
calldata.writeU256(aggU256);

const challenge = await provider.getChallenge();
const result = await factory.signConsolidatedInteraction({
    signer: deployer.keypair, mldsaSigner: deployer.mldsaKeypair,
    network: NETWORK, from: deployer.p2tr,
    to: contractInfo.toHex(), contract: contractInfo.toHex(),
    calldata: calldata.getBuffer(), utxos, challenge,
    feeRate: 2500, priorityFee: 0n, gasSatFee: 10000n,
});

const sr = await provider.sendRawTransaction(result.setupTransaction, false);
console.log('[configVRF] Setup:', sr.success ? '✅' : '❌', sr.success ? sr.result : sr.error);
if (!sr.success) process.exit(1);

await new Promise(r => setTimeout(r, 4000));

const rr = await provider.sendRawTransaction(result.revealTransaction, false);
console.log('[configVRF] Reveal:', rr.success ? '✅' : '❌', rr.success ? rr.result : rr.error);

if (rr.success) {
    console.log('[configVRF] ✅ VRF aggPubKey configured');
}
