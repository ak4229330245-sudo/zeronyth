// Session controller — the wallet's framework-free application core.
//
// Owns everything the UI needs so the UI itself is a thin renderer:
//   - vault lifecycle (create / unlock / lock / add account) over an
//     injected Storage-like object and the Phase 1 vault core,
//   - the reset + stay-unlocked behaviors ported from reset-wallet v3,
//   - the send pipeline (prepare -> review -> sign -> broadcast -> poll)
//     over the Phase 2 engines and gas policy,
//   - balances, the zny_faucet call, and connection checks.
//
// reset-wallet v3 semantics, translated from DOM-watching to direct
// knowledge (the behaviors are identical, the mechanism is not):
//   * Stay unlocked: the password is written to
//     "zeronyth.qwallet.autounlock" ONLY after a successful create or
//     manual unlock; on later loads it is tried at most once
//     (tryAutoUnlock); a failed AUTO attempt erases it; Lock erases it.
//     A failed MANUAL unlock leaves any saved password untouched.
//   * Reset: wiping removes the vault key ("zeronyth-vault-v1"), the
//     autounlock key, and every "zeronyth-tokens:*" key — exactly the
//     v3 deletion set. The v1 migration backup
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
  unlockVault,
  VAULT_KEY,
  VAULT_BACKUP_KEY,
} from '../core/vault.mjs';
import { signWithVault } from '../core/tx.mjs';
import { transferGasLimit, callGasLimit } from '../core/gas.mjs';
import { isAddress, isHexData } from '../core/amount.mjs';

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

  let vault = null;
  let status = vaultExists(storage) ? 'locked' : 'no-vault'; // no-vault|locked|unlocked
  let accounts = []; // cached summaries (secret-free)
  let balances = new Map(); // accountId -> bigint | null (null = unknown)
  let migratedFromV1 = false;
  let autoAttempted = false;
  const listeners = new Set();

  const snapshot = () => ({
    status,
    accounts: accounts.map((a) => ({ ...a })),
    migratedFromV1,
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
    cacheAccounts();
    balances = new Map();
    status = 'unlocked';
    emit();
  }

  // ------------------------------------------------------------ lifecycle

  /** True when a vault blob (v1 or v2) exists in storage. */
  function hasVault() {
    return vaultExists(storage);
  }

  /** Create a fresh vault plus its first account. Remembers the password. */
  async function create(password, firstScheme) {
    const created = await createVault(storage, password);
    await adoptVault(created);
    storage.setItem(AUTOUNLOCK_KEY, password); // v3: saved on success
    if (firstScheme) await addAccount(firstScheme);
    return snapshot();
  }

  /** Manual unlock. On success the password is remembered (v3). */
  async function unlock(password) {
    const opened = await unlockVault(storage, password); // throws on bad pw
    await adoptVault(opened);
    storage.setItem(AUTOUNLOCK_KEY, password);
    return snapshot();
  }

  /**
   * One automatic unlock attempt per load, using the remembered
   * password. A failed attempt erases the remembered password (v3).
   * Returns true when the session ended up unlocked.
   */
  async function tryAutoUnlock() {
    if (autoAttempted) return status === 'unlocked';
    autoAttempted = true;
    if (status === 'unlocked') return true;
    const saved = storage.getItem(AUTOUNLOCK_KEY);
    if (!saved || !hasVault()) return false;
    try {
      const opened = await unlockVault(storage, saved);
      await adoptVault(opened);
      return true;
    } catch {
      storage.removeItem(AUTOUNLOCK_KEY);
      return false;
    }
  }

  /** Startup: perform the single allowed auto-unlock attempt, if any. */
  async function start() {
    await tryAutoUnlock();
    return snapshot();
  }

  /** Lock now: zeroize via the vault, drop caches, forget the password. */
  function lock() {
    if (vault) vault.lock();
    vault = null;
    accounts = [];
    balances = new Map();
    migratedFromV1 = false;
    storage.removeItem(AUTOUNLOCK_KEY); // v3: Lock forgets
    status = hasVault() ? 'locked' : 'no-vault';
    emit();
  }

  /**
   * Reset flow (v3): delete this device's wallet — vault key, autounlock
   * key, and all zeronyth-tokens:* keys. The migration backup key is
   * intentionally kept, exactly as v3 kept it. Caller reloads the UI.
   */
  function wipe() {
    if (vault) vault.lock();
    vault = null;
    accounts = [];
    balances = new Map();
    migratedFromV1 = false;
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
    tryAutoUnlock,
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
