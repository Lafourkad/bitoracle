/**
 * setTreasuryAddress.ts — Configure treasury BTC address in OracleNodeNFT
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

// Treasury = deployer p2tr for testnet (will be multisig on mainnet)
const TREASURY = deployer.p2tr;
const NFT      = dep.nftAddress;

console.log('[setTreasury] NFT:', NFT);
console.log('[setTreasury] Treasury:', TREASURY);

// Selector: sha256('setTreasuryAddress(string)')[0:4]
const selHash  = createHash('sha256').update('setTreasuryAddress(string)').digest();
const selector = ((selHash[0] << 24) | (selHash[1] << 16) | (selHash[2] << 8) | selHash[3]) >>> 0;
console.log('[setTreasury] Selector: 0x' + selector.toString(16).padStart(8, '0'));

const r    = await fetch(`${RPC_URL}/api/v1/address/utxos?address=${deployer.p2tr}&optimize=true`);
const data = await r.json() as any;
const utxos = (data.confirmed as any[]).map((u: any) => ({
    transactionId: u.transactionId, outputIndex: u.outputIndex,
    value: BigInt(u.value), scriptPubKey: u.scriptPubKey,
}));
if (!utxos.length) throw new Error('No UTXOs');
console.log('[setTreasury] UTXOs:', utxos.length);

const contractInfo = await provider.getPublicKeyInfo(NFT, true);

// Build calldata: writeStringWithLength
const addrBytes = Buffer.from(TREASURY, 'utf-8');
const calldata  = new BinaryWriter();
calldata.writeSelector(selector);
calldata.writeU32(addrBytes.length);
for (const b of addrBytes) calldata.writeU8(b);

const challenge = await provider.getChallenge();
const result = await factory.signConsolidatedInteraction({
    signer: deployer.keypair, mldsaSigner: deployer.mldsaKeypair,
    network: NETWORK, from: deployer.p2tr,
    to: contractInfo.toHex(), contract: contractInfo.toHex(),
    calldata: calldata.getBuffer(), utxos, challenge,
    feeRate: 60, priorityFee: 0n, gasSatFee: 10000n,
});

const sr = await provider.sendRawTransaction(result.setupTransaction, false);
console.log('[setTreasury] Setup:', sr.success ? '✅' : '❌', sr.result);
if (!sr.success) throw new Error('Setup failed');

await new Promise(r => setTimeout(r, 4000));

const rr = await provider.sendRawTransaction(result.revealTransaction, false);
console.log('[setTreasury] Reveal:', rr.success ? '✅' : '❌', rr.result);

console.log('[setTreasury] ✅ Treasury configured:', TREASURY);
