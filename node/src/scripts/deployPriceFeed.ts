import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JSONRpcProvider } from 'opnet';
import { TransactionFactory, Wallet } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT    = join(__dirname, '../..');
const NETWORK = networks.opnetTestnet as any;
const RPC_URL = process.env.OPNET_RPC_URL ?? 'https://testnet.opnet.org';

const dj      = JSON.parse(readFileSync(join(ROOT, 'keys/deployer.json'), 'utf8'));
const wallet  = Wallet.fromWif(dj.schnorrPrivWIF, dj.quantumPrivHex, NETWORK);
const provider = new JSONRpcProvider(RPC_URL, NETWORK, 60_000);
const factory  = new TransactionFactory();

console.log('[deploy PriceFeed] Wallet:', wallet.p2tr);

// Fetch UTXOs via REST (confirmed only)
const r    = await fetch(`${RPC_URL}/api/v1/address/utxos?address=${wallet.p2tr}&optimize=true`);
const data = await r.json();
const utxos = (data.confirmed as any[]).map((u: any) => ({
    transactionId: u.transactionId,
    outputIndex:   u.outputIndex,
    value:         BigInt(u.value),
    scriptPubKey:  u.scriptPubKey,
}));
console.log('UTXOs:', utxos.length, '— total:', utxos.reduce((s: bigint, u: any) => s + u.value, 0n), 'sats');
if (!utxos.length) throw new Error('No UTXOs');

const bytecode  = readFileSync(join(ROOT, '../contracts/build/PriceFeed.wasm'));
const challenge = await provider.getChallenge();

const result = await factory.signDeployment({
    signer:                      wallet.keypair,
    mldsaSigner:                 wallet.mldsaKeypair,
    network:                     NETWORK,
    bytecode:                    new Uint8Array(bytecode),
    utxos,
    challenge,
    feeRate:                     5,
    priorityFee:                 1000n,
    gasSatFee:                   500n,
    randomBytes:                 crypto.getRandomValues(new Uint8Array(32)),
    revealMLDSAPublicKey:        true,
    linkMLDSAPublicKeyToAddress: true,
});

const [fundTx, depTx] = result.transaction;
const fr = await provider.sendRawTransaction(fundTx, false);
console.log('Funding:', fr.success ? '✅' : '❌', fr.result);
if (!fr.success) throw new Error('Funding failed');

await new Promise(r => setTimeout(r, 2000));

const dr = await provider.sendRawTransaction(depTx, false);
console.log('Deploy: ', dr.success ? '✅' : '❌', dr.result);
if (!dr.success) throw new Error('Deploy failed');

console.log('PriceFeed contract:', result.contractAddress);

const dep = JSON.parse(readFileSync(join(ROOT, 'keys/deployment.json'), 'utf8'));
dep.priceFeedAddress = result.contractAddress;
dep.priceFeedTxid    = dr.result;
writeFileSync(join(ROOT, 'keys/deployment.json'), JSON.stringify(dep, null, 2));
console.log('deployment.json updated ✅');
