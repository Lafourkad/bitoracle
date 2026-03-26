/**
 * addOracle.ts — Register an oracle via deployer addOracle() (no stake output needed)
 * Usage: node --import tsx/esm addOracle.ts oracle1
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { JSONRpcProvider } from 'opnet';
import { TransactionFactory, Wallet, BinaryWriter } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '../..');
const NETWORK   = networks.opnetTestnet as any;
const RPC_URL   = process.env.OPNET_RPC_URL ?? 'https://testnet.opnet.org';

const oracleName = process.argv[2] ?? 'oracle1';

const dj  = JSON.parse(readFileSync(join(ROOT, 'keys/deployer.json'), 'utf8'));
const dep = JSON.parse(readFileSync(join(ROOT, 'keys/deployment.json'), 'utf8'));
const oj  = JSON.parse(readFileSync(join(ROOT, `keys/${oracleName}.json`), 'utf8'));

const REGISTRY = dep.registryAddress as string;

const wallet   = Wallet.fromWif(dj.schnorrPrivWIF, dj.quantumPrivHex, NETWORK);
const provider = new JSONRpcProvider(RPC_URL, NETWORK, 60_000);
const factory  = new TransactionFactory();

function sel(sig: string): number {
    const h = createHash('sha256').update(sig).digest();
    return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
}

console.log(`[addOracle] Adding ${oracleName}: ${oj.address}`);
console.log(`[addOracle] Registry: ${REGISTRY}`);

// UTXOs
const r    = await fetch(`${RPC_URL}/api/v1/address/utxos?address=${wallet.p2tr}&optimize=true`);
const data = await r.json();
const utxos = (data.confirmed as any[]).map((u: any) => ({
    transactionId: u.transactionId,
    outputIndex:   u.outputIndex,
    value:         BigInt(u.value),
    scriptPubKey:  u.scriptPubKey,
}));
console.log('[addOracle] UTXOs:', utxos.length, '—', utxos.reduce((s: bigint, u: any) => s + u.value, 0n), 'sats');
if (!utxos.length) throw new Error('No UTXOs');

// Resolve registry address
const registryAddr = await provider.getPublicKeyInfo(REGISTRY, true);
console.log('[addOracle] Registry pubkey:', registryAddr.toHex());

// Oracle address = mldsaHashedPublicKey = sha256(mldsaPublicKey)
// BinaryWriter.writeAddress expects a Uint8Array of ≤32 bytes
const qPubKey    = Buffer.from(oj.quantumPubHex, 'hex');
const mldsaHash  = createHash('sha256').update(qPubKey).digest();
const oracleAddr = new Uint8Array(mldsaHash);
console.log('[addOracle] Oracle addr (mldsaHash):', Buffer.from(oracleAddr).toString('hex'));

// pubKeyLow / pubKeyHigh from quantum public key (first 64 bytes → two u256)
const pubKeyLow  = BigInt('0x' + qPubKey.slice(0, 32).toString('hex'));
const pubKeyHigh = BigInt('0x' + qPubKey.slice(32, 64).toString('hex'));

// addOracle(address, uint256, uint256) selector
const selector = sel('addOracle(address,uint256,uint256)');
console.log('[addOracle] Selector: 0x' + selector.toString(16).padStart(8, '0'));

const calldata = new BinaryWriter();
calldata.writeSelector(selector);
calldata.writeAddress(oracleAddr);
calldata.writeU256(pubKeyLow);
calldata.writeU256(pubKeyHigh);

const challenge = await provider.getChallenge();
const result = await factory.signInteraction({
    signer:      wallet.keypair,
    mldsaSigner: wallet.mldsaKeypair,
    network:     NETWORK,
    from:        wallet.p2tr,
    to:          registryAddr.toHex(),
    contract:    registryAddr.toHex(),
    calldata:    calldata.getBuffer(),
    utxos,
    challenge,
    feeRate:     1600,
    priorityFee: 0n,
    gasSatFee:   10000n,
});

if (result.fundingTransaction) {
    const fr = await provider.sendRawTransaction(result.fundingTransaction, false);
    console.log('[addOracle] Funding:', fr.success ? '✅' : '❌', fr.result ?? (fr as any).error);
    if (!fr.success) throw new Error('Funding failed: ' + ((fr as any).error ?? fr.result));
    // Wait longer for funding to propagate before sending interaction
    await new Promise(r => setTimeout(r, 8000));
}

const ir = await provider.sendRawTransaction(result.interactionTransaction, false);
console.log('[addOracle] Interaction:', ir.success ? '✅' : '❌', ir.result ?? (ir as any).error);
if (!ir.success) throw new Error('Interaction failed: ' + ((ir as any).error ?? ir.result));

console.log(`[addOracle] ✅ Done! ${oracleName} registered. txid:`, ir.result);
