// Test fixtures and known-answer vectors.
//
// Address vectors (all independently cross-checked during Phase 1):
//   ML-DSA seed 0x00..0x1f -> 0xc04e7e8933966eac97dfbe95a89c125095cf27c9
//     (@noble/post-quantum 0.7.1 == CLI vendor-noble == `pq-wallet.mjs
//      address` == the v1 bundle's own `$y` derivation)
//   Falcon seed 0x00..0x2f -> 0x3d3f2305c97513204453b1e96721ffe8c27013a4
//     (Phase 0 report: noble keygen, chain-verified both directions)
//   ECDSA privkey 0x00..0x01 -> 0x7e5f4552091a69125d5dfcb7b8c2659029395bdf
//     (standard secp256k1 vector)

export const PASSWORD = 'phase1-test-password';
export const WRONG_PASSWORD = 'phase1-test-passw0rd';

export function seqBytes(n, start = 0) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (start + i) & 0xff;
  return out;
}

export const VECTORS = {
  mldsa: { secret: seqBytes(32), address: '0xc04e7e8933966eac97dfbe95a89c125095cf27c9' },
  falcon: { secret: seqBytes(48), address: '0x3d3f2305c97513204453b1e96721ffe8c27013a4' },
  ecdsa: {
    secret: (() => {
      const b = new Uint8Array(32);
      b[31] = 1;
      return b;
    })(),
    address: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf',
  },
};

// A REAL v1 vault blob, produced by executing the v1 bundle's own vault
// writer (`uE`) extracted from ~/workspace/qwallet-fix/bundle.js — see
// gen-v1-fixture.mjs. It encrypts VECTORS.mldsa.secret (seed 0x00..0x1f)
// under V1_PASSWORD. The bundle's own decryptor (`Wy`) round-trips it and
// derives VECTORS.mldsa.address from it.
export const V1_PASSWORD = 'phase1-fixture-password';
export const V1_FIXTURE =
  '{"version":1,"algorithm":"ML-DSA-65","kdf":"PBKDF2-SHA256","iterations":600000,' +
  '"salt":"0x6f4eb93248aec4daf887699a67a5d84d","iv":"0xb9e8dadf2c5a74a748c37e17",' +
  '"ciphertext":"0x67417d08e9c8a0cda96f2dd2910c92a6db9558a9d1cd2374bac4ef9d67481f52a3b2f0b6cdc17fe00b929314d531ae3d"}';

// Independent transcription of the v1 bundle's vault writer (`lg` + `uE`),
// used to build additional v1 blobs (random seeds) in tests. Written from
// the extracted bundle source; intentionally shares no code with the vault
// module under test. (The authoritative fixture is V1_FIXTURE above.)
const V1_AAD = new TextEncoder().encode('ZERONYTH/VAULT/V1/ML-DSA-65');

async function v1DeriveKey(password, salt, usage) {
  if (typeof password !== 'string' || password.length < 12) {
    throw Error('Password: minimum 12 characters');
  }
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 6e5 },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

function hex0x(bytes) {
  return '0x' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Build a v1-format blob object encrypting a 32-byte ML-DSA seed. */
export async function encryptV1(seed, password) {
  if (seed.length !== 32) throw Error('Seed length');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await v1DeriveKey(password, salt, 'encrypt');
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: V1_AAD }, key, seed),
  );
  return {
    version: 1,
    algorithm: 'ML-DSA-65',
    kdf: 'PBKDF2-SHA256',
    iterations: 600000,
    salt: hex0x(salt),
    iv: hex0x(iv),
    ciphertext: hex0x(ciphertext),
  };
}
