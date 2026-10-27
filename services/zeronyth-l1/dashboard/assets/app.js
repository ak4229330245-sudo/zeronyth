'use strict';
import './wallet-ui.mjs';
import { setText, setPlain, clearText } from './i18n.mjs';
import { KeyedError } from './i18n-errors.mjs';

const RPC = '/rpc';
const CHAIN_ID_HEX = '0x23a7';
const CHAIN_ID_DEC = 9127;
const $ = (id) => document.getElementById(id);
const ui = {
  walletBtn: $('walletBtn'), refreshBtn: $('refreshBtn'), claimBtn: $('claimBtn'),
  faucetAddress: $('faucetAddress'), faucetMsg: $('faucetMsg'), faucetBalance: $('faucetBalance'),
  faucetAmount: $('faucetAmount'), rpcEndpoint: $('rpcEndpoint'), status: $('status'), block: $('block'),
  peers: $('peers'), pqFinal: $('pqFinal'), validators: $('validators'), chain: $('chain'), blocks: $('blocks'),
};


function shortHex(value) {
  return value && value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : (value || '—');
}

async function fetchJson(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function rpc(method, params = []) {
  const payload = await fetchJson(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
  });
  if (payload.error) throw new Error(payload.error.message || 'RPC error');
  return payload.result;
}

function setOffline(key, params) {
  setText(ui.status, 'status.offline');
  ui.status.className = 'v bad';
  clearText(ui.blocks);
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 4;
  cell.className = 'bad';
  if (key) setText(cell, key, params); else setPlain(cell, params);
  row.appendChild(cell);
  ui.blocks.appendChild(row);
}

function renderBlocks(items) {
  ui.blocks.replaceChildren();
  for (const { number, hash, txCount, gasUsed } of items) {
    const row = document.createElement('tr');
    for (const value of [`#${number}`, shortHex(hash), String(txCount), gasUsed.toLocaleString()]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    }
    ui.blocks.appendChild(row);
  }
}

async function refreshFaucet() {
  try {
    const health = await fetchJson('/api/faucet/health');
    setPlain(ui.faucetBalance, `${health.balanceZNYT} ZNYT`);
    setPlain(ui.faucetAmount, `${health.dripZNYT} ZNYT`);
  } catch {
    setText(ui.faucetBalance, 'faucet.unavailable');
    setPlain(ui.faucetAmount, '—');
  }
}

// Batched JSON-RPC: one HTTP round trip per poll instead of 12 separate requests.
async function rpcBatch(calls) {
  const body = calls.map(([method, params = []], id) => ({ jsonrpc: '2.0', method, params, id }));
  const payload = await fetchJson(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!Array.isArray(payload)) throw new Error(payload?.error?.message || 'RPC error');
  const byId = new Map(payload.map((item) => [item.id, item]));
  return calls.map((_, id) => {
    const item = byId.get(id);
    if (!item || item.error) throw new Error(item?.error?.message || 'RPC error');
    return item.result;
  });
}

const POLL_MS = 1000;
const FAUCET_MS = 10_000;
const blockCache = new Map();
let refreshing = false;
let lastFaucet = 0;
let lastTop = -1;

function toInfo(block) {
  return block ? {
    number: Number.parseInt(block.number, 16), hash: block.hash,
    txCount: block.transactions.length, gasUsed: Number.parseInt(block.gasUsed, 16),
  } : null;
}

async function refresh(force = false) {
  if (refreshing) return;
  refreshing = true;
  if (force === true) ui.refreshBtn.disabled = true;
  try {
    if (force === true || Date.now() - lastFaucet >= FAUCET_MS) {
      lastFaucet = Date.now();
      void refreshFaucet();
    }
    const [chainId, blockNumber, peerCount, validators, latest] = await rpcBatch([
      ['eth_chainId'], ['eth_blockNumber'], ['net_peerCount'],
      ['qbft_getValidatorsByBlockNumber', ['latest']], ['eth_getBlockByNumber', ['latest', false]],
    ]);
    const chain = Number.parseInt(chainId, 16);
    if (chain !== CHAIN_ID_DEC) throw new KeyedError('status.unexpectedChain', { chain });

    setText(ui.status, 'status.online');
    ui.status.className = 'v ok';
    ui.chain.textContent = String(chain);
    ui.peers.textContent = String(Number.parseInt(peerCount, 16));
    ui.validators.textContent = String(validators.length);

    const latestInfo = toInfo(latest);
    if (latestInfo) blockCache.set(latestInfo.number, latestInfo);
    const top = latestInfo ? latestInfo.number : Number.parseInt(blockNumber, 16);
    ui.block.textContent = String(top);
    const numbers = [];
    for (let n = top; n >= Math.max(0, top - 7); n -= 1) numbers.push(n);
    const missing = numbers.filter((n) => !blockCache.has(n));
    if (missing.length) {
      const fetched = await rpcBatch(missing.map((n) => ['eth_getBlockByNumber', [`0x${n.toString(16)}`, false]]));
      for (const block of fetched) { const info = toInfo(block); if (info) blockCache.set(info.number, info); }
    }
    for (const n of blockCache.keys()) if (n < top - 7 || n > top) blockCache.delete(n);
    if (top !== lastTop || force === true) {
      lastTop = top;
      renderBlocks(numbers.map((n) => blockCache.get(n)).filter(Boolean));
    }
  } catch (error) {
    lastTop = -1;
    blockCache.clear();
    if (error?.name === 'AbortError') setOffline('status.timeout');
    else if (error instanceof KeyedError) setOffline(error.key, error.params);
    else setOffline(null, String(error?.message || error));
  } finally {
    refreshing = false;
    ui.refreshBtn.disabled = false;
  }
}

async function claim() {
  const address = ui.faucetAddress.value.trim();
  ui.claimBtn.disabled = true;
  setText(ui.faucetMsg, 'faucet.sending');
  try {
    const result = await fetchJson('/api/faucet/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address }),
    }, 10_000);
    setText(ui.faucetMsg, 'faucet.sent', { amount: result.amountZNYT, hash: shortHex(result.txHash) });
    await refreshFaucet();
  } catch (error) {
    if (error?.name === 'AbortError') setText(ui.faucetMsg, 'faucet.timeout');
    else setPlain(ui.faucetMsg, String(error?.message || error));
  } finally {
    ui.claimBtn.disabled = false;
  }
}

let pqBusy = false;
async function refreshPq() {
  if (pqBusy || !ui.pqFinal) return;
  pqBusy = true;
  try {
    const cert = await fetchJson('/api/pq/finality/latest?summary=1');
    ui.pqFinal.textContent = `${cert.height} · ${Number(cert.signers)} sig (≥${Number(cert.quorum)})`;
    ui.pqFinal.className = 'v ok';
  } catch {
    ui.pqFinal.textContent = '—';
    ui.pqFinal.className = 'v';
  } finally { pqBusy = false; }
}
setInterval(() => { if (!document.hidden) void refreshPq(); }, 2000);
void refreshPq();
ui.refreshBtn.addEventListener('click', () => refresh(true));
ui.claimBtn.addEventListener('click', claim);
ui.faucetAddress.addEventListener('keydown', (event) => { if (event.key === 'Enter') claim(); });

setText(ui.status, 'status.checking');
refresh(true);
setInterval(() => { if (!document.hidden) void refresh(); }, POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(true); });
