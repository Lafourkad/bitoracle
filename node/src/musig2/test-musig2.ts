/**
 * test-musig2.ts — Unit test MuSig2 implementation
 */
import { createHash, randomBytes } from 'crypto';
import { muSig2Sign, muSig2Verify, keyAgg } from './MuSig2.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const { secp256k1, schnorr } = req(
    join(__dirname, '../../node_modules/@noble/curves/secp256k1.js')
);

console.log('=== MuSig2 Unit Test ===\n');

// Generate 3 random keypairs
const signers = Array.from({ length: 3 }, (_, i) => {
    const priv = randomBytes(32);
    const pub  = schnorr.getPublicKey(priv); // x-only 32 bytes
    console.log(`Signer ${i+1} pubkey: ${Buffer.from(pub).toString('hex').slice(0,16)}...`);
    return { priv, pub };
});

// Test message
const message = createHash('sha256').update('BTC/USD:7144900:11357').digest();
console.log('\nMessage hash:', message.toString('hex'));

// Key aggregation
const aggKey = keyAgg(signers.map(s => s.pub));
console.log('\nAggregated pubkey:', Buffer.from(aggKey.X).toString('hex'));
console.log('gacc:', aggKey.gacc.toString());

// Sign
console.log('\nSigning...');
const { signature, aggPubKey } = await muSig2Sign(signers, message);
console.log('Signature (64 bytes):', Buffer.from(signature).toString('hex'));
console.log('AggPubKey:', Buffer.from(aggPubKey).toString('hex'));

// Verify with our verifier
const valid = muSig2Verify(signature, message, aggPubKey);
console.log('\nVerification (our impl):', valid ? '✅ VALID' : '❌ INVALID');

// Verify with noble schnorr directly
const validNative = schnorr.verify(signature, message, aggPubKey);
console.log('Verification (noble schnorr):', validNative ? '✅ VALID' : '❌ INVALID');

// Test that wrong message fails
const wrongMsg = createHash('sha256').update('wrong message').digest();
const invalidSig = muSig2Verify(signature, wrongMsg, aggPubKey);
console.log('Wrong message rejected:', !invalidSig ? '✅ CORRECT' : '❌ FAILED');

console.log('\n=== Size comparison ===');
console.log('MuSig2 signature:', signature.length, 'bytes (vs 3 × 2420 =', 3*2420, 'bytes ML-DSA)');
console.log('Size reduction:', Math.round((1 - signature.length / (3*2420)) * 100) + '%');
