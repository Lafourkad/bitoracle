/**
 * generateKeys.ts — Generate a fresh BitOracle node wallet
 *
 * Usage: node --import tsx/esm generateKeys.ts [--output keys.json]
 *
 * Output:
 *   - keys.json : private keys (keep secret!)
 *   - node.env  : ready-to-use env file for the daemon
 */

import { Wallet } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import { writeFileSync } from 'fs';
import * as wifLib from 'wif';

const NETWORK    = (networks as any).opnetTestnet;
const outputFile = process.argv.includes('--output')
    ? process.argv[process.argv.indexOf('--output') + 1]
    : 'keys.json';

console.log('🔑 Generating BitOracle node wallet...');

const wallet = await Wallet.generate(NETWORK);

// Extract keys
const schnorrPriv   = Buffer.from(wallet.keypair.privateKey);
const schnorrPubHex = Buffer.from(wallet.keypair.publicKey).toString('hex');
const xOnlyPubHex   = schnorrPubHex.slice(2); // remove 02/03 prefix → 32 bytes
const schnorrWIF    = wifLib.encode(0xEF, schnorrPriv, true); // testnet compressed WIF
const quantumPriv   = Buffer.from(wallet.mldsaKeypair._privateKey).toString('hex');
const address       = wallet.p2tr;

// Keys file (keep secret!)
const keys = {
    network:       'opnetTestnet',
    address,
    schnorrPubHex,
    xOnlyPubHex,
    schnorrPrivWIF: schnorrWIF,
    quantumPrivHex: quantumPriv,
    generatedAt:   new Date().toISOString(),
};

writeFileSync(outputFile, JSON.stringify(keys, null, 2));
console.log(`✅ Keys saved to ${outputFile}`);

// Env file for daemon
const deploymentInfo = {
    priceFeedMuSig2Address: 'opt1sqpaxrgxdlr2mmk9fmjyq5fjhh9epe4dva5m39wfq',
    oracleRegistryV4Address: 'opt1sqp0ce6tqqk3z4wwajgzufdm4vrwf234zjunljqkn',
    nftAddress: 'opt1sqzchetuzymeewfkj8et2hvm2pkjg2ctpksm3mtun',
};

const envContent = `# BitOracle Node Configuration
# Generated: ${new Date().toISOString()}
# ⚠️ Keep this file secret — it contains your private keys

NODE_ID=node-${address.slice(-8)}
NETWORK=testnet

# Your oracle keys (from keys.json)
SCHNORR_PRIV_WIF=${schnorrWIF}
QUANTUM_PRIV_HEX=${quantumPriv}

# Assets to track
ASSETS=BTC/USD

# P2P
P2P_PORT=7771
BOOTSTRAP_PEERS=

# API port
API_PORT=8080

# OpNet
OPNET_RPC_URL=https://testnet.opnet.org
REGISTRY_CONTRACT=${deploymentInfo.oracleRegistryV4Address}
PRICEFEED_CONTRACT=${deploymentInfo.priceFeedMuSig2Address}
NFT_CONTRACT=${deploymentInfo.nftAddress}

# Oracle behavior
DEVIATION=0.5
HEARTBEAT=10
MIN_QUORUM=2
INTERVAL_MS=30000
`;

writeFileSync('node.env', envContent);
console.log('✅ Daemon config saved to node.env');

console.log('');
console.log('─────────────────────────────────────────');
console.log('Your BitOracle node identity:');
console.log('  Address:    ', address);
console.log('  Public key: ', xOnlyPubHex);
console.log('─────────────────────────────────────────');
console.log('');
console.log('Next steps:');
console.log('  1. Fund your address with testnet BTC (faucet: https://testnet.opnet.org)');
console.log('  2. Mint a node NFT: node --import tsx/esm mintNFT.ts');
console.log('  3. Register your node: node --import tsx/esm registerNode.ts');
console.log('  4. Start the daemon: source node.env && node --import tsx/esm ../node/src/scripts/runDaemon.ts');
