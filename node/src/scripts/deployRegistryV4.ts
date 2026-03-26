/**
 * deployRegistryV4.ts — Deploy OracleRegistry v4 (NFT integration)
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JSONRpcProvider } from 'opnet';
import { TransactionFactory, Wallet } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT    = join(__dirname, '../..');
const NETWORK = (networks as any).opnetTestnet;
const RPC_URL = process.env.OPNET_RPC_URL ?? 'https://testnet.opnet.org';

const provider = new JSONRpcProvider(RPC_URL, NETWORK, 60_000);
const factory  = new TransactionFactory();

const depKj   = JSON.parse(readFileSync(join(ROOT, 'keys/deployer.json'), 'utf-8'));
const deployer = Wallet.fromWif(depKj.schnorrPrivWIF, depKj.quantumPrivHex, NETWORK);

async function main() {
    const r    = await fetch(`${RPC_URL}/api/v1/address/utxos?address=${deployer.p2tr}&optimize=true`);
    const data = await r.json() as any;
    const utxos = (data.confirmed as any[]).map((u: any) => ({
        transactionId: u.transactionId,
        outputIndex:   u.outputIndex,
        value:         BigInt(u.value),
        scriptPubKey:  u.scriptPubKey,
    }));
    console.log('[deployRegistryV4] UTXOs:', utxos.length, '—', utxos.reduce((s: bigint, u: any) => s + u.value, 0n), 'sats');
    if (!utxos.length) throw new Error('No UTXOs');

    const wasm = readFileSync(join(ROOT, '../contracts/build/OracleRegistry.wasm'));
    console.log('[deployRegistryV4] WASM:', wasm.length, 'bytes');

    const challenge  = await provider.getChallenge();
    const deployment = await factory.signDeployment({
        signer:      deployer.keypair,
        mldsaSigner: deployer.mldsaKeypair,
        network:     NETWORK,
        bytecode:    new Uint8Array(wasm),
        utxos,
        challenge,
        feeRate:     60,
        priorityFee: 0n,
        gasSatFee:   10000n,
        revealMLDSAPublicKey:        true,
        linkMLDSAPublicKeyToAddress: true,
    });

    console.log('[deployRegistryV4] Contract address:', deployment.contractAddress);

    const fr = await provider.sendRawTransaction(deployment.transaction[0], false);
    console.log('[deployRegistryV4] Funding:', fr.success ? '✅' : '❌', fr.result);
    if (!fr.success) throw new Error('Funding failed');

    await new Promise(r => setTimeout(r, 8000));

    const dr = await provider.sendRawTransaction(deployment.transaction[1], false);
    console.log('[deployRegistryV4] Deploy:', dr.success ? '✅' : '❌', dr.result);
    if (!dr.success) throw new Error('Deploy failed');

    console.log('[deployRegistryV4] ✅ OracleRegistry v4 deployed:', deployment.contractAddress);

    // Update deployment.json
    const deploymentPath = join(ROOT, 'keys/deployment.json');
    const dep = JSON.parse(readFileSync(deploymentPath, 'utf-8'));
    dep.oracleRegistryV4Address = deployment.contractAddress;
    dep.oracleRegistryV4Txid = dr.result;
    writeFileSync(deploymentPath, JSON.stringify(dep, null, 2));
    console.log('[deployRegistryV4] Saved to deployment.json');
}

main().catch(console.error);
