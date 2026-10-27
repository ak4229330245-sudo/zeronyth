// ZERONYTH Scan — standalone, read-only block explorer for the ZERONYTH testnet (chain 9127).
// One low-priority process: SQLite indexer (backfill from genesis + follow head) + GET-only JSON API + static site.
// Never proxies JSON-RPC to clients; the only RPC it talks to is the loopback primary node.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getAddress, formatEther } from 'ethers';
import { openDb } from './lib/db.mjs';
import { makeRpc } from './lib/rpc.mjs';
import { makeIndexer } from './lib/indexer.mjs';
import { loadKnown, buildIndexes, erc20 } from './lib/known.mjs';
import { createVisitorCounter } from '../scripts/visitor-counter.mjs';

try { os.setPriority(19); } catch { /* best effort */ }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.ZERONYTH_ROOT || path.join(HERE, '..'));
const PORT = Number(process.env.EXPLORER_PORT || 9815);
const HOST = process.env.EXPLORER_HOST || '127.0.0.1';
const RPC_URL = process.env.EXPLORER_RPC || 'http://127.0.0.1:9545';
const DATA = process.env.EXPLORER_DATA || '/workspace/zeronyth-explorer';
const BRIDGE_API = process.env.EXPLORER_BRIDGE_API || 'http://127.0.0.1:9811/api/bridge/transfers';
const PUBLIC_ORIGIN = (process.env.EXPLORER_PUBLIC_ORIGIN || 'https://scan.zeronyth.dpdns.org').replace(/\/$/, '');
const MAIN_HOSTS = new Set((process.env.EXPLORER_REDIRECT_HOSTS || 'zeronyth.dpdns.org').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const CHAIN_ID = 9127;
const ZERO = '0x0000000000000000000000000000000000000000';
mkdirSync(DATA, { recursive: true });

const db = openDb(path.join(DATA, 'scan.sqlite'));
const rpc = makeRpc(RPC_URL);
let known = loadKnown(ROOT); let idx = buildIndexes(known.abis);
setInterval(() => { try { known = loadKnown(ROOT); idx = buildIndexes(known.abis); } catch { /* keep previous */ } }, 120000).unref();
const indexer = makeIndexer({ db, rpc, known: () => known, erc20, log: console });

// ---------- helpers ----------
const isAddr = (s) => /^0x[0-9a-fA-F]{40}$/.test(s);
const isHash = (s) => /^0x[0-9a-fA-F]{64}$/.test(s);
const ck = (a) => { try { return a ? getAddress(a) : a; } catch { return a; } };
const cacheFns = new Map();
async function cached(key, ms, fn) {
  const c = cacheFns.get(key); const now = Date.now();
  if (c && now - c.t < ms) return c.v;
  const v = await fn(); cacheFns.set(key, { t: now, v });
  if (cacheFns.size > 5000) for (const [k, e] of cacheFns) if (now - e.t > 60000) cacheFns.delete(k);
  return v;
}
const jsonable = (v) => (typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? v.map(jsonable) : v && typeof v === 'object' && v.constructor?.name === 'Result' ? [...v].map(jsonable) : v);
function decodeArgs(frag, values) {
  return frag.inputs.map((p, i) => ({ name: p.name || `arg${i}`, type: p.type, value: jsonable(values[i]) }));
}
function decodeInput(to, input) {
  if (!input || input === '0x' || input.length < 10) return null;
  const lab = to && known.labels.get(to);
  const cands = [];
  if (lab?.abi && known.abis.get(lab.abi)) cands.push({ contract: lab.abi, iface: known.abis.get(lab.abi) });
  const bySel = idx.fn.get(input.slice(0, 10).toLowerCase()); if (bySel) cands.push(bySel);
  for (const c of cands) {
    try { const p = c.iface.parseTransaction({ data: input }); if (p) return { contract: c.contract, method: p.name, signature: p.signature, args: decodeArgs(p.fragment, p.args) }; } catch { /* next */ }
  }
  return { selector: input.slice(0, 10) };
}
function decodeLog(l) {
  const topics = [l.t0, l.t1, l.t2, l.t3].filter((t) => t != null);
  const lab = known.labels.get(l.address);
  const cands = [];
  if (lab?.abi && known.abis.get(lab.abi)) cands.push({ contract: lab.abi, iface: known.abis.get(lab.abi) });
  const byT = topics[0] && idx.ev.get(topics[0]); if (byT) cands.push(byT);
  for (const c of cands) {
    try { const p = c.iface.parseLog({ topics, data: l.data }); if (p) return { contract: c.contract, event: p.name, signature: p.signature, args: decodeArgs(p.fragment, p.args) }; } catch { /* next */ }
  }
  return null;
}
const tokenRow = db.prepare('SELECT address, name, symbol, decimals FROM tokens WHERE address=?');
function labelsFor(addrs) {
  const out = {};
  for (const a0 of addrs) {
    const a = a0?.toLowerCase(); if (!a || out[a] || !isAddr(a)) continue;
    const l = known.labels.get(a); const t = tokenRow.get(a);
    if (l) out[a] = { name: l.name, kind: l.kind }; else if (t?.symbol) out[a] = { name: `${t.symbol}${t.name ? ` (${t.name})` : ''}`, kind: 'token' };
    else if (known.validators.includes(a) || validatorSet.has(a)) out[a] = { name: `QBFT validator`, kind: 'validator' };
  }
  return out;
}
let validatorSet = new Set();
async function validators() {
  return cached('validators', 30000, async () => {
    let list = [];
    try { list = (await rpc('qbft_getValidatorsByBlockNumber', ['latest'])).map((a) => a.toLowerCase()); } catch { list = known.validators.filter(Boolean); }
    validatorSet = new Set(list);
    return list;
  });
}
const pageOf = (u, max = 400) => Math.min(max, Math.max(1, Number.parseInt(u.searchParams.get('page') || '1', 10) || 1));
const sizeOf = (u) => Math.min(100, Math.max(5, Number.parseInt(u.searchParams.get('size') || '25', 10) || 25));
const txOut = (t) => t && ({ hash: t.hash, block: t.block, index: t.idx, timestamp: t.ts, from: ck(t.from_a), to: ck(t.to_a), value: t.value, gas: t.gas,
  gasPrice: t.gas_price, gasUsed: t.gas_used, fee: t.gas_used != null ? (BigInt(t.gas_used) * BigInt(t.gas_price || 0)).toString() : null,
  status: t.status, nonce: t.nonce, type: t.type, created: ck(t.created), method: t.input && t.input.length >= 10 ? methodName(t.to_a, t.input) : null, logs: t.nlogs });
function methodName(to, input) { const d = decodeInput(to, input); return d?.method || d?.selector || null; }

// ---------- prepared queries ----------
const Q = {
  head: db.prepare('SELECT MAX(n) n FROM blocks'),
  blocks: db.prepare('SELECT * FROM blocks ORDER BY n DESC LIMIT ? OFFSET ?'),
  blockN: db.prepare('SELECT * FROM blocks WHERE n=?'), blockH: db.prepare('SELECT * FROM blocks WHERE hash=?'),
  blockTxs: db.prepare('SELECT * FROM txs WHERE block=? ORDER BY idx'),
  txs: db.prepare('SELECT * FROM txs ORDER BY block DESC, idx DESC LIMIT ? OFFSET ?'),
  txCount: db.prepare('SELECT COUNT(*) c FROM txs'), txSince: db.prepare('SELECT COUNT(*) c FROM txs WHERE block>=?'),
  tx: db.prepare('SELECT * FROM txs WHERE hash=?'),
  txLogs: db.prepare('SELECT * FROM logs WHERE tx=? ORDER BY block, li'),
  txTransfers: db.prepare('SELECT * FROM transfers WHERE tx=? ORDER BY block, li'),
  span: db.prepare('SELECT MIN(ts) a, MAX(ts) b, COUNT(*) c, SUM(tx_count) t FROM blocks WHERE n>?'),
  addrTxs: db.prepare('SELECT t.* FROM addr_txs a JOIN txs t ON t.hash=a.hash WHERE a.addr=? ORDER BY a.block DESC, a.idx DESC LIMIT ? OFFSET ?'),
  addrTxCount: db.prepare('SELECT COUNT(*) c FROM addr_txs WHERE addr=?'),
  addrTr: db.prepare(`SELECT * FROM (SELECT * FROM transfers WHERE from_a=? UNION ALL SELECT * FROM transfers WHERE to_a=? AND from_a<>to_a) ORDER BY block DESC, li DESC LIMIT ? OFFSET ?`),
  addrTrCount: db.prepare('SELECT (SELECT COUNT(*) FROM transfers WHERE from_a=?) + (SELECT COUNT(*) FROM transfers WHERE to_a=? AND from_a<>to_a) c'),
  addrBal: db.prepare('SELECT b.token, b.value, t.name, t.symbol, t.decimals FROM balances b LEFT JOIN tokens t ON t.address=b.token WHERE b.holder=? ORDER BY t.symbol'),
  contract: db.prepare('SELECT * FROM contracts WHERE address=?'),
  mined: db.prepare('SELECT COUNT(*) c FROM blocks WHERE miner=?'),
  minedList: db.prepare('SELECT n, hash, ts, tx_count, gas_used FROM blocks WHERE miner=? ORDER BY n DESC LIMIT ? OFFSET ?'),
  tokens: db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM balances b WHERE b.token=t.address AND b.approx>0) holders,
    (SELECT COUNT(*) FROM transfers r WHERE r.token=t.address) transfers FROM tokens t ORDER BY holders DESC, t.symbol`),
  token: db.prepare('SELECT * FROM tokens WHERE address=?'),
  holders: db.prepare('SELECT holder, value FROM balances WHERE token=? AND approx>0 ORDER BY approx DESC LIMIT ? OFFSET ?'),
  holderCount: db.prepare('SELECT COUNT(*) c FROM balances WHERE token=? AND approx>0'),
  tokTr: db.prepare('SELECT * FROM transfers WHERE token=? ORDER BY block DESC, li DESC LIMIT ? OFFSET ?'),
  tokTrCount: db.prepare('SELECT COUNT(*) c FROM transfers WHERE token=?'),
  tokSearch: db.prepare("SELECT address, name, symbol, decimals FROM tokens WHERE lower(symbol) LIKE ? OR lower(name) LIKE ? LIMIT 10"),
  minerStats: db.prepare('SELECT miner, COUNT(*) c, MAX(n) last FROM blocks WHERE n>? GROUP BY miner'),
  vaultLogs: db.prepare('SELECT * FROM logs WHERE address=? ORDER BY block DESC, li DESC LIMIT ? OFFSET ?'),
  vaultLogsFor: db.prepare('SELECT * FROM logs WHERE address=? AND (t3=? OR t1=?) ORDER BY block DESC, li DESC LIMIT 50'),
};
const trOut = (r) => ({ tx: r.tx, block: r.block, logIndex: r.li, timestamp: r.ts, token: ck(r.token), from: ck(r.from_a), to: ck(r.to_a), value: r.value });
const tokOut = (t) => t && ({ address: ck(t.address), name: t.name, symbol: t.symbol, decimals: t.decimals ?? 18 });
const blockOut = (b) => b && ({ number: b.n, hash: b.hash, parentHash: b.parent, timestamp: b.ts, miner: ck(b.miner), gasUsed: b.gas_used, gasLimit: b.gas_limit, txCount: b.tx_count, size: b.size });
const pad32 = (a) => '0x' + '0'.repeat(24) + a.slice(2);
function tokenMap(rows) { const m = {}; for (const r of rows) { const a = r.token.toLowerCase(); if (!m[a]) m[a] = tokOut(tokenRow.get(a)) || { address: ck(a), symbol: null, decimals: 18 }; } return m; }

// ---------- API ----------
async function stats() {
  return cached('stats', 2000, async () => {
    const head = indexer.state.head, indexed = Q.head.get().n ?? -1;
    const sp = Q.span.get(Math.max(-1, indexed - 100));
    const blockTime = sp.c > 1 ? (sp.b - sp.a) / (sp.c - 1) : null;
    const [gasPrice, burned, vals] = await Promise.all([
      cached('gp', 15000, () => rpc('eth_gasPrice').catch(() => null)),
      cached('burn', 30000, async () => { if (!known.feeSplitter) return null; try { return BigInt(await rpc('eth_call', [{ to: known.feeSplitter, data: '0xd89135cd' }, 'latest'])).toString(); } catch { return null; } }),
      validators(),
    ]);
    const counts = await cached('txcount', 15000, async () => ({ total: Q.txCount.get().c, day: Q.txSince.get(Math.max(0, indexed - 86400)).c }));
    const total = known.genesisSupply;
    return { chainId: CHAIN_ID, head, indexed, lag: Math.max(0, head - indexed), backfillDone: !!indexer.state.backfillDoneAt, blockTime,
      tps: sp.b > sp.a ? (sp.t || 0) / (sp.b - sp.a) : 0, txs: counts.total, txs24h: counts.day, gasPrice: gasPrice ? BigInt(gasPrice).toString() : null,
      validators: vals.length, totalSupply: total.toString(), burned, circulating: burned != null ? (total - BigInt(burned)).toString() : null,
      feeModel: 'zeroBaseFee（EIP-1559 のベースフィー焼却なし）・最低 gas price 1 gwei・FeeSplitter 経由のバーンを集計' };
  });
}

async function txDetail(hash) {
  let t = Q.tx.get(hash), pending = false, logs, transfers;
  if (t) { logs = Q.txLogs.all(hash); transfers = Q.txTransfers.all(hash).map(trOut); }
  else {
    const [rt, rr] = await Promise.all([rpc('eth_getTransactionByHash', [hash]), rpc('eth_getTransactionReceipt', [hash])]);
    if (!rt) return null;
    pending = !rr;
    const blk = rt.blockNumber ? await rpc('eth_getBlockByNumber', [rt.blockNumber, false]) : null;
    t = { hash, block: rt.blockNumber ? Number(rt.blockNumber) : null, idx: rt.transactionIndex ? Number(rt.transactionIndex) : null, ts: blk ? Number(blk.timestamp) : null,
      from_a: rt.from.toLowerCase(), to_a: rt.to?.toLowerCase() || null, value: BigInt(rt.value).toString(), gas: Number(rt.gas), gas_price: BigInt(rr?.effectiveGasPrice || rt.gasPrice || 0).toString(),
      gas_used: rr ? Number(rr.gasUsed) : null, status: rr ? Number(rr.status) : null, nonce: Number(rt.nonce), type: Number(rt.type || 0), input: rt.input, created: rr?.contractAddress?.toLowerCase() || null, nlogs: rr?.logs?.length || 0 };
    logs = (rr?.logs || []).map((l) => ({ block: Number(l.blockNumber), li: Number(l.logIndex), tx: hash, address: l.address.toLowerCase(), t0: l.topics[0], t1: l.topics[1], t2: l.topics[2], t3: l.topics[3], data: l.data }));
    transfers = [];
  }
  const out = txOut(t); out.input = t.input; out.pending = pending; out.indexed = !pending && !!Q.tx.get(hash);
  out.decoded = decodeInput(t.to_a, t.input);
  out.confirmations = t.block != null ? Math.max(0, indexer.state.head - t.block + 1) : 0;
  out.logs = logs.map((l) => ({ logIndex: l.li, address: ck(l.address), topics: [l.t0, l.t1, l.t2, l.t3].filter((x) => x != null), data: l.data, decoded: decodeLog(l) }));
  out.tokenTransfers = transfers; out.tokens = tokenMap(transfers.map((r) => ({ token: r.token })));
  const blockRow = t.block != null ? Q.blockN.get(t.block) : null; out.proposer = blockRow ? ck(blockRow.miner) : null;
  const addrs = [t.from_a, t.to_a, t.created, blockRow?.miner, ...logs.map((l) => l.address), ...transfers.flatMap((r) => [r.from, r.to, r.token])];
  for (const l of out.logs) for (const a of l.decoded?.args || []) if (typeof a.value === 'string' && isAddr(a.value)) addrs.push(a.value);
  for (const a of out.decoded?.args || []) if (typeof a.value === 'string' && isAddr(a.value)) addrs.push(a.value); else if (Array.isArray(a.value)) for (const v of a.value) if (typeof v === 'string' && isAddr(v)) addrs.push(v);
  out.labels = labelsFor(addrs);
  out.internalTxNote = 'このノードはトレース API を公開していないため、内部トランザクション（コントラクト内の ZNYT 送金）は表示できません。デコード済みイベントログを参照してください。';
  return out;
}

async function bridgeTransfers() {
  return cached('bridgeTr', 10000, async () => {
    try {
      const r = await fetch(BRIDGE_API, { signal: AbortSignal.timeout(5000) }); if (!r.ok) return [];
      const j = await r.json();
      return (j.transfers || []).slice(0, 500).map((t) => ({ id: String(t.id || ''), kind: t.kind, srcChainId: Number(t.srcChainId), dstChainId: Number(t.dstChainId), nonce: String(t.nonce ?? ''),
        sender: isAddr(t.sender || '') ? ck(t.sender) : null, recipient: /^0x[0-9a-fA-F]{64}$/.test(t.recipient || '') ? ck('0x' + t.recipient.slice(26)) : isAddr(t.recipient || '') ? ck(t.recipient) : null,
        amount: /^\d+$/.test(String(t.amount)) ? String(t.amount) : null, srcTx: isHash(t.srcTx || '') ? t.srcTx : null, dstTx: isHash(t.dstTx || '') ? t.dstTx : null,
        status: String(t.status || '').slice(0, 32), createdAt: t.createdAt || null, doneAt: t.doneAt || null }));
    } catch { return []; }
  });
}
const remotesOut = () => [{ chainId: CHAIN_ID, name: 'ZERONYTH', explorer: PUBLIC_ORIGIN, status: 'live' }, ...known.remotes.filter((r) => r.explorer).map((r) => ({ chainId: r.chainId, name: r.name, explorer: r.explorer, status: r.status }))];

async function addressDetail(a) {
  const [bal, nonce, code] = await Promise.all([rpc('eth_getBalance', [a, 'latest']), rpc('eth_getTransactionCount', [a, 'latest']), rpc('eth_getCode', [a, 'latest'])]);
  const tok = Q.token.get(a); const c = Q.contract.get(a); const vals = await validators();
  const tokens = Q.addrBal.all(a).filter((r) => !r.value.startsWith('-')).map((r) => ({ token: ck(r.token), name: r.name, symbol: r.symbol, decimals: r.decimals ?? 18, value: r.value }));
  const br = known.vault ? Q.vaultLogsFor.all(known.vault, pad32(a), pad32(a)).map((l) => ({ tx: l.tx, block: l.block, logIndex: l.li, decoded: decodeLog(l) })) : [];
  const ca = ck(a);
  const remote = (await bridgeTransfers()).filter((t) => t.sender === ca || t.recipient === ca).slice(0, 50);
  const lab = known.labels.get(a);
  return { address: ca, balance: BigInt(bal).toString(), nonce: Number(nonce), isContract: code && code !== '0x', codeSize: code && code !== '0x' ? (code.length - 2) / 2 : 0,
    label: lab ? { name: lab.name, kind: lab.kind } : vals.includes(a) ? { name: 'QBFT validator', kind: 'validator' } : tok?.symbol ? { name: tok.symbol, kind: 'token' } : null,
    token: tokOut(tok), creator: c ? { address: ck(c.creator), tx: c.tx, block: c.block } : null, txCount: Q.addrTxCount.get(a).c,
    transferCount: Q.addrTrCount.get(a, a).c, tokens, validator: vals.includes(a) ? { blocksProposed: Q.mined.get(a).c } : null,
    bridge: { vaultEvents: br, transfers: remote, remotes: remotesOut() },
    points: `https://zeronyth.dpdns.org/points.html?address=${ca}`, labels: labelsFor([a, c?.creator, ...tokens.map((t) => t.token)]) };
}

async function search(q) {
  q = String(q || '').trim().slice(0, 100);
  if (isHash(q)) {
    const h = q.toLowerCase();
    if (Q.tx.get(h)) return { type: 'tx', id: h };
    if (Q.blockH.get(h)) return { type: 'block', id: Q.blockH.get(h).n };
    try { if (await rpc('eth_getTransactionByHash', [h])) return { type: 'tx', id: h }; } catch { /* ignore */ }
    try { const b = await rpc('eth_getBlockByHash', [h, false]); if (b) return { type: 'block', id: Number(b.number) }; } catch { /* ignore */ }
    return { type: 'none' };
  }
  if (isAddr(q)) return { type: Q.token.get(q.toLowerCase()) ? 'token' : 'address', id: ck(q) };
  if (/^\d{1,12}$/.test(q.replace(/[,_]/g, ''))) return { type: 'block', id: Number(q.replace(/[,_]/g, '')) };
  if (/^0x[0-9a-fA-F]{1,12}$/.test(q)) return { type: 'block', id: Number(BigInt(q)) };
  const s = q.toLowerCase().replace(/[%_\\]/g, ''); if (!s) return { type: 'none' };
  const exact = db.prepare('SELECT address FROM tokens WHERE lower(symbol)=? LIMIT 2').all(s);
  if (exact.length === 1) return { type: 'token', id: ck(exact[0].address) };
  const results = Q.tokSearch.all(`%${s}%`, `%${s}%`).map((t) => ({ type: 'token', id: ck(t.address), name: `${t.symbol || '?'}${t.name ? ` — ${t.name}` : ''}` }));
  for (const [a, l] of known.labels) if (l.name.toLowerCase().includes(s) && !results.some((r) => r.id.toLowerCase() === a) && results.length < 20) results.push({ type: l.kind === 'token' ? 'token' : 'address', id: ck(a), name: l.name });
  return results.length === 1 ? results[0] : results.length ? { type: 'list', results } : { type: 'none' };
}

async function api(p, u) {
  const m = (re) => p.match(re);
  let r;
  if (p === '/api/stats') return stats();
  if (p === '/api/health') { const s = await stats(); return { ok: indexer.state.lastError == null, head: s.head, indexed: s.indexed, lag: s.lag, backfillDone: s.backfillDone, backfillDoneAt: indexer.state.backfillDoneAt, rssMB: Math.round(process.memoryUsage().rss / 1048576), dbMB: Math.round((statSync(path.join(DATA, 'scan.sqlite')).size + (existsSync(path.join(DATA, 'scan.sqlite-wal')) ? statSync(path.join(DATA, 'scan.sqlite-wal')).size : 0)) / 1048576), lastError: indexer.state.lastError }; }
  if (p === '/api/meta') return { chainId: CHAIN_ID, name: 'ZERONYTH Testnet', symbol: 'ZNYT', rpc: 'https://zeronyth.dpdns.org/rpc', explorer: PUBLIC_ORIGIN, site: 'https://zeronyth.dpdns.org/', remotes: remotesOut() };
  if (p === '/api/blocks') { const pg = pageOf(u), sz = sizeOf(u); const rows = Q.blocks.all(sz, (pg - 1) * sz); return { page: pg, size: sz, total: (Q.head.get().n ?? -1) + 1, blocks: rows.map(blockOut), labels: labelsFor(rows.map((b) => b.miner)) }; }
  if (p === '/api/txs') { const pg = pageOf(u), sz = sizeOf(u); const rows = Q.txs.all(sz, (pg - 1) * sz); const s = await stats(); return { page: pg, size: sz, total: s.txs, txs: rows.map(txOut), labels: labelsFor(rows.flatMap((t) => [t.from_a, t.to_a, t.created])) }; }
  if ((r = m(/^\/api\/block\/(\d{1,12}|0x[0-9a-fA-F]{64})$/))) {
    const b = /^\d+$/.test(r[1]) ? Q.blockN.get(Number(r[1])) : Q.blockH.get(r[1].toLowerCase()); if (!b) return null;
    const txs = Q.blockTxs.all(b.n);
    return { ...blockOut(b), confirmations: Math.max(0, indexer.state.head - b.n + 1), txs: txs.map(txOut), labels: labelsFor([b.miner, ...txs.flatMap((t) => [t.from_a, t.to_a, t.created])]) };
  }
  if ((r = m(/^\/api\/tx\/(0x[0-9a-fA-F]{64})$/))) return txDetail(r[1].toLowerCase());
  if ((r = m(/^\/api\/address\/(0x[0-9a-fA-F]{40})$/))) return addressDetail(r[1].toLowerCase());
  if ((r = m(/^\/api\/address\/(0x[0-9a-fA-F]{40})\/txs$/))) {
    const a = r[1].toLowerCase(), pg = pageOf(u), sz = sizeOf(u); const rows = Q.addrTxs.all(a, sz, (pg - 1) * sz);
    const trs = rows.length ? db.prepare(`SELECT * FROM transfers WHERE tx IN (${rows.map(() => '?').join(',')}) AND (from_a=? OR to_a=?)`).all(...rows.map((t) => t.hash), a, a).map(trOut) : [];
    return { page: pg, size: sz, total: Q.addrTxCount.get(a).c, txs: rows.map(txOut), transfers: trs, tokens: tokenMap(trs), labels: labelsFor(rows.flatMap((t) => [t.from_a, t.to_a, t.created])) };
  }
  if ((r = m(/^\/api\/address\/(0x[0-9a-fA-F]{40})\/transfers$/))) {
    const a = r[1].toLowerCase(), pg = pageOf(u), sz = sizeOf(u); const rows = Q.addrTr.all(a, a, sz, (pg - 1) * sz).map(trOut);
    return { page: pg, size: sz, total: Q.addrTrCount.get(a, a).c, transfers: rows, tokens: tokenMap(rows), labels: labelsFor(rows.flatMap((t) => [t.from, t.to])) };
  }
  if ((r = m(/^\/api\/address\/(0x[0-9a-fA-F]{40})\/blocks$/))) {
    const a = r[1].toLowerCase(), pg = pageOf(u), sz = sizeOf(u);
    return { page: pg, size: sz, total: Q.mined.get(a).c, blocks: Q.minedList.all(a, sz, (pg - 1) * sz).map((b) => ({ number: b.n, hash: b.hash, timestamp: b.ts, txCount: b.tx_count, gasUsed: b.gas_used })) };
  }
  if (p === '/api/tokens') return cached('tokens', 10000, async () => ({ tokens: Q.tokens.all().map((t) => ({ ...tokOut(t), holders: t.holders, transfers: t.transfers, label: known.labels.get(t.address)?.name || null })) }));
  if ((r = m(/^\/api\/token\/(0x[0-9a-fA-F]{40})$/))) {
    const a = r[1].toLowerCase(); const t = Q.token.get(a); if (!t) return null;
    const supply = await cached('ts:' + a, 15000, () => rpc('eth_call', [{ to: a, data: erc20.encodeFunctionData('totalSupply') }, 'latest']).then((d) => BigInt(d).toString()).catch(() => null));
    return { ...tokOut(t), totalSupply: supply, holders: Q.holderCount.get(a).c, transfers: Q.tokTrCount.get(a).c, firstBlock: t.first_block, label: known.labels.get(a)?.name || null, isWrappedNative: a === known.wznyt };
  }
  if ((r = m(/^\/api\/token\/(0x[0-9a-fA-F]{40})\/holders$/))) {
    const a = r[1].toLowerCase(), pg = pageOf(u), sz = sizeOf(u); const rows = Q.holders.all(a, sz, (pg - 1) * sz);
    return { page: pg, size: sz, total: Q.holderCount.get(a).c, holders: rows.map((h, i) => ({ rank: (pg - 1) * sz + i + 1, address: ck(h.holder), value: h.value })), labels: labelsFor(rows.map((h) => h.holder)) };
  }
  if ((r = m(/^\/api\/token\/(0x[0-9a-fA-F]{40})\/transfers$/))) {
    const a = r[1].toLowerCase(), pg = pageOf(u), sz = sizeOf(u); const rows = Q.tokTr.all(a, sz, (pg - 1) * sz).map(trOut);
    return { page: pg, size: sz, total: Q.tokTrCount.get(a).c, transfers: rows, tokens: tokenMap(rows), labels: labelsFor(rows.flatMap((t) => [t.from, t.to])) };
  }
  if (p === '/api/validators') return cached('vals', 5000, async () => {
    const vals = await validators(); const indexed = Q.head.get().n ?? 0;
    const all = new Map(db.prepare('SELECT miner, COUNT(*) c, MAX(n) last FROM blocks GROUP BY miner').all().map((x) => [x.miner, x]));
    const recent = new Map(Q.minerStats.all(indexed - 1000).map((x) => [x.miner, x]));
    const lastB = Q.blockN.get(indexed);
    return { validators: vals.map((v) => ({ address: ck(v), blocksProposed: all.get(v)?.c || 0, last1000: recent.get(v)?.c || 0, lastBlock: all.get(v)?.last ?? null })), latestProposer: ck(lastB?.miner), head: indexed, consensus: 'QBFT（1 秒ブロック・即時ファイナリティ）', labels: labelsFor(vals) };
  });
  if (p === '/api/bridge') {
    const pg = pageOf(u, 100), sz = sizeOf(u);
    const ev = known.vault ? Q.vaultLogs.all(known.vault, sz, (pg - 1) * sz).map((l) => ({ tx: l.tx, block: l.block, logIndex: l.li, decoded: decodeLog(l) })) : [];
    return { vault: ck(known.vault), board: ck(known.board), wznyt: ck(known.wznyt), vaultEvents: ev, transfers: (await bridgeTransfers()).slice(0, 100), remotes: remotesOut() };
  }
  if (p === '/api/search') return search(u.searchParams.get('q'));
  return undefined;
}

// ---------- HTTP ----------
const SEC = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()', 'Cross-Origin-Opener-Policy': 'same-origin',
};
const buckets = new Map();
function allow(ip, cost, cap = 90, perSec = 3) {
  const now = Date.now(); let b = buckets.get(ip);
  if (!b) { b = { t: now, n: cap }; buckets.set(ip, b); }
  b.n = Math.min(cap, b.n + ((now - b.t) / 1000) * perSec); b.t = now;
  if (b.n < cost) return false; b.n -= cost; return true;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.t > 120000) buckets.delete(k); }, 60000).unref();
const clientIp = (req) => {
  const peer = req.socket.remoteAddress || '';
  const loop = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  const cf = String(req.headers['cf-connecting-ip'] || '').trim();
  return ipKey(loop && /^[0-9a-fA-F:.]{3,45}$/.test(cf) ? cf : peer);
};
// Rate-limit IPv6 clients per /64 (one host can rotate addresses inside its /64); IPv4 per address.
function ipKey(ip) {
  ip = ip.replace(/^::ffff:(?=\d+\.)/i, '');
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const hs = head ? head.split(':') : [], ts = tail ? tail.split(':') : [];
  const full = [...hs, ...Array(Math.max(0, 8 - hs.length - ts.length)).fill('0'), ...ts];
  return full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
const GLOBAL_CAP = 600, GLOBAL_PER_SEC = 120; // whole-service ceiling so a distributed burst cannot saturate the node RPC
const PUB = path.join(HERE, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
const fileCache = new Map();
function staticFile(rel) {
  const f = path.join(PUB, rel); if (!f.startsWith(PUB + path.sep) || !existsSync(f) || !statSync(f).isFile()) return null;
  const mt = statSync(f).mtimeMs; const c = fileCache.get(f); if (c && c.mt === mt) return c;
  const v = { mt, body: readFileSync(f), type: MIME[path.extname(f)] || 'application/octet-stream' }; fileCache.set(f, v); return v;
}
const SPA = /^\/(?:|tx\/0x[0-9a-fA-F]{64}|address\/0x[0-9a-fA-F]{40}|block\/(?:\d{1,12}|0x[0-9a-fA-F]{64})|token\/0x[0-9a-fA-F]{40}|tokens|blocks|txs|validators|bridge|search|explorer)\/?$/;
const REDIRECTABLE = /^\/(?:(tx|address|block|token)\/([0-9a-zA-Z]{1,80})|explorer\/?)$/;

function send(res, code, body, headers = {}) { res.writeHead(code, { ...SEC, ...headers }); res.end(body); }
const sendJson = (res, code, obj, cache = 'no-store') => send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache, 'Access-Control-Allow-Origin': '*' });

// Aggregate-only visitor counter (no cookies / raw IPs); detail paths folded so per-page totals stay small.
const visits = createVisitorCounter({ site: 'scan', isPage: (p) => SPA.test(p),
  pageKey: (p) => p.replace(/^\/(tx|block|address|token)\/[^/]+\/?$/, '/$1/:id') });
const server = http.createServer(async (req, res) => {
  res.on('finish', () => visits.record(req, res));
  try {
    const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
    const u = new URL(req.url || '/', 'http://x'); const p = u.pathname;
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed', { Allow: 'GET, HEAD', 'Content-Type': 'text/plain' });
    if (MAIN_HOSTS.has(host)) { // old explorer URL on the main site -> standalone scan site
      const mm = p.match(REDIRECTABLE);
      if (!mm) return send(res, 404, 'not found', { 'Content-Type': 'text/plain' });
      return send(res, 301, '', { Location: mm[1] ? `${PUBLIC_ORIGIN}/${mm[1]}/${mm[2]}` : `${PUBLIC_ORIGIN}/`, 'Cache-Control': 'public, max-age=3600' });
    }
    const ip = clientIp(req);
    if (p.startsWith('/api/')) {
      const cost = p === '/api/search' || p.startsWith('/api/address/') ? 3 : 1;
      if (!allow('a:' + ip, cost) || !allow('global', cost, GLOBAL_CAP, GLOBAL_PER_SEC)) return sendJson(res, 429, { error: 'rate limited / リクエストが多すぎます。少し待ってください' }, 'no-store');
      const out = await api(p, u);
      if (out === undefined) return sendJson(res, 404, { error: 'unknown endpoint' });
      if (out === null) return sendJson(res, 404, { error: 'not found' });
      const imm = /^\/api\/(tx|block)\//.test(p) && !out.pending && out.indexed !== false && out.confirmations > 3;
      return sendJson(res, 200, out, imm ? 'public, max-age=300' : 'public, max-age=2');
    }
    if (!allow('s:' + ip, 0.25, 200, 10)) return send(res, 429, 'rate limited', { 'Content-Type': 'text/plain' });
    if (p === '/explorer' || p === '/explorer/') return send(res, 301, '', { Location: '/' });
    const f = SPA.test(p) ? staticFile('index.html') : p === '/favicon.ico' ? staticFile('assets/favicon-64.png') : staticFile(p.replace(/^\/+/, ''));
    if (!f) return send(res, 404, 'not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    return send(res, 200, req.method === 'HEAD' ? '' : f.body, { 'Content-Type': f.type, 'Cache-Control': f.type.startsWith('text/html') ? 'no-cache' : 'public, max-age=300' });
  } catch (e) {
    const msg = String(e?.message || e);
    if (!e?.rpc) console.error('[explorer]', msg.slice(0, 200));
    if (!res.headersSent) sendJson(res, e?.rpc ? 400 : 500, { error: e?.rpc ? 'not found or invalid' : 'internal error' });
  }
});
server.requestTimeout = 20000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
server.listen(PORT, HOST, () => console.log(`[explorer] ZERONYTH Scan on http://${HOST}:${PORT} (rpc ${RPC_URL}, data ${DATA}, public ${PUBLIC_ORIGIN})`));
indexer.run({ batch: Number(process.env.EXPLORER_BATCH || 50) });
