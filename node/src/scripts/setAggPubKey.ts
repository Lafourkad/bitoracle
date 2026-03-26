/**
 * setAggPubKey.ts — Register MuSig2 aggregated public key in PriceFeedMuSig2
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import { JSONRpcProvider } from 'opnet';
import { TransactionFactory, Wallet, BinaryWriter } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import { u256 } from '@btc-vision/as-bignum/assembly';
import { keyAgg, xOnlyPubKey } from '../musig2/MuSig2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT    = join(__dirname, '../..');
const NETWORK = networks.opnetTestnet as any;
const RPC_URL = process.env.OPNET_RPC_URL ?? 'https://testnet.opnet.org';

const req = createRequire(import.meta.url);
const { MessageSigner } = req(join(__dirname, '../../node_modules/@btc-vision/transaction/build/keypair/MessageSigner.js'));

const provider = new JSONRpcProvider(RPC_URL, NETWORK, 60_000);
const factory  = new TransactionFactory();

const dep     = JSON.parse(readFileSync(join(ROOT, 'keys/deployment.json'), 'utf8'));
const depKj   = JSON.parse(readFileSync(join(ROOT, 'keys/deployer.json'),   'utf8'));
const deployer = Wallet.fromWif(depKj.schnorrPrivWIF, depKj.quantumPrivHex, NETWORK);

const CONTRACT = dep.priceFeedMuSig2Address as string;
console.log('[setAggPubKey] Contract:', CONTRACT);

// Recompute aggPubKey from 3 oracle wallets
const oraclePrivs = ['deployer', 'oracle1', 'oracle2'].map(name => {
    const kj = JSON.parse(readFileSync(join(ROOT, `keys/${name}.json`), 'utf8'));
    const w  = Wallet.fromWif(kj.schnorrPrivWIF, kj.quantumPrivHex, NETWORK);
    return w.keypair.privateKey as Uint8Array;
});
const xPubs  = oraclePrivs.map(p => xOnlyPubKey(p));
const agg    = keyAgg(xPubs);
const aggHex = Buffer.from(agg.X).toString('hex');
console.log('[setAggPubKey] aggPubKey:', aggHex);

// Encode as u256 (32 bytes BE)
const aggU256 = BigInt('0x' + aggHex);

// Selector for setAggPubKey(uint256,uint256)
const selHash = createHash('sha256').update('setAggPubKey(uint256,uint256)').digest();
const selector = ((selHash[0] << 24) | (selHash[1] << 16) | (selHash[2] << 8) | selHash[3]) >>> 0;
console.log('[setAggPubKey] Selector: 0x' + selector.toString(16).padStart(8, '0'));

// Build calldata: pubKeyLow = full 32-byte key as u256, pubKeyHigh = 0 (unused)
const calldata = new BinaryWriter();
calldata.writeSelector(selector);
calldata.writeU256(aggU256);  // pubKeyLow = the 32-byte aggPubKey
calldata.writeU256(0n);        // pubKeyHigh = 0

// Get UTXOs
const r    = await fetch(`${RPC_URL}/api/v1/address/utxos?address=${deployer.p2tr}&optimize=true`);
const data = await r.json() as any;
const utxos = (data.confirmed as any[]).map((u: any) => ({
    transactionId: u.transactionId,
    outputIndex:   u.outputIndex,
    value:         BigInt(u.value),
    scriptPubKey:  u.scriptPubKey,
}));
console.log('[setAggPubKey] UTXOs:', utxos.length, '—', utxos.reduce((s: bigint, u: any) => s + u.value, 0n), 'sats');
if (!utxos.length) throw new Error('No UTXOs');

const contractInfo = await provider.getPublicKeyInfo(CONTRACT, true);
const challenge    = await provider.getChallenge();

const result = await factory.signConsolidatedInteraction({
    signer:      deployer.keypair,
    mldsaSigner: deployer.mldsaKeypair,
    network:     NETWORK,
    from:        deployer.p2tr,
    to:          contractInfo.toHex(),
    contract:    contractInfo.toHex(),
    calldata:    calldata.getBuffer(),
    utxos,
    challenge,
    feeRate:     60,
    priorityFee: 0n,
    gasSatFee:   10000n,
});

const sr = await provider.sendRawTransaction(result.setupTransaction, false);
console.log('[setAggPubKey] Setup:', sr.success ? '✅' : '❌', sr.result);
if (!sr.success) throw new Error('Setup failed');

await new Promise(r => setTimeout(r, 2000));

const rr = await provider.sendRawTransaction(result.revealTransaction, false);
console.log('[setAggPubKey] Reveal:', rr.success ? '✅' : '❌', rr.result);
if (!rr.success) throw new Error('Reveal failed');

console.log('[setAggPubKey] ✅ Done! txid:', result.revealTxId);
console.log('[setAggPubKey] aggPubKey registered:', aggHex);
