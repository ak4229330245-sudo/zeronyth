// Session controller — the wallet's framework-free application core.
//
// Owns everything the UI needs so the UI itself is a thin renderer:
//   - vault lifecycle (create / unlock / lock / add account) over an
//     injected Storage-like object and the Phase 1 vault core,
//   - the reset behavior ported from reset-wallet v3,
//   - the send pipeline (prepare -> review -> sign -> broadcast -> poll)
//     over the Phase 2 engines and gas policy,
//   - balances, the zny_faucet call, and connection checks.
//
// Password handling (security fix, 2026-11-05): the unlock password is
// NEVER persisted — not to localStorage, sessionStorage or IndexedDB.
// An unlocked session lives in memory only; a page reload or tab close
// locks the wallet and the password must be entered again. (Earlier
// builds ported reset-wallet v3's "stay unlocked" behavior and stored
// the password under "zeronyth.qwallet.autounlock", next to the vault
// it unlocks; that key is now only ever DELETED: session construction
// and start() scrub it so users who enabled it under an old build are
// cleaned up on their first load of the fixed build.)
//
// reset-wallet v3 semantics for reset, translated from DOM-watching to
// direct knowledge (the behavior is identical, the mechanism is not):
//   * Reset: wiping removes the vault key ("zeronyth-vault-v1"), the
//     legacy autounlock key, and every "zeronyth-tokens:*" key — exactly
//     the v3 deletion set. The v1 migration backup
//     ("zeronyth-vault-v1-backup") is NOT removed, matching v3.
//   * No idle auto-lock: the vault locks on Lock or page reload only.
//
// Falcon note: noble keygen (~1 s) runs inside the core whenever a Falcon
// account is summarized or signs. The session caches account summaries
// for the unlock session so rendering never re-derives them, and the
// cache is dropped (and the vault zeroizes its secrets) on lock.
// Signing itself still derives per signature inside the proven core —
// the UI covers that with a signing-in-progress state rather than
// caching secret keys outside the vault's zeroization discipline.

import { createRpcClient, quantityHex } from '../core/rpc.mjs';
import {
  vaultExists,
  createVault,
  createMasterVault,
  importVaultBackup,
  unlockVault,
  VAULT_KEY,
  VAULT_BACKUP_KEY,
} from '../core/vault.mjs';
import { entropyToMnemonic, mnemonicToEntropy } from '../core/bip39.mjs';
import { generateMasterSeed, deriveAccountAddress } from '../core/hd.mjs';
import { signWithVault } from '../core/tx.mjs';
import { transferGasLimit, callGasLimit } from '../core/gas.mjs';
import { isAddress, isHexData } from '../core/amount.mjs';

const SCHEME_LIST = ['mldsa', 'falcon', 'ecdsa'];
/** Highest extra index probed per scheme during phrase restore. */
const RESTORE_PROBE_MAX_INDEX = 4;

/**
 * Legacy key under which pre-fix builds stored the unlock password for
 * the (removed) stay-unlocked feature. Never written anymore; scrubbed
 * at startup so stale copies cannot linger next to the vault.
 */
export const AUTOUNLOCK_KEY = 'zeronyth.qwallet.autounlock';
export const RPC_URL_KEY = 'zeronyth.qwallet.rpc';
export const TOKEN_PREFIX = 'zeronyth-tokens:';
export const DEFAULT_RPC_URL = 'https://zeronyth.dpdns.org/rpc';
export const EXPLORER_BASE = 'https://scan.zeronyth.dpdns.org';
export const CHAIN_ID = 912701n;
/** Chain 912701 historically clears at 1 gwei; used when the node reports 0. */
export const FALLBACK_GAS_PRICE = 1000000000n;

export function explorerTxUrl(hash) {
  return `${EXPLORER_BASE}/tx/${hash}`;
}

function storageKeys(storage) {
  if (typeof storage.key === 'function' && typeof storage.length === 'number') {
    const keys = [];
    for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
    return keys.filter((k) => typeof k === 'string');
  }
  if (storage._map instanceof Map) return [...storage._map.keys()];
  return [];
}

export function createSession({
  storage,
  rpcFactory = (url) => createRpcClient(url),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  if (!storage) throw Error('storage required');

  // Scrub the legacy remembered-password key immediately at startup:
  // pre-fix builds may have left the vault password in storage.
  storage.removeItem(AUTOUNLOCK_KEY);

  let vault = null;
  let status = vaultExists(storage) ? 'locked' : 'no-vault'; // no-vault|locked|unlocked
  let accounts = []; // cached summaries (secret-free)
  let balances = new Map(); // accountId -> bigint | null (null = unknown)
  let migratedFromV1 = false;
  let walletIsMaster = false; // phrase-backed wallet (recovery phrase exists)
  let pendingMaster = null; // master seed awaiting phrase-create confirmation
  const listeners = new Set();

  const snapshot = () => ({
    status,
    accounts: accounts.map((a) => ({ ...a })),
    migratedFromV1,
    hasPhrase: walletIsMaster,
    balances: Object.fromEntries(balances),
    hasBackup: storage.getItem(VAULT_BACKUP_KEY) != null,
    rpcUrl: getRpcUrl(),
  });
  const emit = () => {
    const s = snapshot();
    for (const fn of listeners) fn(s);
  };

  function getRpcUrl() {
    return storage.getItem(RPC_URL_KEY) || DEFAULT_RPC_URL;
  }
  const rpc = () => rpcFactory(getRpcUrl());

  function cacheAccounts() {
    accounts = vault.listAccounts();
  }

  async function adoptVault(unlocked) {
    vault = unlocked;
    migratedFromV1 = unlocked.migratedFromV1 === true;
    walletIsMaster = unlocked.isMaster === true;
    cacheAccounts();
    balances = new Map();
    status = 'unlocked';
    emit();
  }

  function dropPendingMaster() {
    if (pendingMaster) pendingMaster.fill(0);
    pendingMaster = null;
  }

  // ------------------------------------------------------------ lifecycle

  /** True when a vault blob (v1 or v2) exists in storage. */
  function hasVault() {
    return vaultExists(storage);
  }

  /**
   * Create a fresh vault plus its first account. The password is used
   * to encrypt the vault and then forgotten — it is never persisted.
   */
  async function create(password, firstScheme) {
    const created = await createVault(storage, password);
    await adoptVault(created);
    if (firstScheme) await addAccount(firstScheme);
    return snapshot();
  }

  /** Manual unlock. The password stays in memory only, never stored. */
  async function unlock(password) {
    const opened = await unlockVault(storage, password); // throws on bad pw
    await adoptVault(opened);
    return snapshot();
  }

  // ------------------------------------------------------- recovery phrase

  /**
   * Begin a phrase-backed create: generate a fresh master seed, keep
   * it in memory ONLY (never persisted), and return its 24-word
   * recovery phrase for the write-it-down step. Complete the create
   * with createFromPhrase(password), or abandon it with
   * cancelPhraseCreate() (which zeroizes the pending seed).
   */
  function beginPhraseCreate() {
    if (hasVault()) throw Error('Vault already exists');
    dropPendingMaster();
    pendingMaster = generateMasterSeed();
    return entropyToMnemonic(pendingMaster);
  }

  /** Abandon a pending phrase create, zeroizing the pending seed. */
  function cancelPhraseCreate() {
    dropPendingMaster();
  }

  /**
   * Complete a phrase-backed create: build the master vault from the
   * pending seed and materialize the index-0 account of every scheme.
   */
  async function createFromPhrase(password) {
    if (!pendingMaster) throw Error('No pending recovery phrase — start the create again');
    const created = await createMasterVault(storage, password, pendingMaster);
    dropPendingMaster();
    await adoptVault(created);
    for (const scheme of SCHEME_LIST) await addAccount(scheme);
    return snapshot();
  }

  /**
   * Restore a wallet from its 24-word recovery phrase under a NEW
   * wallet password. The phrase decodes to the master seed (checksum
   * validated — a bad phrase throws before anything is written).
   * Index-0 accounts are materialized for all three schemes; indices
   * 1..RESTORE_PROBE_MAX_INDEX are then probed via the configured RPC
   * (balance or nonce > 0 counts as used) and materialized too.
   * Returns { snapshot, probed } — probed is false when the RPC was
   * unreachable, in which case only the index-0 accounts exist and the
   * UI must say so.
   */
  async function restoreFromPhrase(phrase, newPassword) {
    if (hasVault()) throw Error('Vault already exists');
    const master = mnemonicToEntropy(phrase); // throws on a bad phrase
    try {
      const created = await createMasterVault(storage, newPassword, master);
      await adoptVault(created);
    } finally {
      master.fill(0); // the vault holds its own copy; scrub ours
    }
    for (const scheme of SCHEME_LIST) await addAccount(scheme);

    let probed = false;
    try {
      const client = rpc();
      const seedCopy = vault.exportMasterSeed();
      try {
        const highestUsed = new Map();
        for (const scheme of SCHEME_LIST) {
          for (let index = 1; index <= RESTORE_PROBE_MAX_INDEX; index++) {
            const address = deriveAccountAddress(seedCopy, scheme, index);
            const [balance, nonce] = await Promise.all([
              client.getBalance(address),
              client.getTransactionCount(address),
            ]);
            if (balance > 0n || nonce > 0) highestUsed.set(scheme, index);
          }
        }
        for (const scheme of SCHEME_LIST) {
          const want = highestUsed.get(scheme) ?? 0;
          const have = new Set(
            vault
              .listAccounts()
              .filter((a) => a.scheme === scheme)
              .map((a) => a.index),
          );
          for (let index = 1; index <= want; index++) {
            if (!have.has(index)) await vault.addAccount(scheme, { index });
          }
        }
        probed = true;
      } finally {
        seedCopy.fill(0);
      }
    } catch {
      probed = false; // RPC unreachable: index-0 accounts only
    }
    cacheAccounts();
    emit();
    return { snapshot: snapshot(), probed };
  }

  /**
   * Reveal the recovery phrase of a master wallet. The wallet password
   * is re-verified against the stored vault first (a wrong password
   * throws); legacy wallets throw 'No recovery phrase for this wallet'.
   * Returns the 24 words. The phrase exists only in this return value
   * and the caller's UI state — it is never persisted or logged.
   */
  async function revealPhrase(password) {
    if (!vault) throw Error('Vault is locked');
    if (!vault.isMaster) throw Error('No recovery phrase for this wallet');
    const check = await unlockVault(storage, password); // throws on bad pw
    check.lock();
    const master = vault.exportMasterSeed();
    try {
      return entropyToMnemonic(master);
    } finally {
      master.fill(0);
    }
  }

  // ------------------------------------------------------------ backup file

  /** Export this wallet as an encrypted backup string (see vault.mjs). */
  async function exportBackup(backupPassword) {
    if (!vault) throw Error('Vault is locked');
    return vault.exportBackup(backupPassword);
  }

  /**
   * Import an encrypted backup as this device's vault under a new
   * wallet password. Only valid when no vault exists yet.
   */
  async function importBackup(backupText, backupPassword, walletPassword) {
    if (hasVault()) throw Error('Vault already exists');
    const imported = await importVaultBackup(storage, backupText, backupPassword, walletPassword);
    await adoptVault(imported);
    return snapshot();
  }

  /**
   * Startup hook. Sessions are memory-only, so there is nothing to
   * restore: this just re-scrubs the legacy remembered-password key
   * (in case anything re-created it) and returns the current state.
   * A wallet that exists starts 'locked' and needs its password.
   */
  async function start() {
    storage.removeItem(AUTOUNLOCK_KEY);
    return snapshot();
  }

  /** Lock now: zeroize via the vault and drop all in-memory state. */
  function lock() {
    if (vault) vault.lock();
    vault = null;
    accounts = [];
    balances = new Map();
    migratedFromV1 = false;
    walletIsMaster = false;
    dropPendingMaster();
    storage.removeItem(AUTOUNLOCK_KEY); // defensive: no legacy key lingers
    status = hasVault() ? 'locked' : 'no-vault';
    emit();
  }

  /**
   * Reset flow (v3): delete this device's wallet — vault key, legacy
   * autounlock key, and all zeronyth-tokens:* keys. The migration
   * backup key is intentionally kept, exactly as v3 kept it. Caller
   * reloads the UI.
   */
  function wipe() {
    if (vault) vault.lock();
    vault = null;
    accounts = [];
    balances = new Map();
    migratedFromV1 = false;
    walletIsMaster = false;
    dropPendingMaster();
    const doomed = storageKeys(storage).filter((k) => k.startsWith(TOKEN_PREFIX));
    for (const k of doomed) storage.removeItem(k);
    storage.removeItem(VAULT_KEY);
    storage.removeItem(AUTOUNLOCK_KEY);
    status = 'no-vault';
    emit();
  }

  // ------------------------------------------------------------ accounts

  async function addAccount(scheme) {
    if (!vault) throw Error('Vault is locked');
    const summary = await vault.addAccount(scheme);
    cacheAccounts();
    emit();
    return summary;
  }

  function getAccount(accountId) {
    return accounts.find((a) => a.id === accountId) ?? null;
  }

  // ------------------------------------------------------------ network

  function setRpcUrl(url) {
    if (typeof url !== 'string' || !url.trim()) throw Error('RPC URL required');
    storage.setItem(RPC_URL_KEY, url.trim());
    emit();
  }

  /** { ok, chainId } — ok only when the endpoint answers with 912701. */
  async function checkConnection() {
    try {
      const chainId = BigInt(await rpc().call('eth_chainId', []));
      return { ok: chainId === CHAIN_ID, chainId };
    } catch (e) {
      return { ok: false, chainId: null, error: e };
    }
  }

  /** Refresh every account's balance; failures leave the balance null. */
  async function refreshBalances() {
    const client = rpc();
    await Promise.all(
      accounts.map(async (a) => {
        try {
          balances.set(a.id, await client.getBalance(a.address));
        } catch {
          balances.set(a.id, null);
        }
      }),
    );
    emit();
    return Object.fromEntries(balances);
  }

  /** Request test funds for an account via the gateway's zny_faucet. */
  async function faucet(accountId) {
    const account = getAccount(accountId);
    if (!account) throw Error(`No such account: ${accountId}`);
    return rpc().call('zny_faucet', [account.address]);
  }

  // ------------------------------------------------------------ sending

  /**
   * Build the review model for a send: resolves nonce, gas price and the
   * gas limit per gas.mjs policy (plain transfer -> exact intrinsic;
   * call -> eth_estimateGas + scheme surcharge). Nothing is signed here.
   * `to` may be null ONLY when data is present (contract creation).
   */
  async function prepareSend(accountId, { to = null, value = 0n, data = '0x' } = {}) {
    const account = getAccount(accountId);
    if (!account) throw Error(`No such account: ${accountId}`);
    if (to != null && !isAddress(to)) throw Error('Invalid address');
    if (!isHexData(data)) throw Error('Invalid data');
    const hasData = data != null && data !== '0x';
    if (to == null && !hasData) throw Error('Invalid address');

    const client = rpc();
    const nonce = await client.getTransactionCount(account.address);
    let gasPrice;
    try {
      gasPrice = await client.gasPrice();
      if (gasPrice === 0n) gasPrice = FALLBACK_GAS_PRICE;
    } catch {
      gasPrice = FALLBACK_GAS_PRICE;
    }

    let gasLimit;
    let estimate = null;
    if (!hasData) {
      gasLimit = transferGasLimit(account.scheme);
    } else {
      const call = { from: account.address, value: quantityHex(value), data };
      if (to != null) call.to = to;
      estimate = await client.estimateGas(call);
      gasLimit = callGasLimit(account.scheme, estimate);
    }

    let balance = null;
    try {
      balance = await client.getBalance(account.address);
    } catch {
      /* balance stays unknown; the chain remains the arbiter */
    }

    return {
      accountId,
      scheme: account.scheme,
      from: account.address,
      to,
      value: typeof value === 'bigint' ? value : BigInt(value),
      data: hasData ? data : '0x',
      nonce,
      gasPrice,
      gasLimit,
      estimate,
      fee: gasLimit * gasPrice,
      balance,
      chainId: CHAIN_ID,
    };
  }

  /**
   * Sign a prepared send with the vault and broadcast it.
   * Returns { hash, signed } — signed is the core's { rawTx, txHash, from }.
   */
  async function executeSend(prepared) {
    if (!vault) throw Error('Vault is locked');
    const signed = signWithVault(vault, prepared.accountId, {
      nonce: prepared.nonce,
      gasPrice: prepared.gasPrice,
      gasLimit: prepared.gasLimit,
      to: prepared.to,
      value: prepared.value,
      data: prepared.data,
      chainId: prepared.chainId,
    });
    const hash = await rpc().sendRawTransaction(signed.rawTx);
    return { hash, signed };
  }

  /**
   * Poll a receipt until it is final or attempts run out.
   * onUpdate({ state, receipt }) fires for 'pending' ticks and the final
   * state ('success' | 'failed'). Resolves with { state, receipt }.
   */
  async function pollReceipt(hash, { onUpdate, intervalMs = 2000, maxAttempts = 30 } = {}) {
    const client = rpc();
    for (let i = 0; i < maxAttempts; i++) {
      let receipt = null;
      try {
        receipt = await client.getTransactionReceipt(hash);
      } catch {
        receipt = null; // transient RPC failure: keep polling
      }
      if (receipt) {
        const state = receipt.status === '0x1' ? 'success' : 'failed';
        onUpdate?.({ state, receipt });
        return { state, receipt };
      }
      onUpdate?.({ state: 'pending', receipt: null });
      if (i < maxAttempts - 1) await sleep(intervalMs);
    }
    return { state: 'pending', receipt: null };
  }

  // ------------------------------------------------------------ plumbing

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    get state() {
      return snapshot();
    },
    subscribe,
    hasVault,
    start,
    create,
    unlock,
    beginPhraseCreate,
    cancelPhraseCreate,
    createFromPhrase,
    restoreFromPhrase,
    revealPhrase,
    exportBackup,
    importBackup,
    lock,
    wipe,
    addAccount,
    getAccount,
    getRpcUrl,
    setRpcUrl,
    checkConnection,
    refreshBalances,
    faucet,
    prepareSend,
    executeSend,
    pollReceipt,
  };
}
