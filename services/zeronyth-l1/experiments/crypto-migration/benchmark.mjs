/** Primitive CPU/byte measurements, NOT EVM gas, distributed consensus or TPS. */
import { createRequire } from 'node:module';
import { generateKeyPairSync, sign, verify, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { generateIdentity, signTransaction } from '../../pq-native/pq.mjs';
const require = createRequire(new URL('../../faucet/package.json', import.meta.url));
const { SigningKey, computeAddress, recoverAddress, keccak256, Wallet } = require('ethers');
const samples = Number(process.argv[2] || 200);
if (!Number.isInteger(samples) || samples < 20 || samples > 2000) throw Error('20–2000 samples required');
const message = Buffer.alloc(256, 0x61);
const digest = keccak256(message);

function measure(fn, count = samples) {
  for (let i = 0; i < 10; i++) fn();
  const values = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now(); fn(); values.push(performance.now() - start);
  }
  values.sort((a, b) => a - b);
  const round = n => +n.toFixed(6);
  return { samples: count, meanMs: round(values.reduce((a, b) => a + b, 0) / count),
    medianMs: round(values[Math.floor(count / 2)]),
    p95Ms: round(values[Math.ceil(count * .95) - 1]) };
}

const results = [];
for (const [algorithm, publicKeyRawBytes, privateKeyStandardBytes] of [
  ['ml-dsa-44', 1312, 2560], ['ml-dsa-65', 1952, 4032], ['ml-dsa-87', 2592, 4896],
]) {
  const { privateKey, publicKey } = generateKeyPairSync(algorithm);
  const signature = sign(null, message, privateKey);
  const row = {
    algorithm, implementation: 'Node crypto / OpenSSL', publicKeyRawBytes,
    privateKeyStandardBytes, privateKeyEncodingNote: 'FIPS expanded secret; PKCS8 seed encoding may differ',
    publicKeySpkiDerBytes: publicKey.export({ format: 'der', type: 'spki' }).length,
    signatureBytes: signature.length,
    keyGeneration: measure(() => generateKeyPairSync(algorithm), 30),
    sign: measure(() => sign(null, message, privateKey)),
    verify: measure(() => {
      if (!verify(null, message, publicKey, signature)) throw Error('Verification failed');
    }),
  };
  results.push(row);
}
const ec = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
const ecSignature = sign('sha256', message, { key: ec.privateKey, dsaEncoding: 'ieee-p1363' });
results.push({
  algorithm: 'secp256k1 ECDSA + SHA256 (NOT Ethereum signing)', implementation: 'Node crypto / OpenSSL',
  publicKeyRawBytes: 65, signatureBytes: ecSignature.length,
  keyGeneration: measure(() => generateKeyPairSync('ec', { namedCurve: 'secp256k1' }), 30),
  sign: measure(() => sign('sha256', message, { key: ec.privateKey, dsaEncoding: 'ieee-p1363' })),
  verify: measure(() => {
    if (!verify('sha256', message, { key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, ecSignature)) {
      throw Error('ECDSA verify failed');
    }
  }),
});
const key = new SigningKey(randomBytes(32));
const address = computeAddress(key.publicKey);
const signature = key.sign(digest);
results.push({
  algorithm: 'Ethereum secp256k1 ECDSA on precomputed Keccak256 digest',
  implementation: 'ethers 6.17.0 / JavaScript (NOT native Besu speed)',
  publicKeyRawBytes: 65, signatureBytes: 65,
  keyGeneration: measure(() => { const k = new SigningKey(randomBytes(32)); computeAddress(k.publicKey); }, 30),
  sign: measure(() => key.sign(digest)),
  verify: measure(() => {
    if (recoverAddress(digest, signature) !== address) throw Error('Recovery failed');
  }),
});
const alice = generateIdentity(), bob = generateIdentity();
const pq = signTransaction({ chainId: '19127', nonce: '0', to: bob.address, value: '1' }, alice.privateKey);
const rawEvm = await new Wallet(key.privateKey).signTransaction({
  chainId: 9127, type: 0, nonce: 0, gasPrice: 0, gasLimit: 21000, to: address, value: 1n,
});
console.log(JSON.stringify({
  scope: 'ISOLATED CPU MICROBENCHMARK; NO LIVE TRANSACTIONS, NO BESU MODIFICATIONS',
  capturedUtc: new Date().toISOString(), node: process.version, openssl: process.versions.openssl,
  platform: `${process.platform}/${process.arch}`, cpu: os.cpus()[0]?.model,
  logicalCpus: os.availableParallelism(), messageBytes: message.length,
  methodology: '10 warmups per operation, 30 keygen samples, independent per-operation timed samples; live devnet shares the host',
  results,
  wire: { standardLegacyEvmRawTransactionBytes: (rawEvm.length - 2) / 2,
    separateLabPqJsonTransactionBytes: Buffer.byteLength(JSON.stringify(pq)),
    formatCaveat: 'Different envelopes/chains, not equivalent calldata or gas costs',
    threeEcdsaSignaturesBytes: 3 * 65, threeMldsa65SignaturesBytes: 3 * 3309,
    signatureOnlySizeRatio: +(3309 / 65).toFixed(3) },
  limits: [
    'No secure erasure guarantee for JavaScript heap keys; no HSM or FIPS validation claimed.',
    'Native ML-DSA vs JavaScript Ethereum recovery timings are implementation-dependent, not intrinsic algorithm ratios.',
    'No wallet compatibility, EVM gas, network latency, durable storage or distributed TPS has been measured.',
    'Do not conclude quantum resistance of the entire chain from ML-DSA signatures alone.',
  ],
}, null, 2));
