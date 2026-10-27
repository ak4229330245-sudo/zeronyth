// Exact native-ZNYT total supply at a block, independent of any contract bookkeeping:
//  1. collect every address ever touched (genesis alloc, coinbases, trace stateDiff of every tx),
//  2. enumerate the state trie with debug_accountRange (account-hash keys) and require that every
//     trie entry maps to a known address (completeness proof: no hidden balances),
//  3. sum eth_getBalance over all of them at that block.
import { keccak256, getAddress } from 'ethers';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { rpc, econRoot, l1Root, NETWORK } from './common.mjs';

const URL = process.env.DEBUG_RPC_URL || 'http://127.0.0.1:8646';
const cacheFile = path.join(econRoot, 'state', `addresses-${NETWORK}.json`);

async function batch(calls) {
  const res = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(calls.map(([method, params], id) => ({ jsonrpc: '2.0', id, method, params }))) });
  const out = await res.json(); out.sort((a, b) => a.id - b.id);
  return out.map((r) => { if (r.error) throw new Error(r.error.message); return r.result; });
}

export async function knownAddresses(upTo) {
  mkdirSync(path.dirname(cacheFile), { recursive: true });
  const c = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : { scanned: -1, addrs: [] };
  const set = new Set(c.addrs);
  if (c.scanned < 0) {
    const g = JSON.parse(readFileSync(path.join(l1Root, 'config/genesis.json'), 'utf8'));
    for (const a of Object.keys(g.alloc)) set.add(getAddress('0x' + a.replace(/^0x/, '')));
  }
  for (let from = c.scanned + 1; from <= upTo; from += 50) {
    const nums = []; for (let b = from; b <= Math.min(upTo, from + 49); b++) nums.push(b);
    const blocks = await batch(nums.map((b) => ['eth_getBlockByNumber', ['0x' + b.toString(16), false]]));
    for (const blk of blocks) set.add(getAddress(blk.miner));
    const withTx = blocks.filter((blk) => blk.transactions.length);
    if (withTx.length) {
      const traces = await batch(withTx.map((blk) => ['trace_replayBlockTransactions', [blk.number, ['stateDiff']]]));
      for (const t of traces) for (const tx of t) for (const a of Object.keys(tx.stateDiff || {})) set.add(getAddress(a));
    }
  }
  const addrs = [...set];
  writeFileSync(cacheFile, JSON.stringify({ scanned: upTo, addrs }));
  return addrs;
}

export async function totalSupply(blockNumber) {
  const n = blockNumber ?? Number(await rpc('eth_blockNumber', [], URL));
  const tag = '0x' + n.toString(16);
  const addrs = await knownAddresses(n);
  const byHash = new Map(addrs.map((a) => [keccak256(a).toLowerCase(), a]));
  let start = '0x' + '00'.repeat(32); const trie = [];
  for (;;) {
    const r = await rpc('debug_accountRange', [tag, 0, start, 1024], URL);
    trie.push(...Object.keys(r.addressMap));
    if (!r.nextKey || /^0x0*$/.test(r.nextKey)) break;
    start = r.nextKey;
  }
  const unknown = trie.filter((h) => !byHash.has(h.toLowerCase()));
  const inTrie = trie.map((h) => byHash.get(h.toLowerCase())).filter(Boolean);
  let supply = 0n;
  for (let i = 0; i < inTrie.length; i += 100) {
    const bals = await batch(inTrie.slice(i, i + 100).map((a) => ['eth_getBalance', [a, tag]]));
    for (const b of bals) supply += BigInt(b);
  }
  return { block: n, supplyWei: supply, trieAccounts: trie.length, unknownTrieAccounts: unknown.length, complete: unknown.length === 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await totalSupply(process.argv[2] ? Number(process.argv[2]) : undefined);
  console.log(JSON.stringify({ ...r, supplyWei: r.supplyWei.toString() }));
}
