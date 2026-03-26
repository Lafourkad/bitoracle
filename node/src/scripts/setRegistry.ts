/**
 * setRegistry.ts — Lie PriceFeed à OracleRegistry via setRegistry(address)
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { JSONRpcProvider } from 'opnet';
import {
    TransactionFactory,
    OPNetLimitedProvider,
    Wallet,
    BinaryWriter,
    Address,
} from '@btc-vision/transaction';
import type { UTXO, FetchUTXOParams } from '@btc-vision/transaction';
import { networks, type Network as BtcNetwork } from '@btc-vision/bitcoin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '../..');
const NETWORK   = networks.opnetTestnet as BtcNetwork;
const RPC_URL   = process.env.OPNET_RPC_URL ?? 'https://testnet.opnet.org';

const deployerJson   = JSON.parse(readFileSync(join(ROOT, 'keys/deployer.json'), 'utf8'));
const deploymentJson = JSON.parse(readFileSync(join(ROOT, 'keys/deployment.json'), 'utf8'));

const wallet          = Wallet.fromWif(deployerJson.schnorrPrivWIF, deployerJson.quantumPrivHex, NETWORK);
const provider        = new JSONRpcProvider(RPC_URL, NETWORK as any, 60_000);
const limitedProvider = new OPNetLimitedProvider(RPC_URL);
const factory         = new TransactionFactory();

const PRICE_FEED_ADDR = deploymentJson.priceFeedAddress;
const REGISTRY_ADDR   = deploymentJson.oracleRegistryAddress;

// OpNet selector = first 4 bytes of sha256(methodSignature) as u32 BE
function selector(sig: string): number {
    const h = createHash('sha256').update(sig).digest();
    return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
}

async function main() {
    console.log('[setRegistry] PriceFeed:      ', PRICE_FEED_ADDR);
    console.log('[setRegistry] OracleRegistry: ', REGISTRY_ADDR);

    const params: FetchUTXOParams = {
        address:         wallet.p2tr,
        minAmount:       1000n,
        requestedAmount: 100_000n,
        optimized:       true,
    };
    const utxos: UTXO[] = await limitedProvider.fetchUTXO(params);
    console.log('[setRegistry] UTXOs:', utxos.length, '—', utxos.reduce((s, u) => s + u.value, 0n), 'sats');

    const challenge = await provider.getChallenge();
    if (!challenge) throw new Error('No challenge');

    // Résoudre les deux adresses via le provider
    console.log('[setRegistry] Resolving addresses...');
    const registryAddress  = await provider.getPublicKeyInfo(REGISTRY_ADDR, true);
    const priceFeedAddress = await provider.getPublicKeyInfo(PRICE_FEED_ADDR, true);
    console.log('[setRegistry] Registry pubkey: ', registryAddress.toHex());
    console.log('[setRegistry] PriceFeed pubkey:', priceFeedAddress.toHex());

    // Build calldata: selector(4) + address(32)
    const sel = selector('setRegistry(address)');
    console.log('[setRegistry] sel value:', sel, 'type:', typeof sel);
    const calldata = new BinaryWriter();
    calldata.writeSelector(sel >>> 0);  // force u32
    calldata.writeAddress(registryAddress);

    console.log('[setRegistry] Selector:', '0x' + sel.toString(16).padStart(8, '0'));

    const result = await factory.signInteraction({
        signer:      wallet.keypair,
        mldsaSigner: wallet.mldsaKeypair,
        network:     NETWORK,
        from:        wallet.p2tr,
        to:          priceFeedAddress.toHex(),
        contract:    priceFeedAddress.toHex(),
        calldata:    calldata.getBuffer(),
        utxos,
        challenge,
        feeRate:     150,
        priorityFee: 0n,
        gasSatFee:   330n,
    });

    if (result.fundingTransaction) {
        const r = await limitedProvider.broadcastTransaction(result.fundingTransaction, false);
        if (!r) throw new Error('Funding broadcast failed');
        console.log('[setRegistry] Funding tx sent');
        await new Promise(r => setTimeout(r, 2000));
    }

    const r2 = await limitedProvider.broadcastTransaction(result.interactionTransaction, false);
    if (!r2) throw new Error('Interaction broadcast failed');
    const txid = (r2 as any).txid ?? (r2 as any).result ?? JSON.stringify(r2);
    console.log('[setRegistry] ✅ Done! txid:', txid);
}

main().catch(e => { console.error('[setRegistry] Error:', e.message); process.exit(1); });
