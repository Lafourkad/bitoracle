/**
 * MuSig2 — n-of-n threshold Schnorr signature (BIP-327 / BIP-340)
 *
 * Output: 64-byte Schnorr signature verifiable by standard BIP-340 verifier.
 * All n signers required.
 *
 * Algorithm:
 *   1. Key agg: a_i = H(L || X_i), Q = sum(a_i * X_i), negate if Q.y odd
 *   2. Nonce: each signer generates k_i, R_i = k_i * G
 *   3. Agg nonce: R = sum(R_i), negate all k_i if R.y odd
 *   4. Challenge: e = H_BIP340("BIP0340/challenge", R.x || Q.x || msg)
 *   5. Partial: s_i = k_i + e * a_i * x_i
 *      - x_i negated if X_i.y is odd (BIP-340 key normalization)
 *      - x_i further negated if Q was negated (gacc = -1)
 *   6. Aggregate: s = sum(s_i), sig = (R.x || s)
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHash, createHmac, randomBytes } from 'crypto';

const req = createRequire(import.meta.url);
const { secp256k1, schnorr } = req(
    join(dirname(fileURLToPath(import.meta.url)),
    '../../node_modules/@noble/curves/secp256k1.js')
);

const Pt = secp256k1.Point;
const N  = Pt.Fn.ORDER as bigint;

// ── Helpers ───────────────────────────────────────────────────────────────────

function mod(a: bigint): bigint      { return ((a % N) + N) % N; }
function bn(b: Uint8Array): bigint   { return BigInt('0x' + Buffer.from(b).toString('hex')); }
function b32(n: bigint): Uint8Array  { return Buffer.from(n.toString(16).padStart(64, '0'), 'hex'); }

/** BIP-340 tagged hash */
function tagHash(tag: string, ...parts: Uint8Array[]): Uint8Array {
    const t = createHash('sha256').update(tag, 'utf8').digest();
    const h = createHash('sha256');
    h.update(t); h.update(t);
    for (const p of parts) h.update(p);
    return h.digest();
}

// ── Key Aggregation ───────────────────────────────────────────────────────────

export interface AggKey {
    X:     Uint8Array;  // aggregated x-only pubkey (32 bytes)
    coefs: bigint[];    // a_i per signer
    gacc:  bigint;      // +1 or N-1 (= -1 mod N) depending on Q negation
}

/**
 * Aggregate n x-only public keys (32 bytes each) into a single MuSig2 key.
 */
export function keyAgg(xPubs: Uint8Array[]): AggKey {
    // L = H(X_1 || ... || X_n)
    const Lh = createHash('sha256');
    for (const x of xPubs) Lh.update(x);
    const L = Lh.digest();

    const coefs: bigint[] = [];
    let Q = Pt.ZERO;

    for (const x of xPubs) {
        const a = mod(bn(tagHash('KeyAgg coefficient', L, x)));
        coefs.push(a);
        // Lift x to even-Y point (BIP-340 convention)
        const Xi = Pt.fromHex('02' + Buffer.from(x).toString('hex'));
        Q = Q.add(Xi.multiply(a));
    }

    // Normalize Q to even Y
    let gacc = 1n;
    if (Q.y % 2n !== 0n) {
        Q    = Q.negate();
        gacc = mod(N - 1n); // effectively -1
    }

    return { X: b32(Q.x), coefs, gacc };
}

// ── Nonce ─────────────────────────────────────────────────────────────────────

export interface Nonce {
    k: bigint;      // secret scalar (keep private)
    R: Uint8Array;  // public nonce point — 33 bytes compressed
}

/**
 * Generate a signing nonce.
 * When privKey + msg are provided, uses HMAC-SHA256(privKey, msg || rand)
 * for determinism with additional randomness — per BIP-340 recommendation.
 * Prevents nonce reuse even on retry.
 */
export function nonceGen(privKey?: Uint8Array, msg?: Uint8Array): Nonce {
    let kBytes: Buffer;
    if (privKey && msg) {
        // Deterministic with extra randomness: HMAC-SHA256(privKey, msg || rand32)
        const rand = randomBytes(32);
        const data = Buffer.concat([msg, rand]);
        kBytes = createHmac('sha256', privKey).update(data).digest();
    } else {
        kBytes = randomBytes(32);
    }
    const k = mod(bn(kBytes));
    const R = Pt.BASE.multiply(k === 0n ? 1n : k).toBytes(true) as Uint8Array;
    return { k: k === 0n ? 1n : k, R };
}

// ── Partial Sign ──────────────────────────────────────────────────────────────

/**
 * Compute partial signature for signer at index `idx`.
 *
 * @param priv    - 32-byte private key (raw scalar)
 * @param nonce   - this signer's nonce
 * @param idx     - this signer's index in xPubs / allNonces
 * @param agg     - aggregated key info
 * @param allNonces - all signers' public nonces (33 bytes each)
 * @param msg     - 32-byte message hash
 */
export function partialSign(
    priv:      Uint8Array,
    nonce:     Nonce,
    idx:       number,
    agg:       AggKey,
    allNonces: Uint8Array[],
    msg:       Uint8Array,
): bigint {
    // Aggregate nonces
    let Ragg = Pt.ZERO;
    for (const rn of allNonces) Ragg = Ragg.add(Pt.fromHex(Buffer.from(rn).toString('hex')));

    // Negate k if R has odd Y
    let k = nonce.k;
    if (Ragg.y % 2n !== 0n) {
        k    = mod(N - k);
        Ragg = Ragg.negate();
    }

    const Rx = b32(Ragg.x);

    // BIP-340 challenge
    const e = mod(bn(tagHash('BIP0340/challenge', Rx, agg.X, msg)));

    // Effective private key:
    // 1. BIP-340 normalization: negate x_i if X_i.y is odd
    let x = mod(bn(priv));
    const Xi_full = Pt.BASE.multiply(x);
    if (Xi_full.y % 2n !== 0n) x = mod(N - x);

    // 2. Group negation: if Q was negated, negate x_i
    if (agg.gacc !== 1n) x = mod(N - x);

    const a = agg.coefs[idx];

    // s_i = k_i + e * a_i * x_i
    return mod(k + e * a * x);
}

// ── Aggregate Partial Sigs ────────────────────────────────────────────────────

export function aggSigs(partials: bigint[], allNonces: Uint8Array[]): Uint8Array {
    let s = 0n;
    for (const si of partials) s = mod(s + si);

    // Reconstruct R
    let Ragg = Pt.ZERO;
    for (const rn of allNonces) Ragg = Ragg.add(Pt.fromHex(Buffer.from(rn).toString('hex')));
    if (Ragg.y % 2n !== 0n) Ragg = Ragg.negate();

    const sig = new Uint8Array(64);
    sig.set(b32(Ragg.x), 0);
    sig.set(b32(s), 32);
    return sig;
}

// ── High-level API ────────────────────────────────────────────────────────────

export interface Signer {
    priv: Uint8Array; // 32-byte raw private key
    pub:  Uint8Array; // 32-byte x-only public key
}

/**
 * Full MuSig2 n-of-n signing.
 * Returns 64-byte BIP-340 Schnorr signature + aggregated public key (32 bytes).
 */
export async function muSig2Sign(
    signers: Signer[],
    msg:     Uint8Array,
): Promise<{ signature: Uint8Array; aggPubKey: Uint8Array }> {
    const xPubs = signers.map(s => s.pub);
    const agg   = keyAgg(xPubs);

    const nonces    = signers.map(s => nonceGen(s.priv, msg));
    const pubNonces = nonces.map(n => n.R);

    const partials = signers.map((s, i) =>
        partialSign(s.priv, nonces[i], i, agg, pubNonces, msg)
    );

    const signature = aggSigs(partials, pubNonces);
    return { signature, aggPubKey: agg.X };
}

/** Verify a MuSig2 signature using standard BIP-340 Schnorr verification. */
export function muSig2Verify(sig: Uint8Array, msg: Uint8Array, aggPub: Uint8Array): boolean {
    try { return schnorr.verify(sig, msg, aggPub); }
    catch { return false; }
}

/** Derive x-only pubkey (32 bytes) from 32-byte private key. */
export function xOnlyPubKey(priv: Uint8Array): Uint8Array {
    return schnorr.getPublicKey(priv);
}
