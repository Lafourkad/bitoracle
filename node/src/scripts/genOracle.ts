/**
 * genOracle.ts — Generate a new oracle wallet
 * Usage: node --import tsx/esm genOracle.ts oracle1
 */
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Mnemonic } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import * as bip39 from 'bip39';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '../..');
const NETWORK   = networks.opnetTestnet as any;

const name    = process.argv[2] ?? 'oracle1';
const outFile = join(ROOT, `keys/${name}.json`);

if (existsSync(outFile)) {
    console.log(`[genOracle] ${outFile} already exists — skipping`);
    process.exit(0);
}

mkdirSync(join(ROOT, 'keys'), { recursive: true });

const phrase   = bip39.generateMnemonic(256);
const mnemonic = new Mnemonic(phrase, '', NETWORK);
const wallet   = mnemonic.derive(0);

const data = {
    name,
    network:        'opnetTestnet',
    address:        wallet.p2tr,
    mnemonic:       phrase,
    schnorrPrivWIF: wallet.toWIF(),
    schnorrPubHex:  wallet.toPublicKeyHex(),
    quantumPrivHex: wallet.quantumPrivateKeyHex,
    quantumPubHex:  wallet.quantumPublicKeyHex,
};

writeFileSync(outFile, JSON.stringify(data, null, 2));
console.log(`[genOracle] ✅ ${name} generated`);
console.log(`  address: ${data.address}`);
console.log(`  saved:   ${outFile}`);
