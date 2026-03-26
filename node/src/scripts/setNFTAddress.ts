/**
 * setNFTAddress.ts — Link NFT contract to OracleRegistry v4
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { JSONRpcProvider } from 'opnet';
import { TransactionFactory, Wallet, BinaryWriter } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT    = join(__dirname, '../..');
const NETWORK = (networks as any).opnetTestnet;
const RPC_URL = 'https://testnet.opnet.org';

const provider = new JSONRpcProvider(RPC_URL, NETWORK, 60_000);
const factory  = new TransactionFactory();

const dep     = JSON.parse(readFileSync(join(ROOT, 'keys/deployment.json'), 'utf-8'));
const depKj   = JSON.parse(readFileSync(join(ROOT, 'keys/deployer.json'), 'utf-8'));
const deployer = Wallet.fromWif(depKj.schnorrPrivWIF, depKj.quantumPrivHex, NETWORK);

const REGISTRY = dep.oracleRegistryV4Address as string;
const NFT      = dep.nftAddress as string;
console.log('[setNFTAddress] Registry:', REGISTRY);
console.log('[setNFTAddress] NFT:', NFT);

// Selector: sha256('setNFTAddress(address)')[0:4]
const selHash = createHash('sha256').update('setNFTAddress(address)').digest();
const selector = ((selHash[0] << 24) | (selHash[1] << 16) | (selHash[2] << 8) | selHash[3]) >>> 0;
console.log('[setNFTAddress] Selector: 0x' + selector.toString(16).padStart(8, '0'));

// Get UTXOs
const r    = await fetch(`${RPC_URL}/api/v1/address/utxos?address=${deployer.p2tr}&optimize=true`);
const data = await r.json() as any;
const utxos = (data.confirmed as any[]).map((u: any) => ({
    transactionId: u.transactionId,
    outputIndex:   u.outputIndex,
    value:         BigInt(u.value),
    scriptPubKey:  u.scriptPubKey,
}));
console.log('[setNFTAddress] UTXOs:', utxos.length, '—', utxos.reduce((s: bigint, u: any) => s + u.value, 0n), 'sats');
if (!utxos.length) throw new Error('No UTXOs');

// Resolve registry + NFT contracts
const registryInfo = await provider.getPublicKeyInfo(REGISTRY, true);
const nftInfo      = await provider.getPublicKeyInfo(NFT, true);

console.log('[setNFTAddress] Registry pubkey:', registryInfo.toHex());
console.log('[setNFTAddress] NFT pubkey:', nftInfo.toHex());

// Build calldata: setNFTAddress(address)
const calldata = new BinaryWriter();
calldata.writeSelector(selector);
calldata.writeAddress(nftInfo);  // nftAddress param

console.log('[setNFTAddress] Calldata:', calldata.getBuffer().length, 'bytes');

const challenge = await provider.getChallenge();
const result = await factory.signConsolidatedInteraction({
    signer:      deployer.keypair,
    mldsaSigner: deployer.mldsaKeypair,
    network:     NETWORK,
    from:        deployer.p2tr,
    to:          registryInfo.toHex(),
    contract:    registryInfo.toHex(),
    calldata:    calldata.getBuffer(),
    utxos,
    challenge,
    feeRate:     60,
    priorityFee: 0n,
    gasSatFee:   10000n,
    revealMLDSAPublicKey:        false,
    linkMLDSAPublicKeyToAddress: false,
});

// Broadcast — signConsolidatedInteraction returns setupTransaction / revealTransaction
const sr = await provider.sendRawTransaction(result.setupTransaction, false);
console.log('[setNFTAddress] Setup:', sr.success ? '✅' : '❌', sr.result);
if (!sr.success) throw new Error('Setup failed');

await new Promise(r => setTimeout(r, 4000));

const rr = await provider.sendRawTransaction(result.revealTransaction, false);
console.log('[setNFTAddress] Reveal:', rr.success ? '✅' : '❌', rr.result);
if (!rr.success) throw new Error('Reveal failed');

console.log('[setNFTAddress] ✅ Done — NFT linked to OracleRegistry v4, txid:', result.revealTxId);
