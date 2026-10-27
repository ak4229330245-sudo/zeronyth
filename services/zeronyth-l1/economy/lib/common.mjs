// Shared helpers for the ZNYT economy scripts. Private keys are loaded from files (0600) and never printed.
import { JsonRpcProvider, Wallet, ContractFactory, Contract, parseEther, formatEther } from 'ethers';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const econRoot = path.resolve(here, '..');
export const l1Root = path.resolve(econRoot, '..');
export const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
export const NETWORK = process.env.ECON_NETWORK || 'box';
export const GAS_PRICE = BigInt(process.env.ECON_GAS_PRICE_WEI || process.env.ZERONYTH_MIN_GAS_PRICE || '0');
export const provider = new JsonRpcProvider(RPC_URL, 9127, { staticNetwork: true, batchMaxCount: 50, polling: true, pollingInterval: 250 });
export { parseEther, formatEther, Contract };

export function artifact(name) { return JSON.parse(readFileSync(path.join(econRoot, 'build', `${name}.json`), 'utf8')); }
export function deployment() {
  const f = path.join(econRoot, 'deployments', `${NETWORK}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
}
export function saveDeployment(d) { writeFileSync(path.join(econRoot, 'deployments', `${NETWORK}.json`), JSON.stringify(d, null, 2) + '\n'); }

/** Test-only keys for named roles, generated locally (0600, gitignored, never printed). */
export function roleWallet(role) {
  const dir = path.join(econRoot, '.secrets'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = path.join(dir, `${NETWORK}-keys.json`);
  const keys = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
  if (!keys[role]) { keys[role] = '0x' + randomBytes(32).toString('hex'); writeFileSync(f, JSON.stringify(keys), { mode: 0o600 }); }
  chmodSync(f, 0o600);
  return new Wallet(keys[role], provider);
}

/** Box-only funder: the well-known local dev faucet key from services/zeronyth-l1/.env (valueless testnet). */
export function funderWallet() {
  const env = readFileSync(path.join(l1Root, '.env'), 'utf8');
  const m = env.match(/^FAUCET_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m);
  if (!m) throw new Error('FAUCET_PRIVATE_KEY missing in .env');
  return new Wallet(m[1], provider);
}

/** Role wallet wrapped in the per-signer nonce queue (safe for concurrent callers and other processes). */
export async function queuedRole(role) { const { QueuedSigner } = await import('./signer-queue.mjs'); return new QueuedSigner(roleWallet(role), { chainId: 9127 }); }

export const txo = () => (GAS_PRICE > 0n ? { gasPrice: GAS_PRICE } : { gasPrice: 0n });
export async function send(promise) { const tx = await promise; const r = await tx.wait(); if (r.status !== 1) throw new Error('tx failed'); return r; }

export async function rpc(method, params = [], url = RPC_URL) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await res.json(); if (j.error) throw new Error(`${method}: ${j.error.message}`); return j.result;
}

/** Sum of every account balance via debug_accountRange (needs DEBUG API; box admin port 8646). */
export async function totalSupply(block = 'latest', url = process.env.DEBUG_RPC_URL || 'http://127.0.0.1:8646') {
  const tag = block === 'latest' ? await rpc('eth_blockNumber', [], url) : block;
  let start = '0x' + '00'.repeat(32); let sum = 0n; let accounts = 0;
  for (let page = 0; page < 1000; page++) {
    const r = await rpc('debug_accountRange', [tag, 0, start, 256], url);
    const entries = Object.values(r.addressMap || r.accounts || {});
    for (const a of Object.keys(r.addressMap || {})) { void a; }
    if (r.addressMap) {
      for (const addr of Object.values(r.addressMap)) { const b = await rpc('eth_getBalance', [addr, tag], url); sum += BigInt(b); accounts++; }
    } else { for (const e of entries) { sum += BigInt(e.balance); accounts++; } }
    if (!r.nextKey || /^0x0*$/.test(r.nextKey)) break;
    start = r.nextKey;
  }
  return { block: Number(tag), supplyWei: sum, accounts };
}
