import { setText, setPlain } from './i18n.mjs';
import { localizeWalletError } from './i18n-errors.mjs';
import { WalletController, discoverWallets, walletRpcUrl, walletError, formatZnyt, CHAIN_ID } from './wallet-core.mjs';
import { readWalletPreference, saveWalletPreference, forgetWalletPreference, savedWalletCandidate } from './wallet-preference.mjs';

const $ = id => document.getElementById(id);
const panel = $('walletPanel');
const select = $('walletSelect');
const message = $('walletMessage');
const connection = $('walletConnect');
const network = $('walletNetwork');
const disconnect = $('walletDisconnect');
const account = $('walletAddress');
const balance = $('walletBalance');
const networkName = $('walletChain');
const help = $('walletHelp');
const remember = $('walletRemember');
const restore = $('walletRestore');
const storage = () => window.localStorage;
remember.checked = Boolean(readWalletPreference(storage));
function updateRestore() {
  restore.disabled = wallet.state.busy || Boolean(wallet.state.account) ||
    !savedWalletCandidate(wallets, readWalletPreference(storage));
}
let wallets = [];
let balanceVersion = 0;
let previous = { provider: null, account: null, chainId: null };
function showWalletError(error) {
  const d = localizeWalletError(walletError(error));
  if (typeof d === 'string') setPlain(message, d); else setText(message, d.key, d.params);
}
let rpcUrl = '';
try { rpcUrl = walletRpcUrl(location, window.ZERONYTH_CONFIG?.rpcUrl); }
catch (error) { showWalletError(error); }
if (rpcUrl) setPlain($('rpcEndpoint'), rpcUrl); else setText($('rpcEndpoint'), 'wallet.rpc.unset');
$('walletOpenTab').href = new URL(location.pathname, location.origin).href;
$('walletMobile').href = `https://link.metamask.io/dapp/${location.host}${location.pathname}`;

async function readRpc(url, method, params = []) {
  const response = await fetch(url, {
    method: 'POST', credentials: 'omit', redirect: 'error',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw Error(`RPC HTTP ${response.status}`);
  const json = await response.json();
  if (json.error || json.result === undefined) throw Error(json.error?.message || 'RPC response invalid');
  return json.result;
}

export const wallet = new WalletController(state => {
  const changed = previous.provider !== wallet.provider || previous.account !== state.account || previous.chainId !== state.chainId;
  if (changed) {
    const faucet = $('faucetAddress');
    if (previous.account && faucet.value.toLowerCase() === previous.account.toLowerCase()) faucet.value = '';
    if (state.account && state.chainId === CHAIN_ID) faucet.value = state.account;
    previous = { provider: wallet.provider, account: state.account, chainId: state.chainId };
    window.dispatchEvent(new CustomEvent('zeronyth:walletchange'));
  }
  account.value = state.account || '';
  if (!state.chainId) setText(networkName, 'wallet.network.none');
  else if (state.chainId === CHAIN_ID) setText(networkName, 'wallet.network.ok');
  else setText(networkName, 'wallet.network.other', { id: BigInt(state.chainId).toString() });
  if (state.account) setPlain($('walletBtn'), `${state.account.slice(0, 6)}…${state.account.slice(-4)}`);
  else setText($('walletBtn'), 'wallet.nav');
  connection.disabled = state.busy || !wallets.length;
  setText(connection, state.busy ? 'wallet.connecting' : 'wallet.connect');
  select.disabled = state.busy || !wallets.length;
  network.disabled = state.busy || !state.account || state.chainId === CHAIN_ID;
  disconnect.disabled = !wallet.provider;
  $('walletCopy').disabled = !state.account;
  updateRestore();
  if (state.error) {
    const d = localizeWalletError(state.error);
    if (typeof d === 'string') setPlain(message, d); else setText(message, d.key, d.params);
  } else setText(message, state.busy ? 'wallet.msg.busy'
    : state.account ? state.chainId === CHAIN_ID ? 'wallet.msg.connected' : 'wallet.msg.needSwitch' : 'wallet.msg.initial');
  void refreshBalance();
});

async function refreshBalance() {
  const token = ++balanceVersion;
  const { account: address, chainId } = wallet.state;
  setPlain(balance, '—');
  if (!address || chainId !== CHAIN_ID || !rpcUrl) return;
  try {
    // A configured or proxied endpoint must also prove the expected chain.
    if (await readRpc(rpcUrl, 'eth_chainId') !== CHAIN_ID) throw Error('Unexpected RPC chain');
    const result = await readRpc(rpcUrl, 'eth_getBalance', [address, 'latest']);
    if (token === balanceVersion) setPlain(balance, formatZnyt(result));
  } catch {
    if (token === balanceVersion) setText(balance, 'wallet.balance.fail');
  }
}

const discovery = discoverWallets(window, entries => {
  wallets = entries;
  const selected = select.value;
  select.replaceChildren();
  for (const entry of entries) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.name;
    select.appendChild(option);
  }
  if (entries.some(e => e.id === selected)) select.value = selected;
  connection.disabled = wallet.state.busy || !entries.length;
  help.hidden = entries.length > 0;
  updateRestore();
});

export async function connectSelectedWallet() {
  discovery.rescan();
  const selected = wallets.find(entry => entry.id === select.value);
  if (!selected) {
    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setText(message, 'wallet.msg.notFound');
    return null;
  }
  try {
    const result = await wallet.connect(selected.provider);
    if (wallet.provider === selected.provider && result.account && remember.checked) {
      if (!saveWalletPreference(storage, selected)) setText(message, 'wallet.restore.storage');
    }
    updateRestore();
    return result;
  }
  catch { return null; } // Controller owns errors; stale permission requests must not overwrite newer state.
}

$('walletBtn').addEventListener('click', () => {
  panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  discovery.rescan();
  if (!wallet.state.account) void connectSelectedWallet();
});
connection.addEventListener('click', () => { void connectSelectedWallet(); });
select.addEventListener('change', () => { forgetWalletPreference(storage); wallet.disconnect(); });
disconnect.addEventListener('click', () => {
  forgetWalletPreference(storage);
  remember.checked = false;
  wallet.disconnect();
});
remember.addEventListener('change', () => {
  if (!remember.checked) forgetWalletPreference(storage);
  else if (wallet.state.account) {
    const selected = wallets.find(entry => entry.provider === wallet.provider);
    if (!saveWalletPreference(storage, selected)) setText(message, 'wallet.restore.storage');
  }
  updateRestore();
});
restore.addEventListener('click', async () => {
  const selected = savedWalletCandidate(wallets, readWalletPreference(storage));
  if (!selected || wallet.state.busy) return;
  select.value = selected.id;
  try {
    const result = await wallet.restore(selected.provider);
    if (!result.account) setText(message, 'wallet.restore.unavailable');
  } catch {
    forgetWalletPreference(storage);
    setText(message, 'wallet.restore.unavailable');
  }
  updateRestore();
});
network.addEventListener('click', async () => {
  try {
    await wallet.switchChain(rpcUrl, url => readRpc(url, 'eth_chainId'));
  } catch (error) {
    setText(message, 'wallet.msg.switchFail', { error: localizeWalletError(walletError(error)) });
  }
});
$('walletCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(account.value); setText(message, 'wallet.msg.copied'); }
  catch { account.select(); setText(message, 'wallet.msg.selected'); }
});
window.addEventListener('focus', () => { discovery.rescan(); void wallet.refresh(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { discovery.rescan(); void wallet.refresh(); }
});
setInterval(() => { if (!document.hidden) { void wallet.refresh(); } }, 15000);
connection.disabled = !wallets.length;
select.disabled = !wallets.length;
help.hidden = wallets.length > 0;
setText($('walletBtn'), 'wallet.nav');
setText(connection, 'wallet.connect');
if (rpcUrl) setText(message, 'wallet.msg.initial');
// Register the default state before the first wallet/provider callback occurs.
setText(networkName, 'wallet.network.none');
