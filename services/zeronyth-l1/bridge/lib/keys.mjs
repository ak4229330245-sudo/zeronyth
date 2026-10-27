// Bridge keys (testnet). Generated on the box, stored 0600 in bridge/.secrets/bridge-keys.json and backed up to
// ~/.zeronyth-secrets/bridge-keys.json. Private keys are never printed or logged; only addresses / public-key hashes.
import { Wallet, keccak256, hexlify } from 'ethers';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, copyFileSync, statSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ml_dsa65 } from '../../dashboard/assets/vendor-noble.mjs';

export const bridgeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const KEYS_FILE = process.env.BRIDGE_KEYS_FILE || path.join(bridgeRoot, '.secrets', 'bridge-keys.json');
const BACKUP = path.join(os.homedir(), '.zeronyth-secrets', 'bridge-keys.json');

const hex32 = () => '0x' + randomBytes(32).toString('hex');

export function ensureKeys() {
  mkdirSync(path.dirname(KEYS_FILE), { recursive: true, mode: 0o700 });
  if (!existsSync(KEYS_FILE)) {
    if (existsSync(BACKUP) && !process.env.BRIDGE_KEYS_FILE) copyFileSync(BACKUP, KEYS_FILE);
    else {
      const k = { created: new Date().toISOString(), admin: hex32(), guardian: hex32(),
        relayers: [0, 1, 2].map(() => ({ ecdsa: hex32(), mldsaSeed: hex32() })) };
      writeFileSync(KEYS_FILE, JSON.stringify(k), { mode: 0o600 });
    }
  }
  chmodSync(KEYS_FILE, 0o600);
  if (!process.env.BRIDGE_KEYS_FILE && !existsSync(BACKUP)) {
    mkdirSync(path.dirname(BACKUP), { recursive: true, mode: 0o700 });
    copyFileSync(KEYS_FILE, BACKUP); chmodSync(BACKUP, 0o600);
  }
  return JSON.parse(readFileSync(KEYS_FILE, 'utf8'));
}

export function loadKeys() { return ensureKeys(); }
export function adminWallet(provider) { return new Wallet(loadKeys().admin, provider); }
export function guardianWallet(provider) { return new Wallet(loadKeys().guardian, provider); }

/** Relayer i: ECDSA wallet + ML-DSA-65 keypair (deterministic from its 32-byte seed). */
export function relayer(i) {
  const r = loadKeys().relayers[i];
  const kp = ml_dsa65.keygen(Buffer.from(r.mldsaSeed.slice(2), 'hex'));
  return { index: i, wallet: new Wallet(r.ecdsa), mldsa: kp,
    mldsaPublicKeyHex: hexlify(kp.publicKey), mldsaPkHash: '0x' + createHash('sha256').update(kp.publicKey).digest('hex') };
}

export function publicSummary() {
  const k = loadKeys();
  return { admin: new Wallet(k.admin).address, guardian: new Wallet(k.guardian).address,
    relayers: [0, 1, 2].map((i) => { const r = relayer(i); return { index: i, address: r.wallet.address, mldsaPkSha256: r.mldsaPkHash }; }) };
}
export { keccak256 };

// ---- outside / per-machine operators: a separate key file generated ON that machine (script/operator-keygen.mjs).
// It holds only relayer keys (no admin/guardian). Never copied between machines.
export function loadOperatorKeys(file) {
  const st = statSync(file);
  if ((st.mode & 0o077) !== 0) throw new Error(`${file} must be chmod 600`);
  const k = JSON.parse(readFileSync(file, 'utf8'));
  return k.relayers.map((r, i) => {
    const kp = ml_dsa65.keygen(Buffer.from(r.mldsaSeed.slice(2), 'hex'));
    return { index: i, wallet: new Wallet(r.ecdsa), mldsa: kp, mldsaPublicKeyHex: hexlify(kp.publicKey),
      mldsaPkHash: '0x' + createHash('sha256').update(kp.publicKey).digest('hex') };
  });
}
export function createOperatorKeys(file, n) {
  if (existsSync(file)) throw new Error(`${file} already exists (refusing to overwrite)`);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify({ created: new Date().toISOString(), relayers: Array.from({ length: n }, () => ({ ecdsa: hex32(), mldsaSeed: hex32() })) }), { mode: 0o600 });
  chmodSync(file, 0o600);
  return loadOperatorKeys(file);
}
