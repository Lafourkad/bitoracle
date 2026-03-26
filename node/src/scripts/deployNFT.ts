/**
 * deployNFT.ts — Deploy OracleNodeNFT contract
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { JSONRpcProvider } from 'opnet';
import { TransactionFactory, Wallet } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT    = join(__dirname, '../..');
const NETWORK = networks.opnetTestnet as any;
const RPC_URL = process.env.OPNET_RPC_URL ?? 'https://testnet.opnet.org';

const provider = new JSONRpcProvider(RPC_URL, NETWORK, 60_000);
const factory  = new TransactionFactory();

const depKj   = JSON.parse(readFileSync(join(ROOT, 'keys/deployer.json'), 'utf8'));
const deployer = Wallet.fromWif(depKj.schnorrPrivWIF, depKj.quantumPrivHex, NETWORK);

const r    = await fetch(`${RPC_URL}/api/v1/address/utxos?address=${deployer.p2tr}&optimize=true`);
const data = await r.json() as any;
const utxos = (data.confirmed as any[]).map((u: any) => ({
    transactionId: u.transactionId,
    outputIndex:   u.outputIndex,
    value:         BigInt(u.value),
    scriptPubKey:  u.scriptPubKey,
}));
console.log('[deployNFT] UTXOs:', utxos.length, '—', utxos.reduce((s: bigint, u: any) => s + u.value, 0n), 'sats');
if (!utxos.length) throw new Error('No UTXOs');

const wasm = readFileSync(join(ROOT, '../contracts/build/OracleNodeNFT.wasm'));
console.log('[deployNFT] WASM:', wasm.length, 'bytes');

const challenge  = await provider.getChallenge();
const deployment = await factory.signDeployment({
    signer:      deployer.keypair,
    mldsaSigner: deployer.mldsaKeypair,
    network:     NETWORK,
    bytecode:    wasm,
    utxos,
    challenge,
    feeRate:     60,
    priorityFee: 0n,
    gasSatFee:   10000n,
    revealMLDSAPublicKey:        true,
    linkMLDSAPublicKeyToAddress: true,
});

console.log('[deployNFT] Contract address:', deployment.contractAddress);

const fr = await provider.sendRawTransaction(deployment.transaction[0], false);
console.log('[deployNFT] Funding:', fr.success ? '✅' : '❌', fr.result);
if (!fr.success) throw new Error('Funding failed');

await new Promise(r => setTimeout(r, 8000));

const dr = await provider.sendRawTransaction(deployment.transaction[1], false);
console.log('[deployNFT] Deploy:', dr.success ? '✅' : '❌', dr.result);
if (!dr.success) throw new Error('Deploy failed');

console.log('[deployNFT] ✅ OracleNodeNFT deployed:', deployment.contractAddress);

const depFile = join(ROOT, 'keys/deployment.json');
const dep = JSON.parse(readFileSync(depFile, 'utf8'));
dep.nftAddress = deployment.contractAddress;
writeFileSync(depFile, JSON.stringify(dep, null, 2));
console.log('[deployNFT] Saved nftAddress to deployment.json');
