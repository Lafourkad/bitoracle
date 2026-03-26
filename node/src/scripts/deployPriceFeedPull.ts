/**
 * deployPriceFeedPull.ts — Deploy PriceFeedPull (pull oracle) contract
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JSONRpcProvider } from 'opnet';
import { TransactionFactory, Wallet } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '../..');
const NETWORK   = networks.opnetTestnet as any;
const RPC_URL   = process.env.OPNET_RPC_URL ?? 'https://testnet.opnet.org';

const dj        = JSON.parse(readFileSync(join(ROOT, 'keys/deployer.json'), 'utf8'));
const depFile   = join(ROOT, 'keys/deployment.json');
const dep       = JSON.parse(readFileSync(depFile, 'utf8'));

const wallet    = Wallet.fromWif(dj.schnorrPrivWIF, dj.quantumPrivHex, NETWORK);
const provider  = new JSONRpcProvider(RPC_URL, NETWORK, 60_000);
const factory   = new TransactionFactory();

const wasm = readFileSync(
    join(ROOT, '../contracts/build/PriceFeedPull.wasm')
);

console.log('[deploy PriceFeedPull] Wallet:', wallet.p2tr);

const r = await fetch(`${RPC_URL}/api/v1/address/utxos?address=${wallet.p2tr}&optimize=true`);
const data = await r.json();
const utxos = (data.confirmed as any[]).map((u: any) => ({
    transactionId: u.transactionId,
    outputIndex:   u.outputIndex,
    value:         BigInt(u.value),
    scriptPubKey:  u.scriptPubKey,
}));
console.log('UTXOs:', utxos.length, '— total:', utxos.reduce((s: bigint, u: any) => s + u.value, 0n), 'sats');
if (!utxos.length) throw new Error('No UTXOs');

const challenge = await provider.getChallenge();
const result = await factory.signDeployment({
    signer:      wallet.keypair,
    mldsaSigner: wallet.mldsaKeypair,
    network:     NETWORK,
    from:        wallet.p2tr,
    bytecode:    wasm,
    utxos,
    challenge,
    feeRate:     60,
    priorityFee: 0n,
    gasSatFee:   500n,
    revealMLDSAPublicKey:       true,
    linkMLDSAPublicKeyToAddress: true,
});

const [fundingHex, deployHex] = result.transaction;

const fr = await provider.sendRawTransaction(fundingHex, false);
console.log('Funding:', fr.success ? '✅' : '❌', fr.result ?? (fr as any).error);
if (!fr.success) throw new Error('Funding failed');

await new Promise(r => setTimeout(r, 2000));

const dr = await provider.sendRawTransaction(deployHex, false);
console.log('Deploy: ', dr.success ? '✅' : '❌', dr.result ?? (dr as any).error);
if (!dr.success) throw new Error('Deploy failed');

// Derive contract address from txid
const deployTxid = dr.result as string;
const contractAddr = result.contractAddress;

console.log('PriceFeedPull contract:', contractAddr);

dep.priceFeedPullAddress = contractAddr;
writeFileSync(depFile, JSON.stringify(dep, null, 2));
console.log('deployment.json updated ✅');
