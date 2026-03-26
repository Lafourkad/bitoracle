/**
 * Key generation script — bootstrap threshold ML-DSA shares for oracle nodes.
 *
 * Two modes:
 *   1. Solo (trusted dealer): generates all N shares locally, saves each to a file.
 *      Use for dev/single-node testing.
 *   2. DKG ceremony (distributed): 4-phase protocol, each party runs on their own machine.
 *      Use for production multi-party setup.
 *
 * Usage:
 *   node --import tsx/esm src/scripts/keygen.ts --mode=solo --threshold=2 --parties=3
 *   node --import tsx/esm src/scripts/keygen.ts --mode=dkg --party=1 --threshold=2 --parties=3
 */

import { writeFileSync, mkdirSync } from 'fs';
import { createCipheriv, randomBytes, pbkdf2Sync } from 'crypto';
import { ThresholdMLDSA } from '@btc-vision/post-quantum/threshold-ml-dsa.js';

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = Object.fromEntries(
    process.argv.slice(2).map(a => {
        const [k, v] = a.replace('--', '').split('=');
        return [k, v ?? 'true'];
    }),
);

const MODE = (args['mode'] ?? 'solo') as 'solo' | 'dkg';
const THRESHOLD = parseInt(args['threshold'] ?? '2');
const PARTIES = parseInt(args['parties'] ?? '3');
const PARTY_ID = parseInt(args['party'] ?? '1');
const LEVEL = 44; // ML-DSA-44 (FIPS 204 Level 2)
const OUTPUT_DIR = args['out'] ?? './keys';

// ─── Encryption helpers ───────────────────────────────────────────────────────

function encryptShare(shareJson: string, password: string): string {
    const salt = randomBytes(32);
    const iv = randomBytes(12);
    const key = pbkdf2Sync(password, salt, 600_000, 32, 'sha256');
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(shareJson, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return JSON.stringify({
        v: 1,
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        data: encrypted.toString('hex'),
    });
}

// ─── Solo mode (trusted dealer) ───────────────────────────────────────────────

async function soloKeygen(): Promise<void> {
    console.log(`\n[keygen] Solo mode — T=${THRESHOLD} of N=${PARTIES} (ML-DSA-${LEVEL})`);
    console.log('[keygen] WARNING: Trusted dealer generates all shares. Use DKG for production.\n');

    const instance = ThresholdMLDSA.create(LEVEL, THRESHOLD, PARTIES);
    const result = instance.keygen();

    console.log(`[keygen] Public key: ${Buffer.from(result.publicKey).toString('hex').slice(0, 32)}...`);
    console.log(`[keygen] Generated ${result.shares.length} shares\n`);

    mkdirSync(OUTPUT_DIR, { recursive: true });

    // Ask for password (or use env var in CI)
    const password = process.env['SHARE_PASSWORD'] ?? 'dev-insecure-password';
    if (!process.env['SHARE_PASSWORD']) {
        console.warn('[keygen] WARNING: Using default password. Set SHARE_PASSWORD env var for real keys.\n');
    }

    for (let i = 0; i < result.shares.length; i++) {
        const partyId = i + 1;
        const share = result.shares[i];

        // Build DecryptedShare format (compatible with Otzi's share-crypto.ts)
        const decryptedShare = {
            partyId,
            threshold: THRESHOLD,
            parties: PARTIES,
            level: LEVEL,
            publicKey: Buffer.from(result.publicKey).toString('hex'),
            keyShare: share,
        };

        const shareJson = JSON.stringify(decryptedShare);
        const encrypted = encryptShare(shareJson, password);

        const filename = `${OUTPUT_DIR}/oracle-share-${partyId}-of-${PARTIES}.json`;
        writeFileSync(filename, encrypted);
        console.log(`[keygen] Party ${partyId}: saved → ${filename}`);
    }

    // Save public key separately (needed by OracleRegistry contract)
    const pubkeyFile = `${OUTPUT_DIR}/oracle-pubkey.hex`;
    writeFileSync(pubkeyFile, Buffer.from(result.publicKey).toString('hex'));
    console.log(`\n[keygen] Public key saved → ${pubkeyFile}`);
    console.log('[keygen] Register this public key in OracleRegistry when deploying contracts.\n');
    console.log('[keygen] Done ✅');
}

// ─── DKG mode (distributed) ───────────────────────────────────────────────────

async function dkgKeygen(): Promise<void> {
    // DKG requires 4 phases of blob exchange between parties.
    // In production this runs via P2P or Otzi relay.
    // This script handles a single party's perspective.
    console.log(`\n[keygen] DKG mode — party ${PARTY_ID}, T=${THRESHOLD} of N=${PARTIES}`);
    console.log('[keygen] DKG ceremony not yet automated — use Otzi PERMAFROST Vault UI for now.');
    console.log('[keygen] https://github.com/mwaddip/otzi\n');
    process.exit(0);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

if (MODE === 'solo') {
    soloKeygen().catch(console.error);
} else {
    dkgKeygen().catch(console.error);
}
