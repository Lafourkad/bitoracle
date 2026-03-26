/**
 * deploy.ts — Déploie OracleRegistry + PriceFeed sur OpNet testnet
 *
 * Usage:
 *   OPNET_RPC_URL=https://testnet.opnet.org \
 *   node --import tsx/esm src/scripts/deploy.ts
 *
 * Utilise automatiquement keys/deployer.json (généré par genkey.ts).
 * Peut aussi passer: DEPLOYER_PRIV_WIF=<wif>
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JSONRpcProvider } from 'opnet';
import {
    TransactionFactory,
    OPNetLimitedProvider,
    Wallet,
} from '@btc-vision/transaction';
import type { UTXO, FetchUTXOParams } from '@btc-vision/transaction';
import { networks, type Network as BtcNetwork } from '@btc-vision/bitcoin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '../..');

// ── Config ────────────────────────────────────────────────────────────────────

const RPC_URL = process.env.OPNET_RPC_URL ?? 'https://testnet.opnet.org';
const NETWORK = networks.opnetTestnet as BtcNetwork;

const deployerPath = join(ROOT, 'keys/deployer.json');
if (!existsSync(deployerPath)) {
    console.error('Run genkey.ts first: node --import tsx/esm src/scripts/genkey.ts');
    process.exit(1);
}
const deployerJson = JSON.parse(readFileSync(deployerPath, 'utf8'));

// ── Setup ─────────────────────────────────────────────────────────────────────

const wallet          = Wallet.fromWif(deployerJson.schnorrPrivWIF, deployerJson.quantumPrivHex, NETWORK);
const address         = wallet.p2tr;
const keypair         = wallet.keypair;
const mldsaSigner     = wallet.mldsaKeypair;
const provider        = new JSONRpcProvider(RPC_URL, NETWORK as any, 60_000);
const limitedProvider = new OPNetLimitedProvider(RPC_URL);
const factory         = new TransactionFactory();

console.log('[deploy] Network: testnet');
console.log('[deploy] Address:', address);
console.log('[deploy] RPC:    ', RPC_URL);
console.log();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchUTXOs(): Promise<UTXO[]> {
    const params: FetchUTXOParams = {
        address,
        minAmount:       1000n,
        requestedAmount: 200_000n,  // ~0.002 BTC to cover two deployments
        optimized:       true,
    };
    const utxos = await limitedProvider.fetchUTXO(params);
    if (!utxos.length) throw new Error(`No UTXOs for ${address}. Fund it first.`);
    const total = utxos.reduce((s: bigint, u: UTXO) => s + u.value, 0n);
    console.log(`[deploy] UTXOs: ${utxos.length} — total ${total} sats`);
    return utxos;
}

async function deployContract(
    name: string,
    wasmPath: string,
    utxos: UTXO[],
): Promise<{ contractAddress: string; txid: string; nextUTXOs: UTXO[] }> {
    const bytecode = readFileSync(wasmPath);
    console.log(`[deploy] Deploying ${name} (${bytecode.length} bytes)...`);

    const challenge = await provider.getChallenge();
    if (!challenge) throw new Error('Failed to fetch PoW challenge');

    const result = await factory.signDeployment({
        signer:                    keypair,
        mldsaSigner:               mldsaSigner,
        network:                   NETWORK,
        bytecode:                  new Uint8Array(bytecode),
        utxos,
        challenge,
        feeRate:                   5,
        priorityFee:               1000n,
        gasSatFee:                 500n,
        randomBytes:               crypto.getRandomValues(new Uint8Array(32)),
        revealMLDSAPublicKey:      true,
        linkMLDSAPublicKeyToAddress: true,
    });

    // DeploymentResult.transaction = [fundingTxHex, deploymentTxHex]
    const [fundingTx, deploymentTx] = result.transaction;

    console.log(`[deploy] Broadcasting funding tx...`);
    const fundRes = await provider.sendRawTransaction(fundingTx, false);
    console.log(`[deploy] Funding response:`, JSON.stringify(fundRes));
    if (!fundRes?.success) throw new Error(`Funding tx failed: ${JSON.stringify(fundRes)}`);

    await new Promise(r => setTimeout(r, 2000));

    console.log(`[deploy] Broadcasting deployment tx...`);
    const depRes = await provider.sendRawTransaction(deploymentTx, false);
    console.log(`[deploy] Deploy response:`, JSON.stringify(depRes));
    if (!depRes?.success) throw new Error(`Deployment tx failed: ${JSON.stringify(depRes)}`);

    const txid = depRes.result ?? depRes.identifier?.toString() ?? '?';
    console.log(`[deploy] ✅ ${name} → address: ${result.contractAddress}  txid: ${txid}\n`);

    return {
        contractAddress: result.contractAddress,
        txid,
        nextUTXOs: result.utxos,
    };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const utxos = await fetchUTXOs();

    // 1. Deploy OracleRegistry
    const registry = await deployContract(
        'OracleRegistry',
        join(ROOT, '../contracts/build/OracleRegistry.wasm'),
        utxos,
    );

    // Give mempool time to propagate
    await new Promise(r => setTimeout(r, 5000));

    // 2. Deploy PriceFeed — use next UTXOs if returned, else re-fetch
    const feedUTXOs = registry.nextUTXOs.length > 0 ? registry.nextUTXOs : await fetchUTXOs();
    const feed = await deployContract(
        'PriceFeed',
        join(ROOT, '../contracts/build/PriceFeed.wasm'),
        feedUTXOs,
    );

    // 3. Save results
    const deployment = {
        network:               'testnet',
        timestamp:             new Date().toISOString(),
        deployer:              address,
        oracleRegistryAddress: registry.contractAddress,
        oracleRegistryTxid:    registry.txid,
        priceFeedAddress:      feed.contractAddress,
        priceFeedTxid:         feed.txid,
    };

    const outPath = join(ROOT, 'keys/deployment.json');
    writeFileSync(outPath, JSON.stringify(deployment, null, 2));

    console.log('=== Deployment Complete ===');
    console.log('OracleRegistry:', registry.contractAddress);
    console.log('PriceFeed:     ', feed.contractAddress);
    console.log('Saved to:      ', outPath);
    console.log();
    console.log('Next step — link PriceFeed to OracleRegistry:');
    console.log(`  PRICE_FEED_ADDR=${feed.contractAddress} REGISTRY_ADDR=${registry.contractAddress}`);
    console.log('  node --import tsx/esm src/scripts/setRegistry.ts');
}

main().catch(err => {
    console.error('[deploy] Error:', err.message ?? err);
    process.exit(1);
});
