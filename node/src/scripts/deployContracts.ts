/**
 * deployContracts.ts — Redeploy OracleRegistry + OracleNodeNFT (post-audit versions)
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JSONRpcProvider } from 'opnet';
import { TransactionFactory, Wallet } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '../..');
const NETWORK   = (networks as any).opnetTestnet;
const RPC_URL   = 'https://testnet.opnet.org';

const provider = new JSONRpcProvider(RPC_URL, NETWORK, 60_000);
const factory  = new TransactionFactory();
const dep      = JSON.parse(readFileSync(join(ROOT, 'keys/deployment.json'), 'utf-8'));
const depKj    = JSON.parse(readFileSync(join(ROOT, 'keys/deployer.json'), 'utf-8'));
const deployer = Wallet.fromWif(depKj.schnorrPrivWIF, depKj.quantumPrivHex, NETWORK);

async function deployContract(name: string, wasmPath: string, feeRate: number = 2500): Promise<string> {
    const wasm = readFileSync(wasmPath);
    console.log(`\n[deploy] ${name} — ${wasm.length} bytes`);

    const r    = await fetch(`${RPC_URL}/api/v1/address/utxos?address=${deployer.p2tr}&optimize=true`);
    const data = await r.json() as any;
    const utxos = (data.confirmed as any[]).map((u: any) => ({
        transactionId: u.transactionId, outputIndex: u.outputIndex,
        value: BigInt(u.value), scriptPubKey: u.scriptPubKey,
    }));
    if (!utxos.length) throw new Error(`No UTXOs for ${name}`);
    console.log(`[deploy] UTXOs: ${utxos.length}, sats: ${utxos.reduce((s: bigint, u: any) => s + u.value, 0n)}`);

    const challenge = await provider.getChallenge();
    const deployment = await factory.signDeployment({
        signer: deployer.keypair, mldsaSigner: deployer.mldsaKeypair,
        network: NETWORK, bytecode: new Uint8Array(wasm),
        utxos, challenge,
        feeRate, priorityFee: 0n, gasSatFee: 10000n,
        revealMLDSAPublicKey: true, linkMLDSAPublicKeyToAddress: true,
    });

    console.log(`[deploy] ${name} address: ${deployment.contractAddress}`);

    const fr = await provider.sendRawTransaction(deployment.transaction[0], false);
    console.log(`[deploy] ${name} funding:`, fr.success ? '✅' : '❌', fr.success ? fr.result : fr.error);
    if (!fr.success) throw new Error(`${name} funding failed`);

    await new Promise(r => setTimeout(r, 8000));

    const dr = await provider.sendRawTransaction(deployment.transaction[1], false);
    console.log(`[deploy] ${name} deploy:`, dr.success ? '✅' : '❌', dr.success ? dr.result : dr.error);
    if (!dr.success) throw new Error(`${name} deploy failed`);

    console.log(`[deploy] ✅ ${name} deployed: ${deployment.contractAddress}`);
    return deployment.contractAddress;
}

// Deploy OracleRegistry first
const registryAddr = await deployContract(
    'OracleRegistry',
    join(ROOT, '../contracts/build/OracleRegistry.wasm')
);

// Update deployment.json
dep.oracleRegistryV4Address = registryAddr;
writeFileSync(join(ROOT, 'keys/deployment.json'), JSON.stringify(dep, null, 2));

// Wait for block
console.log('\n[deploy] Waiting 15s...');
await new Promise(r => setTimeout(r, 15000));

// Deploy OracleNodeNFT
const nftAddr = await deployContract(
    'OracleNodeNFT',
    join(ROOT, '../contracts/build/OracleNodeNFT.wasm')
);

dep.nftAddress = nftAddr;
writeFileSync(join(ROOT, 'keys/deployment.json'), JSON.stringify(dep, null, 2));

console.log('\n════════════════════════════════════════════════════════');
console.log('✅ Contracts deployed (post-audit)');
console.log('  OracleRegistry:', registryAddr);
console.log('  OracleNodeNFT: ', nftAddr);
console.log('════════════════════════════════════════════════════════');
console.log('\nNext: setNFTAddress on registry, setTreasuryAddress on NFT');
