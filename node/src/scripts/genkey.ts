import { Mnemonic } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import * as bip39 from 'bip39';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const keysDir   = join(__dirname, '../../keys');
mkdirSync(keysDir, { recursive: true });

const phrase   = bip39.generateMnemonic(256);
const mnemonic = new Mnemonic(phrase, '', networks.opnetTestnet);
const wallet   = mnemonic.derive(0);

console.log('=== OpNet Deployer Wallet ===');
console.log('Mnemonic:  ', phrase);
console.log('Address:   ', wallet.p2tr);

writeFileSync(join(keysDir, 'deployer.json'), JSON.stringify({
    network:   'opnetTestnet',
    address:   wallet.p2tr,
    mnemonic:  phrase,
    schnorrPrivWIF: wallet.toWIF(),
    schnorrPubHex:  wallet.toPublicKeyHex(),
    quantumPrivHex: wallet.quantumPrivateKeyHex,
    quantumPubHex:  wallet.quantumPublicKeyHex,
}, null, 2));

console.log('\nFund this address with tBTC:', wallet.p2tr);
console.log('Faucet: https://faucet.opnet.org');
