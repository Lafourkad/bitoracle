/**
 * registerOracle.ts — Enregistre le deployer comme oracle actif dans OracleRegistry
 *
 * Lit deployment.json + deployer.json, construit le calldata registerOracle(u256,u256,u256)
 * et soumet la tx via signInteraction.
 *
 * registerOracle(pubKeyLow: u256, pubKeyHigh: u256, stakeAmount: u256)
 *   - pubKeyLow/High: clé publique Schnorr 32 bytes splittée en 2x u256
 *   - stakeAmount: en sats, min 100 000
 *   - La tx DOIT avoir un output >= stakeAmount (vérifié par verifyStakeOutput)
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JSONRpcProvider } from 'opnet';
import { TransactionFactory, Wallet, BinaryWriter } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '../..');
const NETWORK   = networks.opnetTestnet as any;
const RPC_URL   = process.env.OPNET_RPC_URL ?? 'https://testnet.opnet.org';

const dj  = JSON.parse(readFileSync(join(ROOT, 'keys/deployer.json'), 'utf8'));
const dep = JSON.parse(readFileSync(join(ROOT, 'keys/deployment.json'), 'utf8'));

const REGISTRY_ADDR = dep.oracleRegistryAddress as string;
const STAKE_SATS    = 100_000n; // minimum requis

const wallet   = Wallet.fromWif(dj.schnorrPrivWIF, dj.quantumPrivHex, NETWORK);
const provider = new JSONRpcProvider(RPC_URL, NETWORK, 60_000);
const factory  = new TransactionFactory();

console.log('[registerOracle] Wallet:   ', wallet.p2tr);
console.log('[registerOracle] Registry: ', REGISTRY_ADDR);
console.log('[registerOracle] Stake:    ', STAKE_SATS, 'sats');

// UTXOs via REST
const r    = await fetch(`${RPC_URL}/api/v1/address/utxos?address=${wallet.p2tr}&optimize=true`);
const data = await r.json();
const utxos = (data.confirmed as any[]).map((u: any) => ({
    transactionId: u.transactionId,
    outputIndex:   u.outputIndex,
    value:         BigInt(u.value),
    scriptPubKey:  u.scriptPubKey,
}));
console.log('[registerOracle] UTXOs:', utxos.length, '—', utxos.reduce((s: bigint, u: any) => s + u.value, 0n), 'sats');
if (!utxos.length) throw new Error('No UTXOs');

// Résoudre l'adresse du registry
const registryAddr = await provider.getPublicKeyInfo(REGISTRY_ADDR, true);

// Sélecteur registerOracle(u256,u256,u256)
function sel(sig: string): number {
    const h = createHash('sha256').update(sig).digest();
    return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
}
// Le transform OPNet utilise uint256 (Solidity ABI style) pas u256
const selector = sel('registerOracle(uint256,uint256,uint256)');
console.log('[registerOracle] Selector:', '0x' + selector.toString(16).padStart(8, '0'));

// Clé publique Schnorr 32 bytes → split en 2x u256 (low = bytes 0-15, high = bytes 16-31)
// Dans notre contexte: pubKey = x-only (32 bytes). On encode low/high comme deux u256 BE 32 bytes
// Low  = premier 16 bytes padded à 32
// High = dernier 16 bytes padded à 32
// Alternativement: low = tout le pubkey en u256, high = 0 (assez pour identifier l'oracle)
const pubKeyBytes = Buffer.from(dj.schnorrPubHex, 'hex'); // 32 bytes x-only
console.log('[registerOracle] PubKey:', dj.schnorrPubHex);

// Encode pubKey as two u256: low = lower 16 bytes as u256, high = upper 16 bytes as u256
const pubLowBuf  = Buffer.alloc(32); pubKeyBytes.copy(pubLowBuf, 16, 16, 32); // bytes 16-31 → big end
const pubHighBuf = Buffer.alloc(32); pubKeyBytes.copy(pubHighBuf, 16, 0, 16);  // bytes 0-15 → big end

const pubKeyLow  = BigInt('0x' + pubLowBuf.toString('hex'));
const pubKeyHigh = BigInt('0x' + pubHighBuf.toString('hex'));

// Build calldata
const calldata = new BinaryWriter();
calldata.writeSelector(selector);
calldata.writeU256(pubKeyLow);
calldata.writeU256(pubKeyHigh);
calldata.writeU256(STAKE_SATS);

const challenge = await provider.getChallenge();

// signInteraction avec gasSatFee >= STAKE_SATS pour que l'output soit présent
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
    feeRate:     60,
    priorityFee: 0n,
    gasSatFee:   STAKE_SATS + 10_000n, // assure un output >= STAKE_SATS dans la tx
});

if (result.fundingTransaction) {
    const fr = await provider.sendRawTransaction(result.fundingTransaction, false);
    console.log('[registerOracle] Funding raw:', JSON.stringify(fr));
    if (!fr.success) throw new Error('Funding failed: ' + (fr.result ?? fr.error ?? JSON.stringify(fr)));
    console.log('[registerOracle] Funding tx:', fr.result);
    await new Promise(res => setTimeout(res, 8000));
}

const ir = await provider.sendRawTransaction(result.interactionTransaction, false);
console.log('[registerOracle] Interaction raw:', JSON.stringify(ir));
if (!ir.success) throw new Error('Interaction failed: ' + (ir.result ?? ir.error ?? JSON.stringify(ir)));
console.log('[registerOracle] ✅ Done! txid:', ir.result);
console.log('[registerOracle] Attends confirmation bloc puis vérifie isActive()');
