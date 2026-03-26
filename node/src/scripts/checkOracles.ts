import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JSONRpcProvider } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
import { BinaryWriter } from '@btc-vision/transaction';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '../..');

const p        = new JSONRpcProvider('https://testnet.opnet.org', networks.opnetTestnet as any, 30000);
const dep      = JSON.parse(readFileSync(join(ROOT, 'keys/deployment.json'), 'utf8'));
const REGISTRY = dep.registryAddress as string;

function sel(sig: string): number {
    const h = createHash('sha256').update(sig).digest();
    return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
}

console.log('Registry:', REGISTRY);
console.log('Block:', await p.getBlockNumber());

for (const name of ['deployer', 'oracle1', 'oracle2']) {
    const oj = JSON.parse(readFileSync(join(ROOT, `keys/${name}.json`), 'utf8'));
    const qPub = Buffer.from(oj.quantumPubHex, 'hex');
    const hash  = createHash('sha256').update(qPub).digest();
    const addr  = new Uint8Array(hash);

    const wr = new BinaryWriter();
    wr.writeSelector(sel('isActive(address)'));
    wr.writeAddress(addr);
    const r   = await p.call(REGISTRY, Buffer.from(wr.getBuffer()));
    const raw = r.result ? Buffer.from((r.result as any).buffer.buffer).toString('hex') : (r.error ?? 'null');
    console.log(`${name}: ${raw === '01' ? 'isActive ✅' : 'NOT active ❌'} (${raw})`);
}
