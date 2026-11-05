// Vault v2 — multi-scheme encrypted wallet vault.
//
// Storage layout (compatible with v1 conventions):
//   localStorage key: "zeronyth-vault-v1"   (SAME key as v1 — the reset
//                     tooling deletes by key and never parses the blob)
//   backup key:       "zeronyth-vault-v1-backup" (original v1 blob, written
//                     once during migration and never overwritten)
//
// Encryption envelope (v1 parameters, unchanged): WebCrypto
// PBKDF2-SHA256, 600,000 iterations -> AES-256-GCM (16-byte salt, 12-byte
// IV, fresh salt+IV on every save). Blob fields are canonical "0x" hex,
// exactly as v1 wrote them:
//   { version, algorithm, kdf: "PBKDF2-SHA256", iterations: 600000,
//     salt, iv, ciphertext }
//
// v1 blob: version 1, algorithm "ML-DSA-65", AAD "ZERONYTH/VAULT/V1/ML-DSA-65",
//          plaintext = the raw 32-byte ML-DSA seed (ciphertext is 48 bytes).
// v2 blob: version 2, algorithm "MULTI", AAD "ZERONYTH/VAULT/V2",
//          plaintext = UTF-8 JSON:
//          { "accounts": [ { "id", "scheme", "secret", "label", "createdAt" } ] }
//          where scheme is "mldsa" | "falcon" | "ecdsa" and secret is the
//          canonical hex of the seed / private key (32 / 48 / 32 bytes).
//
// The v1 decrypt path below is a faithful port of the v1 bundle's vault
// code (its `lg` KDF helper, `uE` encrypt and `Wy` decrypt, including the
// strict header/length checks and error strings) so migration reads real
// v1 vaults byte-for-byte. Do not loosen those checks.

import { toHex, fromHex, utf8Encode, utf8Decode } from './bytes.mjs';
import {
  SCHEMES,
  isScheme,
  secretLength,
  generateSecret,
  addressFromSecret,
} from './crypto.mjs';

export const VAULT_KEY = 'zeronyth-vault-v1';
export const VAULT_BACKUP_KEY = 'zeronyth-vault-v1-backup';

const V1_AAD = utf8Encode('ZERONYTH/VAULT/V1/ML-DSA-65');
const V2_AAD = utf8Encode('ZERONYTH/VAULT/V2');
const KDF_ID = 'PBKDF2-SHA256';
const ITERATIONS = 600000;
const MIN_PASSWORD_LENGTH = 12;

// ---------------------------------------------------------------- KDF / AEAD

// Port of v1 `lg`: password -> AES-256-GCM key via PBKDF2-SHA256 600k.
async function deriveKey(password, salt, usage) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw Error('Password: minimum 12 characters');
  }
  const base = await crypto.subtle.importKey('raw', utf8Encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

async function encryptBlob(password, aad, algorithm, version, plaintext) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, 'encrypt');
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plaintext),
  );
  return {
    version,
    algorithm,
    kdf: KDF_ID,
    iterations: ITERATIONS,
    salt: toHex(salt),
    iv: toHex(iv),
    ciphertext: toHex(ciphertext),
  };
}

async function decryptBlob(blob, password, aad) {
  const salt = fromHex(blob.salt);
  const iv = fromHex(blob.iv);
  const ciphertext = fromHex(blob.ciphertext);
  if (salt.length !== 16 || iv.length !== 12) throw Error('Invalid vault');
  const key = await deriveKey(password, salt, 'decrypt');
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ciphertext),
    );
  } catch {
    throw Error('Invalid password or damaged backup');
  }
}

// ---------------------------------------------------------------- v1 reading

function checkEnvelope(blob, version, algorithm) {
  if (
    !blob ||
    blob.version !== version ||
    blob.algorithm !== algorithm ||
    blob.kdf !== KDF_ID ||
    blob.iterations !== ITERATIONS
  ) {
    throw Error('Unsupported vault');
  }
}

/**
 * Decrypt a v1 blob to its raw 32-byte ML-DSA seed.
 * Faithful port of the v1 bundle's `Wy` (strict checks, same errors).
 */
async function decryptV1Seed(blob, password) {
  checkEnvelope(blob, 1, 'ML-DSA-65');
  const salt = fromHex(blob.salt);
  const iv = fromHex(blob.iv);
  const ciphertext = fromHex(blob.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length !== 48) {
    throw Error('Invalid vault');
  }
  const key = await deriveKey(password, salt, 'decrypt');
  let seed;
  try {
    seed = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: V1_AAD }, key, ciphertext),
    );
  } catch {
    throw Error('Invalid password or damaged backup');
  }
  if (seed.length !== 32) throw Error('Invalid vault');
  return seed;
}

// ---------------------------------------------------------------- v2 payload

function serializePayload(accounts) {
  return utf8Encode(
    JSON.stringify({
      accounts: accounts.map((a) => ({
        id: a.id,
        scheme: a.scheme,
        secret: toHex(a.secretBytes),
        label: a.label,
        createdAt: a.createdAt,
      })),
    }),
  );
}

function parsePayload(plaintext) {
  let obj;
  try {
    obj = JSON.parse(utf8Decode(plaintext));
  } catch {
    throw Error('Invalid vault');
  }
  if (!obj || !Array.isArray(obj.accounts)) throw Error('Invalid vault');
  return obj.accounts.map((a) => {
    if (!a || typeof a.id !== 'string' || !isScheme(a.scheme)) throw Error('Invalid vault');
    const secretBytes = fromHex(a.secret);
    if (secretBytes.length !== secretLength(a.scheme)) throw Error('Invalid vault');
    return {
      id: a.id,
      scheme: a.scheme,
      secretBytes,
      label: typeof a.label === 'string' ? a.label : '',
      createdAt: Number.isFinite(a.createdAt) ? a.createdAt : 0,
    };
  });
}

function summarize(account) {
  return {
    id: account.id,
    scheme: account.scheme,
    schemeName: SCHEMES[account.scheme].name,
    address: addressFromSecret(account.scheme, account.secretBytes),
    label: account.label,
    createdAt: account.createdAt,
  };
}

// ---------------------------------------------------------------- Vault

export class Vault {
  #storage;
  #password;
  #accounts = [];
  #locked = false;
  /** True when this session's unlock migrated a v1 vault. */
  migratedFromV1 = false;

  constructor(storage, password) {
    this.#storage = storage;
    this.#password = password;
  }

  get locked() {
    return this.#locked;
  }

  #assertUnlocked() {
    if (this.#locked) throw Error('Vault is locked');
  }

  async #save() {
    this.#assertUnlocked();
    const blob = await encryptBlob(
      this.#password,
      V2_AAD,
      'MULTI',
      2,
      serializePayload(this.#accounts),
    );
    this.#storage.setItem(VAULT_KEY, JSON.stringify(blob));
  }

  /** Create a fresh, empty v2 vault. Refuses to overwrite an existing vault. */
  static async create(storage, password) {
    if (storage.getItem(VAULT_KEY) != null) throw Error('Vault already exists');
    const vault = new Vault(storage, password);
    await vault.#save();
    return vault;
  }

  /**
   * Unlock a vault, handling both formats:
   *  - v2 blob: decrypt and return.
   *  - v1 blob: decrypt the ML-DSA seed with the v1 envelope, carry the seed
   *    VERBATIM into a new v2 vault (identical keypair -> identical
   *    address), preserve the original v1 blob string under
   *    VAULT_BACKUP_KEY (written only if no backup exists yet, and only
   *    AFTER the password has been proven — a wrong password writes
   *    nothing), then overwrite the main key with the v2 blob. The
   *    returned vault has migratedFromV1 === true.
   */
  static async unlock(storage, password) {
    const raw = storage.getItem(VAULT_KEY);
    if (raw == null) throw Error('No vault found');
    let blob;
    try {
      blob = JSON.parse(raw);
    } catch {
      throw Error('Invalid vault');
    }

    if (blob && blob.version === 1) {
      const seed = await decryptV1Seed(blob, password); // throws before any write
      const vault = new Vault(storage, password);
      vault.migratedFromV1 = true;
      vault.#accounts = [
        {
          id: crypto.randomUUID(),
          scheme: 'mldsa',
          secretBytes: seed,
          label: '',
          createdAt: Date.now(),
        },
      ];
      if (storage.getItem(VAULT_BACKUP_KEY) == null) {
        storage.setItem(VAULT_BACKUP_KEY, raw); // original blob, untouched
      }
      await vault.#save();
      return vault;
    }

    if (blob && blob.version === 2) {
      checkEnvelope(blob, 2, 'MULTI');
      const plaintext = await decryptBlob(blob, password, V2_AAD);
      const vault = new Vault(storage, password);
      vault.#accounts = parsePayload(plaintext);
      return vault;
    }

    throw Error('Unsupported vault');
  }

  /** Accounts without secrets: [{ id, scheme, schemeName, address, label, createdAt }] */
  listAccounts() {
    this.#assertUnlocked();
    return this.#accounts.map(summarize);
  }

  /**
   * Add an account and persist the vault.
   * opts.secret (Uint8Array) injects known secret material — intended for
   * migration and tests; it is copied. Default: fresh random secret.
   */
  async addAccount(scheme, opts = {}) {
    this.#assertUnlocked();
    if (!isScheme(scheme)) throw Error(`Unknown scheme: ${scheme}`);
    const secretBytes = opts.secret ? new Uint8Array(opts.secret) : generateSecret(scheme);
    if (secretBytes.length !== secretLength(scheme)) {
      throw Error(`${SCHEMES[scheme].name} secret must be ${secretLength(scheme)} bytes`);
    }
    const account = {
      id: crypto.randomUUID(),
      scheme,
      secretBytes,
      label: typeof opts.label === 'string' ? opts.label : '',
      createdAt: Date.now(),
    };
    this.#accounts.push(account);
    await this.#save();
    return summarize(account);
  }

  /**
   * INTERNAL ONLY — returns a COPY of an account's secret material.
   * Reserved for the Phase 2 signing engines. Never expose to UI code,
   * logs, or anything outside the vault blob.
   */
  exportSecret(accountId) {
    this.#assertUnlocked();
    const account = this.#accounts.find((a) => a.id === accountId);
    if (!account) throw Error(`No such account: ${accountId}`);
    return new Uint8Array(account.secretBytes);
  }

  /** Zeroize all in-memory secrets and drop the password. */
  lock() {
    for (const a of this.#accounts) a.secretBytes.fill(0);
    this.#accounts = [];
    this.#password = null;
    this.#locked = true;
  }
}

// ------------------------------------------------------- functional wrappers

/** True if any vault blob (v1 or v2) exists in storage. */
export function vaultExists(storage) {
  return storage.getItem(VAULT_KEY) != null;
}

export function createVault(storage, password) {
  return Vault.create(storage, password);
}

export function unlockVault(storage, password) {
  return Vault.unlock(storage, password);
}

export function lockVault(vault) {
  vault.lock();
}
