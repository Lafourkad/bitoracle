import { JSONRpcProvider } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
import { BinaryWriter } from '@btc-vision/transaction';
import { createHash } from 'crypto';

const p        = new JSONRpcProvider('https://testnet.opnet.org', networks.opnetTestnet as any, 30000);
const REGISTRY = 'opt1sqqqfl7m6qp9stczt0tkyq7ehjp048xu935hly892';
const FEED     = 'opt1sqqp3cxu626kx7lwr2gtt58yaaug85tl6dqfzzxv7';
const DEPLOYER = 'opt1pc6k3ed9wlxr89q0rtymg95w7n3mx5u4q48jqpkltlex8v0t2xm9qf95tu8';

function sel(sig: string): number {
    const h = createHash('sha256').update(sig).digest();
    return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
}

const block = await p.getBlockNumber();
console.log('Block:', block);

// Essaie les deux versions d'adresse (isContract=false vs true)
for (const isContract of [false, true]) {
    const deployerAddr = await p.getPublicKeyInfo(DEPLOYER, isContract);
    console.log(`\nisContract=${isContract} pubkey: ${deployerAddr.toHex()}`);

    const wr = new BinaryWriter();
    wr.writeSelector(sel('isActive(address)'));
    wr.writeAddress(deployerAddr);
    const r = await p.call(REGISTRY, Buffer.from(wr.getBuffer()));
    const raw = Buffer.from((r.result as any).buffer.buffer).toString('hex');
    console.log(`  isActive: ${raw === '01' ? 'true ✅' : 'false ❌'} (raw: ${raw})`);
}

const deployerAddr = await p.getPublicKeyInfo(DEPLOYER, false);

// Test: getPrice(BTC/USD)
const assetBytes = Buffer.from('BTC/USD', 'utf8');
const wrPrice = new BinaryWriter();
wrPrice.writeSelector(sel('getPrice(bytes)'));
wrPrice.writeU32(assetBytes.length);
for (const b of assetBytes) wrPrice.writeU8(b);
const rPrice = await p.call(FEED, Buffer.from(wrPrice.getBuffer()));
console.log('\ngetPrice(BTC/USD):');
console.log('  raw result:', JSON.stringify(rPrice));
if (rPrice.revert) { console.log('  revert:', rPrice.revert); }
else if (rPrice.result) {
    const raw = Buffer.from((rPrice.result as any).buffer?.buffer ?? rPrice.result);
    const price = BigInt('0x' + raw.toString('hex').replace(/^0+/, '') || '0');
    console.log('  raw hex:', raw.toString('hex').slice(-16));
    console.log('  price:', price.toString(), 'cents →', (Number(price)/100).toFixed(2), 'USD ✅');
} else { console.log('  empty result — prix pas encore agrégé (1 oracle < quorum)'); }

// Test: getStake(deployer)
const wr2 = new BinaryWriter();
wr2.writeSelector(sel('getStake(address)'));
wr2.writeAddress(deployerAddr);
const r2 = await p.call(REGISTRY, Buffer.from(wr2.getBuffer()));
console.log('\ngetStake(deployer):');
if (r2.revert) { console.log('  revert:', r2.revert); }
else {
    const stakeRaw = Buffer.from((r2.result as any).buffer.buffer);
    console.log('  raw:', stakeRaw.toString('hex'));
    console.log('  sats:', BigInt('0x' + stakeRaw.toString('hex').replace(/^0+/, '') || '0'));
}
