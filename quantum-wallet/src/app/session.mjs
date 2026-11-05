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
// Multi-chain (v12): the session is network-aware. The selected network
// (src/core/networks.mjs) decides which accounts may operate, which
// client serves balances/sends, and how transactions are built:
//   - ZERONYTH (912701): the original three-scheme path, unchanged.
//   - Remote EVM networks: ECDSA only (PQ sends are refused here, in
//     the session layer — not merely hidden in the UI), EIP-155 with
//     the network's chainId, gas from eth_estimateGas + 20% buffer and
//     eth_gasPrice, optional wZNYT token sends. The RPC's eth_chainId
//     is verified against the selected network before signing.
//   - Chain families (solana/bitcoin/xrp/sui/aptos): the per-chain
//     engines in src/core/chains/ prepare/execute; only accounts of
//     the matching family operate.
// The ZERONYTH AMM swap (src/core/swap.mjs) runs on the ZERONYTH
// network through this same send pipeline (approve step + swap step).
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
// Unlock backoff (v12 hardening): consecutive failed unlocks are
// counted in memory and in a persisted counter (timestamps only — the
// key never holds any secret). After 3 failures the next attempt is
// delayed 5 s, doubling per further failure, capped at 5 minutes.
// Honest limit: this is a speed bump against casual guessing on an
// unattended unlocked browser profile; anyone who can read the
// device's storage can also delete the counter. The vault's actual
// strength is unchanged (PBKDF2-SHA256 600k + AES-256-GCM).
//
// reset-wallet v3 semantics for reset, translated from DOM-watching to
// direct knowledge (the behavior is identical, the mechanism is not):
//   * Reset: wiping removes the vault key ("zeronyth-vault-v1"), the
//     legacy autounlock key, and every "zeronyth-tokens:*" key — exactly
//     the v3 deletion set. The v1 migration backup
//     ("zeronyth-vault-v1-backup") is NOT removed, matching v3.
//   * No idle auto-lock from the reset tool; v12 adds its own idle
//     auto-lock in the UI layer (src/app/idle.mjs) calling lock().
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
import { isEvmScheme } from '../core/crypto.mjs';
import {
  NETWORKS,
  DEFAULT_NETWORK_ID,
  getNetwork,
  findNetwork,
  networkPersistKey,
  schemeAllowedOn,
  erc20TransferData,
  erc20BalanceOfData,
} from '../core/networks.mjs';
import {
  ammQuote,
  ammSwapCall,
  ammApproveCall,
  ammAllowanceOf,
  ammTokenOf,
  DEFAULT_SLIPPAGE_BPS,
} from '../core/swap.mjs';
import { createSolanaClient } from '../core/chains/solana.mjs';
import { createBitcoinClient, convertAddress as convertBitcoinAddress } from '../core/chains/bitcoin.mjs';
import { createXrpClient } from '../core/chains/xrp.mjs';
import { createSuiClient } from '../core/chains/sui.mjs';
import { createAptosClient } from '../core/chains/aptos.mjs';

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

/** Selected network persistence (EVM networks persist by chainId). */
export const NETWORK_KEY = 'zeronyth.qwallet.network';
/** Per-network RPC overrides: JSON map, chainId (EVM) or network id → URL. */
export const RPC_BY_CHAIN_KEY = 'zeronyth.qwallet.rpcByChain';
/** Failed-unlock counter: { count, nextAllowedAt } — no secrets, ever. */
export const UNLOCK_FAIL_KEY = 'zeronyth.qwallet.unlockFails';
/** Sent-address history for first-send warnings: address strings only. */
export const SENT_TO_KEY = 'zeronyth.qwallet.sentTo';
/** Production origin — the only origin whose gateway serves RPC proxies. */
export const PRODUCTION_ORIGIN = 'https://zeronyth.dpdns.org';

const CHAIN_CLIENT_FACTORIES = Object.freeze({
  solana: (apiBase, opts) => createSolanaClient(apiBase, opts),
  bitcoin: (apiBase, opts) => createBitcoinClient(apiBase, opts),
  xrp: (apiBase, opts) => createXrpClient(apiBase, opts),
  sui: (apiBase, opts) => createSuiClient(apiBase, opts),
  aptos: (apiBase, opts) => createAptosClient(apiBase, opts),
});

export function explorerTxUrl(hash) {
  return `${EXPLORER_BASE}/tx/${hash}`;
}

/** Delay before the next unlock attempt after `failCount` failures (s). */
export function unlockDelaySeconds(failCount) {
  if (!Number.isSafeInteger(failCount) || failCount < 3) return 0;
  return Math.min(5 * 2 ** (failCount - 3), 300);
}

/** Normalize an address for the sent-history (EVM hex → lowercase). */
export function normalizeSentAddress(address) {
  const text = String(address ?? '');
  return /^0x[0-9a-fA-F]+$/.test(text) ? text.toLowerCase() : text;
}

/** Pure decision behind the first-send warning. */
export function isFirstSendAddress(history, address) {
  return !history.includes(normalizeSentAddress(address));
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
  now = () => Date.now(),
  pageOrigin = () => (typeof location !== 'undefined' ? location.origin : null),
  chainClientFactory = null,
  manifestFetcher = null,
  swapManifestUrl = '/api/points/rules',
} = {}) {
  if (!storage) throw Error('storage required');

  // Scrub the legacy remembered-password key immediately at startup:
  // pre-fix builds may have left the vault password in storage.
  storage.removeItem(AUTOUNLOCK_KEY);

  let vault = null;
  let status = vaultExists(storage) ? 'locked' : 'no-vault'; // no-vault|locked|unlocked
  let accounts = []; // cached summaries (secret-free)
  let balances = new Map(); // accountId -> bigint | null (null = unknown)
  let tokenBalances = new Map(); // accountId -> Map(tokenAddressLower -> bigint | null)
  let migratedFromV1 = false;
  let walletIsMaster = false; // phrase-backed wallet (recovery phrase exists)
  let pendingMaster = null; // master seed awaiting phrase-create confirmation
  let network = findNetwork(storage.getItem(NETWORK_KEY)) ?? getNetwork(DEFAULT_NETWORK_ID);
  let chainClientCache = new Map(); // networkId+apiBase -> engine client
  let swapManifestCache = null;
  const listeners = new Set();

  const snapshot = () => ({
    status,
    accounts: accounts.map((a) => ({ ...a })),
    migratedFromV1,
    hasPhrase: walletIsMaster,
    balances: Object.fromEntries(balances),
    tokenBalances: Object.fromEntries(
      [...tokenBalances].map(([id, byToken]) => [id, Object.fromEntries(byToken)]),
    ),
    hasBackup: storage.getItem(VAULT_BACKUP_KEY) != null,
    rpcUrl: getRpcUrl(),
    networkId: network.id,
    customRpc: isCustomRpc(),
  });
  const emit = () => {
    const s = snapshot();
    for (const fn of listeners) fn(s);
  };

  // ------------------------------------------------------------ networks

  function currentNetwork() {
    return network;
  }

  function rpcMapKey(net) {
    return net.kind === 'evm' ? String(net.chainId) : net.id;
  }

  function readRpcOverrides() {
    try {
      const parsed = JSON.parse(storage.getItem(RPC_BY_CHAIN_KEY) ?? '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  /**
   * The default API base for a network: its pinned gateway proxy path
   * when running on the production origin and the upstream lacks CORS,
   * otherwise the canonical public endpoint.
   */
  function defaultApiBase(net) {
    if (net.corsProxy && pageOrigin() === PRODUCTION_ORIGIN) {
      return PRODUCTION_ORIGIN + net.corsProxy;
    }
    return net.api;
  }

  function getRpcUrl(net = network) {
    const overrides = readRpcOverrides();
    const override = overrides[rpcMapKey(net)];
    if (typeof override === 'string' && override) return override;
    if (net.chainId === 912701) {
      const legacy = storage.getItem(RPC_URL_KEY);
      if (legacy) return legacy;
    }
    return defaultApiBase(net);
  }

  function isCustomRpc(net = network) {
    const overrides = readRpcOverrides();
    if (typeof overrides[rpcMapKey(net)] === 'string') return true;
    if (net.chainId === 912701 && storage.getItem(RPC_URL_KEY)) return true;
    return false;
  }

  function setRpcUrl(url, net = network) {
    if (typeof url !== 'string' || !url.trim()) throw Error('RPC URL required');
    const trimmed = url.trim();
    const overrides = readRpcOverrides();
    if (trimmed === net.api) delete overrides[rpcMapKey(net)];
    else overrides[rpcMapKey(net)] = trimmed;
    storage.setItem(RPC_BY_CHAIN_KEY, JSON.stringify(overrides));
    if (net.chainId === 912701) {
      // Keep the legacy single-key in sync for the home network.
      if (trimmed === net.api) storage.removeItem(RPC_URL_KEY);
      else storage.setItem(RPC_URL_KEY, trimmed);
    }
    chainClientCache.delete(net.id);
    emit();
  }

  function setNetwork(idOrPersisted) {
    const next = findNetwork(idOrPersisted) ?? getNetwork(idOrPersisted);
    if (!next) throw Error(`Unknown network: ${idOrPersisted}`);
    network = next;
    storage.setItem(NETWORK_KEY, networkPersistKey(network));
    balances = new Map();
    tokenBalances = new Map();
    emit();
    return network;
  }

  /** JSON-RPC client for an EVM network (default: the selected one). */
  function evmRpc(net = network) {
    return rpcFactory(getRpcUrl(net));
  }
  const rpc = () => evmRpc(network);
  /** The home-network client, regardless of the current selection. */
  const zeronythRpc = () => evmRpc(getNetwork(DEFAULT_NETWORK_ID));

  function chainClient(net = network) {
    const apiBase = getRpcUrl(net);
    const cacheKey = `${net.id}|${apiBase}`;
    if (!chainClientCache.has(cacheKey)) {
      const factory =
        chainClientFactory ?? ((kind, base) => CHAIN_CLIENT_FACTORIES[kind](base, {}));
      chainClientCache.set(cacheKey, factory(net.kind, apiBase));
    }
    return chainClientCache.get(cacheKey);
  }

  /** The address of an account AS SEEN on a chain-family network. */
  function familyAddress(account, net = network) {
    if (net.kind === 'bitcoin') {
      return convertBitcoinAddress(account.address, net.testnet ? 'testnet' : 'mainnet');
    }
    return account.address;
  }

  function cacheAccounts() {
    accounts = vault.listAccounts();
  }

  async function adoptVault(unlocked) {
    vault = unlocked;
    migratedFromV1 = unlocked.migratedFromV1 === true;
    walletIsMaster = unlocked.isMaster === true;
    cacheAccounts();
    balances = new Map();
    tokenBalances = new Map();
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

  function readUnlockFails() {
    try {
      const parsed = JSON.parse(storage.getItem(UNLOCK_FAIL_KEY) ?? 'null');
      if (parsed && Number.isSafeInteger(parsed.count)) {
        return { count: parsed.count, nextAllowedAt: Number(parsed.nextAllowedAt) || 0 };
      }
    } catch {
      /* corrupted counter → treat as fresh */
    }
    return { count: 0, nextAllowedAt: 0 };
  }

  /**
   * Manual unlock, with escalating backoff after repeated failures
   * (see the header comment — a speed bump, not a strength change).
   * The password stays in memory only, never stored.
   */
  async function unlock(password) {
    const fails = readUnlockFails();
    const nowMs = now();
    if (fails.nextAllowedAt && nowMs < fails.nextAllowedAt) {
      const wait = Math.ceil((fails.nextAllowedAt - nowMs) / 1000);
      throw Error(`Too many attempts — wait ${wait}s`);
    }
    let opened;
    try {
      opened = await unlockVault(storage, password); // throws on bad pw
    } catch (e) {
      const count = fails.count + 1;
      const delay = unlockDelaySeconds(count);
      storage.setItem(
        UNLOCK_FAIL_KEY,
        JSON.stringify({ count, nextAllowedAt: delay ? now() + delay * 1000 : 0 }),
      );
      throw e;
    }
    storage.removeItem(UNLOCK_FAIL_KEY);
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
   * 1..RESTORE_PROBE_MAX_INDEX are then probed via the ZERONYTH RPC
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
      const client = zeronythRpc();
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
    tokenBalances = new Map();
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
    tokenBalances = new Map();
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

  // ------------------------------------------------------- sent history

  /** Addresses this wallet has sent to (for first-send warnings). */
  function sentHistory() {
    try {
      const parsed = JSON.parse(storage.getItem(SENT_TO_KEY) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  function isFirstSendTo(address) {
    return isFirstSendAddress(sentHistory(), address);
  }

  function recordSentTo(address) {
    if (!address) return;
    const normalized = normalizeSentAddress(address);
    const history = sentHistory();
    if (history.includes(normalized)) return;
    history.push(normalized);
    storage.setItem(SENT_TO_KEY, JSON.stringify(history.slice(-500)));
  }

  // ------------------------------------------------------------ network ops

  /** { ok, chainId } — ok only when the endpoint answers as expected. */
  async function checkConnection() {
    const net = network;
    try {
      if (net.kind === 'evm') {
        const chainId = BigInt(await evmRpc(net).call('eth_chainId', []));
        return { ok: chainId === BigInt(net.chainId), chainId };
      }
      const ok = await chainClient(net).checkConnection();
      return { ok: ok === true, chainId: null };
    } catch (e) {
      return { ok: false, chainId: null, error: e };
    }
  }

  /**
   * Refresh every operable account's balance on the selected network;
   * failures leave the balance null. Inoperable accounts (wrong scheme
   * family for the network) are reset to unknown.
   */
  async function refreshBalances() {
    const net = network;
    if (net.kind === 'evm') {
      const client = evmRpc(net);
      await Promise.all(
        accounts.map(async (a) => {
          if (!schemeAllowedOn(net, a.scheme)) {
            balances.set(a.id, null);
            return;
          }
          try {
            balances.set(a.id, await client.getBalance(a.address));
          } catch {
            balances.set(a.id, null);
          }
        }),
      );
      if (net.tokens.length > 0) {
        await Promise.all(
          accounts
            .filter((a) => a.scheme === 'ecdsa')
            .map(async (a) => {
              const byToken = new Map();
              for (const token of net.tokens) {
                try {
                  const raw = await client.ethCall({
                    to: token.address,
                    data: erc20BalanceOfData(a.address),
                  });
                  byToken.set(token.address.toLowerCase(), BigInt(raw));
                } catch {
                  byToken.set(token.address.toLowerCase(), null);
                }
              }
              tokenBalances.set(a.id, byToken);
            }),
        );
      } else {
        tokenBalances = new Map();
      }
    } else {
      const client = chainClient(net);
      await Promise.all(
        accounts.map(async (a) => {
          if (!schemeAllowedOn(net, a.scheme)) {
            balances.set(a.id, null);
            return;
          }
          try {
            balances.set(a.id, await client.getBalance(familyAddress(a, net)));
          } catch {
            balances.set(a.id, null);
          }
        }),
      );
      tokenBalances = new Map();
    }
    emit();
    return Object.fromEntries(balances);
  }

  /** Request test funds for an account via the gateway's zny_faucet. */
  async function faucet(accountId) {
    if (!network.faucet) throw Error('Faucet is only available on ZERONYTH');
    const account = getAccount(accountId);
    if (!account) throw Error(`No such account: ${accountId}`);
    return zeronythRpc().call('zny_faucet', [account.address]);
  }

  // ------------------------------------------------------------ sending

  async function recipientIsContract(client, to) {
    try {
      if (typeof client.getCode !== 'function') return false;
      const code = await client.getCode(to);
      return typeof code === 'string' && code !== '0x';
    } catch {
      return false;
    }
  }

  /**
   * Defense-in-depth scheme gate (the UI greys these out too): an
   * account may only send on networks its scheme operates on. PQ
   * accounts in particular can never send off ZERONYTH.
   */
  function assertSchemeOperable(account, net) {
    if (schemeAllowedOn(net, account.scheme)) return;
    if (isEvmScheme(account.scheme) && account.scheme !== 'ecdsa') {
      throw Error('PQ accounts can only send on the ZERONYTH network');
    }
    throw Error(`A ${account.scheme} account cannot send on ${net.name}`);
  }

  /** The exact v11 ZERONYTH prepare path (plus contract detection). */
  async function prepareZeronythSend(account, { to, value, data }, { estimateFallback = null } = {}) {
    const client = zeronythRpc();
    const nonce = await client.getTransactionCount(account.address);
    let gasPrice;
    try {
      gasPrice = await client.gasPrice();
      if (gasPrice === 0n) gasPrice = FALLBACK_GAS_PRICE;
    } catch {
      gasPrice = FALLBACK_GAS_PRICE;
    }
    const hasData = data != null && data !== '0x';
    let gasLimit;
    let estimate = null;
    if (!hasData) {
      gasLimit = transferGasLimit(account.scheme);
    } else {
      const call = { from: account.address, value: quantityHex(value), data };
      if (to != null) call.to = to;
      try {
        estimate = await client.estimateGas(call);
      } catch (e) {
        // Display-only preparations (the swap review model) may ask for
        // an estimate whose preconditions an earlier, not-yet-executed
        // step will create — e.g. a router call that pulls tokens the
        // pending approve step has not yet authorized. The caller may
        // supply estimateFallback for that case; execution always
        // re-prepares against live state, so the fallback never signs.
        if (estimateFallback == null) throw e;
        estimate = estimateFallback;
      }
      gasLimit = callGasLimit(account.scheme, estimate);
    }
    let balance = null;
    try {
      balance = await client.getBalance(account.address);
    } catch {
      /* balance stays unknown; the chain remains the arbiter */
    }
    return {
      kind: 'evm',
      networkId: network.id,
      networkName: network.name,
      accountId: account.id,
      scheme: account.scheme,
      from: account.address,
      to,
      txTo: to,
      txValue: value,
      value,
      data: hasData ? data : '0x',
      nonce,
      gasPrice,
      gasLimit,
      estimate,
      fee: gasLimit * gasPrice,
      balance,
      nativeBalance: balance,
      chainId: CHAIN_ID,
      asset: 'native',
      symbol: network.native.symbol,
      decimals: network.native.decimals,
      recipientIsContract: to != null && !hasData ? await recipientIsContract(client, to) : false,
    };
  }

  /**
   * Remote-EVM prepare: the RPC's chainId is verified FIRST (a wrong
   * endpoint must never see a signature for another chain), then gas
   * comes from eth_estimateGas (+20% buffer) and eth_gasPrice — the
   * 912701 intrinsic table does not apply off-912701.
   */
  async function prepareRemoteEvmSend(account, net, { to, value, data, asset }) {
    const client = evmRpc(net);
    const rpcChainId = BigInt(await client.call('eth_chainId', []));
    if (rpcChainId !== BigInt(net.chainId)) {
      throw Error(`Chain ID mismatch: RPC reports chain ${rpcChainId}, expected ${net.chainId}`);
    }
    const token =
      asset === 'native'
        ? null
        : net.tokens.find((t) => t.address.toLowerCase() === String(asset).toLowerCase());
    if (asset !== 'native' && !token) throw Error(`Unknown token on ${net.name}: ${asset}`);

    const nonce = await client.getTransactionCount(account.address);
    const gasPrice = await client.gasPrice();
    const hasData = data != null && data !== '0x';

    let txTo;
    let txValue;
    let txData;
    let balance;
    let nativeBalance = null;
    try {
      nativeBalance = await client.getBalance(account.address);
    } catch {
      /* unknown; the chain remains the arbiter */
    }
    if (token) {
      if (hasData) throw Error('Token sends do not take custom data');
      txTo = token.address;
      txValue = 0n;
      txData = erc20TransferData(to, value);
      try {
        const raw = await client.ethCall({ to: token.address, data: erc20BalanceOfData(account.address) });
        balance = BigInt(raw);
      } catch {
        balance = null;
      }
    } else {
      txTo = to;
      txValue = value;
      txData = hasData ? data : '0x';
      balance = nativeBalance;
    }
    const call = { from: account.address, value: quantityHex(txValue), data: txData };
    if (txTo != null) call.to = txTo;
    const estimate = await client.estimateGas(call);
    const gasLimit = estimate + estimate / 5n; // +20% buffer

    return {
      kind: 'evm',
      networkId: net.id,
      networkName: net.name,
      accountId: account.id,
      scheme: account.scheme,
      from: account.address,
      to,
      txTo,
      txValue,
      value,
      data: txData,
      nonce,
      gasPrice,
      gasLimit,
      estimate,
      fee: gasLimit * gasPrice,
      balance,
      nativeBalance,
      chainId: BigInt(net.chainId),
      asset: token ? token.address : 'native',
      symbol: token ? token.symbol : net.native.symbol,
      decimals: token ? token.decimals : net.native.decimals,
      recipientIsContract: !token && to != null ? await recipientIsContract(client, to) : false,
    };
  }

  /** Chain-family prepare: the engine assembles the chain-native plan. */
  async function prepareChainSend(account, net, { to, value, destinationTag }) {
    if (typeof to !== 'string' || !to) throw Error('Invalid address');
    const client = chainClient(net);
    const from = familyAddress(account, net);
    const plan = await client.prepareSend({
      from,
      to,
      amount: value,
      opts: { destinationTag },
    });
    return {
      kind: 'chain',
      networkId: net.id,
      networkName: net.name,
      accountId: account.id,
      scheme: account.scheme,
      from,
      to,
      value,
      data: '0x',
      fee: plan.fee,
      balance: plan.balance,
      chainId: null,
      asset: 'native',
      symbol: net.native.symbol,
      decimals: net.native.decimals,
      recipientIsContract: false,
      plan,
    };
  }

  /**
   * Build the review model for a send. `asset` is 'native' (default) or
   * a token contract address (remote EVM networks with built-in tokens).
   * `to` may be null ONLY when data is present (contract creation,
   * ZERONYTH network).
   */
  async function prepareSend(accountId, { to = null, value = 0n, data = '0x', asset = 'native', destinationTag, estimateFallback = null } = {}) {
    const account = getAccount(accountId);
    if (!account) throw Error(`No such account: ${accountId}`);
    assertSchemeOperable(account, network);
    const valueBig = typeof value === 'bigint' ? value : BigInt(value);

    if (network.kind !== 'evm') {
      return prepareChainSend(account, network, { to, value: valueBig, destinationTag });
    }
    if (to != null && !isAddress(to)) throw Error('Invalid address');
    if (!isHexData(data)) throw Error('Invalid data');
    const hasData = data != null && data !== '0x';
    if (to == null && !hasData) throw Error('Invalid address');
    if (network.chainId === 912701) {
      if (asset !== 'native') throw Error('Token sends are handled by the swap screen on ZERONYTH');
      return prepareZeronythSend(account, { to, value: valueBig, data }, { estimateFallback });
    }
    return prepareRemoteEvmSend(account, network, { to, value: valueBig, data, asset });
  }

  /**
   * Sign a prepared send with the vault and broadcast it.
   * Returns { hash, signed } for EVM sends (signed is the core's
   * { rawTx, txHash, from }); { hash } for chain-family sends.
   */
  async function executeSend(prepared) {
    if (!vault) throw Error('Vault is locked');
    if (prepared.kind === 'chain') {
      const net = getNetwork(prepared.networkId);
      const secret = vault.exportSecret(prepared.accountId);
      try {
        const { hash } = await chainClient(net).executeSend(prepared.plan, secret);
        recordSentTo(prepared.to);
        return { hash };
      } finally {
        secret.fill(0); // exportSecret returns a copy; scrub after use
      }
    }
    const signed = signWithVault(vault, prepared.accountId, {
      nonce: prepared.nonce,
      gasPrice: prepared.gasPrice,
      gasLimit: prepared.gasLimit,
      to: prepared.txTo,
      value: prepared.txValue ?? prepared.value,
      data: prepared.data,
      chainId: prepared.chainId,
    });
    const net = getNetwork(prepared.networkId);
    const hash = await evmRpc(net).sendRawTransaction(signed.rawTx);
    recordSentTo(prepared.to);
    return { hash, signed };
  }

  /**
   * Poll a receipt/status until final or attempts run out.
   * onUpdate({ state, receipt }) fires for 'pending' ticks and the final
   * state ('success' | 'failed'). Resolves with { state, receipt }.
   * Chain families report status only (receipt is null).
   */
  async function pollReceipt(hash, { onUpdate, intervalMs = 2000, maxAttempts = 30 } = {}) {
    const net = network;
    if (net.kind !== 'evm') {
      const client = chainClient(net);
      for (let i = 0; i < maxAttempts; i++) {
        let state = 'pending';
        try {
          state = await client.getTxStatus(hash);
        } catch {
          state = 'pending'; // transient API failure: keep polling
        }
        if (state === 'success' || state === 'failed') {
          onUpdate?.({ state, receipt: null });
          return { state, receipt: null };
        }
        onUpdate?.({ state: 'pending', receipt: null });
        if (i < maxAttempts - 1) await sleep(intervalMs);
      }
      return { state: 'pending', receipt: null };
    }
    const client = evmRpc(net);
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

  // ------------------------------------------------------------ AMM swap

  /** The AMM manifest (gateway /api/points/rules → amm block), cached. */
  async function getSwapManifest() {
    if (swapManifestCache) return swapManifestCache;
    const fetcher =
      manifestFetcher ??
      (async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw Error(`AMM manifest unavailable (HTTP ${res.status})`);
        return res.json();
      });
    const json = await fetcher(swapManifestUrl);
    const manifest = json?.amm ?? json;
    if (!manifest || !Array.isArray(manifest.pools)) {
      throw Error('AMM manifest unavailable');
    }
    swapManifestCache = manifest;
    return manifest;
  }

  /**
   * Quote a ZERONYTH AMM swap against fresh reserves (src/core/swap.mjs).
   * ZERONYTH network only — the AMM lives on 912701.
   */
  async function quoteSwap({ poolId, direction, amountIn, slippageBps = DEFAULT_SLIPPAGE_BPS }) {
    if (network.chainId !== 912701) throw Error('Swap is only available on ZERONYTH');
    const manifest = await getSwapManifest();
    return ammQuote(zeronythRpc(), manifest, { poolId, direction, amountIn, slippageBps });
  }

  /**
   * Build the swap review model: the quote plus the display steps
   * (approve when needed + the swap call), each prepared through the
   * normal ZERONYTH send path so fees follow the gas.mjs policy.
   * Execution re-prepares each step (fresh nonce/allowance) — see
   * executeSwap.
   */
  async function prepareSwap({ accountId, poolId, direction, amountIn, slippageBps = DEFAULT_SLIPPAGE_BPS }) {
    if (network.chainId !== 912701) throw Error('Swap is only available on ZERONYTH');
    const account = getAccount(accountId);
    if (!account) throw Error(`No such account: ${accountId}`);
    assertSchemeOperable(account, network);
    const manifest = await getSwapManifest();
    const quote = await ammQuote(zeronythRpc(), manifest, {
      poolId,
      direction,
      amountIn,
      slippageBps,
    });
    const steps = [];
    if (direction === 'sell') {
      const allowance = await ammAllowanceOf(
        zeronythRpc(),
        manifest,
        quote.pool.b,
        account.address,
        quote.pool.router,
      );
      if (allowance < quote.amountIn) {
        const call = ammApproveCall(manifest, quote);
        const prepared = await prepareSend(accountId, {
          to: call.to,
          value: 0n,
          data: call.data,
        });
        steps.push({ label: 'approve', prepared });
      }
    }
    const deadline = Math.floor(now() / 1000) + 600;
    const call = ammSwapCall(quote, deadline);
    // The swap call pulls the sold token via transferFrom: while the
    // approve step above is still unexecuted, eth_estimateGas reverts
    // on the missing allowance. This preparation only feeds the review
    // display (execution re-prepares after the approve is mined), so a
    // conservative fallback estimate is used in that case.
    const swapPrepared = await prepareSend(accountId, {
      to: call.to,
      value: call.value,
      data: call.data,
      estimateFallback: 400000n,
    });
    steps.push({ label: 'swap', prepared: swapPrepared });
    return {
      kind: 'swap',
      networkId: network.id,
      networkName: network.name,
      accountId,
      scheme: account.scheme,
      from: account.address,
      quote,
      steps,
    };
  }

  /**
   * Execute a prepared swap: steps are re-prepared at execution time
   * (fresh nonce, fresh allowance check, fresh reserves → fresh quote
   * with the same slippage) and each is awaited to a successful receipt
   * before the next begins. Returns { hashes, quote } (the EXECUTED
   * quote, which may differ slightly from the reviewed one).
   */
  async function executeSwap(preparedSwap) {
    if (!vault) throw Error('Vault is locked');
    if (network.chainId !== 912701) throw Error('Swap is only available on ZERONYTH');
    const { accountId, quote: reviewed } = preparedSwap;
    const manifest = await getSwapManifest();
    const account = getAccount(accountId);
    const quote = await ammQuote(zeronythRpc(), manifest, {
      poolId: reviewed.pool.id,
      direction: reviewed.direction,
      amountIn: reviewed.amountIn,
      slippageBps: reviewed.slippageBps,
    });
    const hashes = [];
    const runStep = async (call, stepValue, stepData) => {
      const prepared = await prepareSend(accountId, {
        to: call.to,
        value: stepValue,
        data: stepData,
      });
      const { hash } = await executeSend(prepared);
      hashes.push(hash);
      const done = await pollReceipt(hash, {});
      if (done.state !== 'success') throw Error(`Swap step failed on-chain: ${hash}`);
      return hash;
    };
    if (quote.direction === 'sell') {
      const allowance = await ammAllowanceOf(
        zeronythRpc(),
        manifest,
        quote.pool.b,
        account.address,
        quote.pool.router,
      );
      if (allowance < quote.amountIn) {
        const call = ammApproveCall(manifest, quote);
        await runStep(call, 0n, call.data);
      }
    }
    const deadline = Math.floor(now() / 1000) + 600;
    const call = ammSwapCall(quote, deadline);
    await runStep(call, call.value, call.data);
    recordSentTo(quote.pool.router);
    return { hashes, quote };
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
    isCustomRpc,
    getNetwork: currentNetwork,
    setNetwork,
    networks: NETWORKS,
    familyAddress,
    checkConnection,
    refreshBalances,
    faucet,
    isFirstSendTo,
    recordSentTo,
    prepareSend,
    executeSend,
    pollReceipt,
    getSwapManifest,
    quoteSwap,
    prepareSwap,
    executeSwap,
  };
}
