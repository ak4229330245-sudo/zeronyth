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
//          plaintext = UTF-8 JSON, one of two payload shapes:
//          LEGACY (random accounts):
//          { "accounts": [ { "id", "scheme", "secret", "label", "createdAt" } ] }
//          where scheme is "mldsa" | "falcon" | "ecdsa" and secret is the
//          canonical hex of the seed / private key (32 / 48 / 32 bytes).
//          MASTER (phrase-backed, see hd.mjs / bip39.mjs):
//          { "kind": "master", "master": "<hex of the 32-byte master seed>",
//            "accounts": [ { "id", "scheme", "index", "label", "createdAt" } ] }
//          Master accounts store NO secret: their secret material is
//          derived deterministically from the master seed on unlock,
//          so the recovery phrase alone rebuilds every account.
//          The envelope (version/algorithm/AAD) is identical for both
//          shapes; the payload's "kind" discriminates.
//
// Encrypted backup file (export/import, independent of the vault):
//   { "format": "zeronyth-wallet-backup", "version": 1,
//     "kdf": "PBKDF2-SHA256", "iterations": 600000, salt, iv, ciphertext }
//   Same PBKDF2/AES-GCM machinery, but encrypted under a user-chosen
//   BACKUP password with the distinct AAD "ZERONYTH/VAULT/BACKUP/V1".
//   Plaintext is a wallet payload in the same two shapes as above
//   (master backups carry the master seed; legacy backups carry the
//   account secrets), minus account ids (fresh ids are minted on
//   import — ids are device-local, addresses are what matter).
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
import { MASTER_SEED_LENGTH, deriveAccountSecret } from './hd.mjs';

export const VAULT_KEY = 'zeronyth-vault-v1';
export const VAULT_BACKUP_KEY = 'zeronyth-vault-v1-backup';

const V1_AAD = utf8Encode('ZERONYTH/VAULT/V1/ML-DSA-65');
const V2_AAD = utf8Encode('ZERONYTH/VAULT/V2');
const BACKUP_AAD = utf8Encode('ZERONYTH/VAULT/BACKUP/V1');
export const BACKUP_FORMAT = 'zeronyth-wallet-backup';
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

function serializePayload(accounts, master) {
  if (master) {
    return utf8Encode(
      JSON.stringify({
        kind: 'master',
        master: toHex(master),
        accounts: accounts.map((a) => ({
          id: a.id,
          scheme: a.scheme,
          index: a.index,
          label: a.label,
          createdAt: a.createdAt,
        })),
      }),
    );
  }
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

/**
 * Validate + normalize a wallet payload object (either shape) into
 * { master, accounts }. Master accounts get their secretBytes derived
 * in memory; legacy accounts carry theirs. Accounts without an id get
 * a fresh one (backup imports omit ids). Throws Error('Invalid vault')
 * for vault payloads and Error('Invalid backup') for backups — the
 * caller picks the wording via `what`.
 */
function parseWalletPayload(obj, what = 'vault', requireIds = true) {
  const invalid = () => Error(`Invalid ${what}`);
  const idOf = (a) => {
    if (typeof a.id === 'string') return a.id;
    if (requireIds) throw invalid();
    return crypto.randomUUID();
  };
  if (!obj || !Array.isArray(obj.accounts)) throw invalid();

  if (obj.kind === 'master') {
    let master;
    try {
      master = fromHex(obj.master);
    } catch {
      throw invalid();
    }
    if (master.length !== MASTER_SEED_LENGTH) throw invalid();
    const accounts = obj.accounts.map((a) => {
      if (!a || !isScheme(a.scheme)) throw invalid();
      if (!Number.isSafeInteger(a.index) || a.index < 0 || a.index > 0xffffffff) throw invalid();
      return {
        id: idOf(a),
        scheme: a.scheme,
        index: a.index,
        secretBytes: deriveAccountSecret(master, a.scheme, a.index),
        label: typeof a.label === 'string' ? a.label : '',
        createdAt: Number.isFinite(a.createdAt) ? a.createdAt : 0,
      };
    });
    return { master, accounts };
  }

  if (obj.kind !== undefined) throw invalid();
  const accounts = obj.accounts.map((a) => {
    if (!a || !isScheme(a.scheme)) throw invalid();
    let secretBytes;
    try {
      secretBytes = fromHex(a.secret);
    } catch {
      throw invalid();
    }
    if (secretBytes.length !== secretLength(a.scheme)) throw invalid();
    return {
      id: idOf(a),
      scheme: a.scheme,
      index: null,
      secretBytes,
      label: typeof a.label === 'string' ? a.label : '',
      createdAt: Number.isFinite(a.createdAt) ? a.createdAt : 0,
    };
  });
  return { master: null, accounts };
}

function parsePayload(plaintext) {
  let obj;
  try {
    obj = JSON.parse(utf8Decode(plaintext));
  } catch {
    throw Error('Invalid vault');
  }
  return parseWalletPayload(obj, 'vault');
}

function summarize(account) {
  return {
    id: account.id,
    scheme: account.scheme,
    schemeName: SCHEMES[account.scheme].name,
    address: addressFromSecret(account.scheme, account.secretBytes),
    label: account.label,
    createdAt: account.createdAt,
    index: account.index ?? null,
  };
}

// ---------------------------------------------------------------- Vault

export class Vault {
  #storage;
  #password;
  #accounts = [];
  #master = null; // Uint8Array (32) for master wallets, null for legacy
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

  /** True for phrase-backed wallets (payload kind "master"). */
  get isMaster() {
    return this.#master != null;
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
      serializePayload(this.#accounts, this.#master),
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
   * Create a fresh, empty MASTER vault rooted at the given 32-byte
   * master seed (copied). Accounts are added with addAccount(), which
   * derives them deterministically per scheme index. Refuses to
   * overwrite an existing vault.
   */
  static async createMaster(storage, password, masterSeed) {
    if (storage.getItem(VAULT_KEY) != null) throw Error('Vault already exists');
    if (!(masterSeed instanceof Uint8Array) || masterSeed.length !== MASTER_SEED_LENGTH) {
      throw Error(`Master seed must be ${MASTER_SEED_LENGTH} bytes`);
    }
    const vault = new Vault(storage, password);
    vault.#master = new Uint8Array(masterSeed);
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
          index: null,
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
      const parsed = parsePayload(plaintext);
      vault.#master = parsed.master;
      vault.#accounts = parsed.accounts;
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
   *
   * Legacy vaults: opts.secret (Uint8Array) injects known secret
   * material — intended for migration and tests; it is copied.
   * Default: fresh random secret.
   *
   * Master vaults: the secret is DERIVED from the master seed.
   * opts.index selects the derivation index (default: the next free
   * index for the scheme); opts.secret is rejected — a master wallet's
   * accounts must stay reproducible from the phrase alone.
   */
  async addAccount(scheme, opts = {}) {
    this.#assertUnlocked();
    if (!isScheme(scheme)) throw Error(`Unknown scheme: ${scheme}`);
    let secretBytes;
    let index = null;
    if (this.#master) {
      if (opts.secret) throw Error('Master wallet accounts are derived, not imported');
      const used = this.#accounts.filter((a) => a.scheme === scheme).map((a) => a.index);
      index = opts.index ?? (used.length ? Math.max(...used) + 1 : 0);
      if (!Number.isSafeInteger(index) || index < 0 || index > 0xffffffff) {
        throw Error(`Account index out of range: ${index}`);
      }
      if (used.includes(index)) throw Error(`Account already exists: ${scheme} #${index}`);
      secretBytes = deriveAccountSecret(this.#master, scheme, index);
    } else {
      secretBytes = opts.secret ? new Uint8Array(opts.secret) : generateSecret(scheme);
    }
    if (secretBytes.length !== secretLength(scheme)) {
      throw Error(`${SCHEMES[scheme].name} secret must be ${secretLength(scheme)} bytes`);
    }
    const account = {
      id: crypto.randomUUID(),
      scheme,
      index,
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

  /**
   * INTERNAL ONLY — returns a COPY of the master seed of a master
   * wallet. Reserved for the recovery-phrase reveal flow, which must
   * re-authenticate with the wallet password before calling this.
   * Throws for legacy wallets: they have no phrase.
   */
  exportMasterSeed() {
    this.#assertUnlocked();
    if (!this.#master) throw Error('No recovery phrase for this wallet');
    return new Uint8Array(this.#master);
  }

  /**
   * Export an encrypted backup of this wallet as a JSON string,
   * encrypted under a user-chosen BACKUP password (independent of the
   * wallet password; see the BACKUP_AAD envelope at the top of this
   * file). Master wallets back up their master seed + descriptors;
   * legacy wallets back up their account secrets. The caller is
   * responsible for handing the string to the user (download / copy) —
   * it never touches storage or the network here.
   */
  async exportBackup(backupPassword) {
    this.#assertUnlocked();
    const payload = this.#master
      ? {
          kind: 'master',
          master: toHex(this.#master),
          accounts: this.#accounts.map((a) => ({
            scheme: a.scheme,
            index: a.index,
            label: a.label,
            createdAt: a.createdAt,
          })),
        }
      : {
          accounts: this.#accounts.map((a) => ({
            scheme: a.scheme,
            secret: toHex(a.secretBytes),
            label: a.label,
            createdAt: a.createdAt,
          })),
        };
    const blob = await encryptBlob(
      backupPassword,
      BACKUP_AAD,
      'MULTI',
      1,
      utf8Encode(JSON.stringify(payload)),
    );
    return JSON.stringify({ format: BACKUP_FORMAT, ...blob }, null, 2);
  }

  /** Zeroize all in-memory secrets and drop the password. */
  lock() {
    for (const a of this.#accounts) a.secretBytes.fill(0);
    this.#accounts = [];
    if (this.#master) this.#master.fill(0);
    this.#master = null;
    this.#password = null;
    this.#locked = true;
  }

  /**
   * Import an encrypted backup (see Vault#exportBackup) as this
   * device's vault, encrypted under a NEW wallet password. Refuses
   * when a vault already exists. Returns the unlocked Vault. A wrong
   * backup password throws 'Invalid password or damaged backup'; a
   * malformed file throws 'Invalid backup'.
   */
  static async importBackup(storage, backupText, backupPassword, walletPassword) {
    if (storage.getItem(VAULT_KEY) != null) throw Error('Vault already exists');
    let blob;
    try {
      blob = JSON.parse(backupText);
    } catch {
      throw Error('Invalid backup');
    }
    if (
      !blob ||
      blob.format !== BACKUP_FORMAT ||
      blob.version !== 1 ||
      blob.algorithm !== 'MULTI' ||
      blob.kdf !== KDF_ID ||
      blob.iterations !== ITERATIONS
    ) {
      throw Error('Invalid backup');
    }
    const plaintext = await decryptBlob(blob, backupPassword, BACKUP_AAD);
    let obj;
    try {
      obj = JSON.parse(utf8Decode(plaintext));
    } catch {
      throw Error('Invalid backup');
    }
    const parsed = parseWalletPayload(obj, 'backup', false);
    const vault = new Vault(storage, walletPassword);
    vault.#master = parsed.master;
    vault.#accounts = parsed.accounts;
    await vault.#save();
    return vault;
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

export function createMasterVault(storage, password, masterSeed) {
  return Vault.createMaster(storage, password, masterSeed);
}

export function importVaultBackup(storage, backupText, backupPassword, walletPassword) {
  return Vault.importBackup(storage, backupText, backupPassword, walletPassword);
}

export function unlockVault(storage, password) {
  return Vault.unlock(storage, password);
}

export function lockVault(vault) {
  vault.lock();
}
