// Run with both Node 20 (noble) and Node 24 (native): the verdict must be identical and strict.
import test from 'node:test'; import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ml_dsa65 } from '../../dashboard/assets/vendor-noble.mjs';
import { verifyMldsa65, BACKEND, PK_LEN, SIG_LEN } from '../lib/mldsa.mjs';
import { VerifyPool } from '../lib/verify-pool.mjs';
const kp = ml_dsa65.keygen(randomBytes(32)), kp2 = ml_dsa65.keygen(randomBytes(32));
const msg = randomBytes(77), sig = ml_dsa65.sign(msg, kp.secretKey);
test(`valid signature accepted (${BACKEND})`, () => assert.equal(verifyMldsa65(sig, msg, kp.publicKey), true));
test('every single-bit flip in the signature is rejected (sampled 64 positions)', () => {
  for (let i = 0; i < 64; i++) { const b = Uint8Array.from(sig); const pos = Math.floor((i / 64) * SIG_LEN); b[pos] ^= 1 << (i % 8); assert.equal(verifyMldsa65(b, msg, kp.publicKey), false, `pos ${pos}`); }
});
test('wrong message / wrong key / truncated / extended / empty inputs rejected', () => {
  const m2 = Uint8Array.from(msg); m2[0] ^= 1;
  assert.equal(verifyMldsa65(sig, m2, kp.publicKey), false);
  assert.equal(verifyMldsa65(sig, msg, kp2.publicKey), false);
  assert.equal(verifyMldsa65(sig.subarray(0, SIG_LEN - 1), msg, kp.publicKey), false);
  assert.equal(verifyMldsa65(Uint8Array.from([...sig, 0]), msg, kp.publicKey), false);
  assert.equal(verifyMldsa65(new Uint8Array(SIG_LEN), msg, kp.publicKey), false);
  assert.equal(verifyMldsa65(sig, msg, new Uint8Array(PK_LEN)), false);
  assert.equal(verifyMldsa65('x', msg, kp.publicKey), false);
});
test('repeated verification is recomputed (no result cache): same sig valid, then tampered invalid', () => {
  assert.equal(verifyMldsa65(sig, msg, kp.publicKey), true);
  const b = Uint8Array.from(sig); b[5] ^= 0x80; assert.equal(verifyMldsa65(b, msg, kp.publicKey), false);
  assert.equal(verifyMldsa65(sig, msg, kp.publicKey), true);
});
test('batched pool: one bad item among 50 is pinpointed, others valid', async () => {
  const e = (u) => Buffer.from(u).toString('base64');
  const items = Array.from({ length: 50 }, (_, i) => { const m = randomBytes(40); let s = ml_dsa65.sign(m, kp.secretKey); if (i === 31) { s = Uint8Array.from(s); s[999] ^= 4; } return { pk: e(kp.publicKey), msg: e(m), sig: e(s) }; });
  const pool = new VerifyPool(2); const out = await pool.parallel('mldsa', items); await pool.close();
  assert.deepEqual(out.map((x, i) => (x ? -1 : i)).filter((i) => i >= 0), [31]);
});
