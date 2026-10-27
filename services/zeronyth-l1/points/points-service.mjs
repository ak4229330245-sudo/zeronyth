// ZERONYTH testnet points service (loopback 127.0.0.1:9807). Off-chain, append-only, hash-chained ledger of points
// earned from verified on-chain/served work; daily Merkle snapshots whose roots are published on chain 9127.
// Points have no monetary value. Config: env ZERONYTH_POINTS_CONFIG (default ./points.config.json), hot-reloaded.
// State: env ZERONYTH_POINTS_DIR (default /workspace/zeronyth-points): ledger.jsonl, state.json, snapshots/, admin.token, ip.salt.
import http from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, openSync, readSync, closeSync, renameSync, chmodSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as merkle from './merkle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { ethers } = createRequire(path.join(here, 'package.json'))('ethers');
const PORT = Number(process.env.ZERONYTH_POINTS_PORT || 9807);
const CONFIG = process.env.ZERONYTH_POINTS_CONFIG || path.join(here, 'points.config.json');
const DIR = process.env.ZERONYTH_POINTS_DIR || '/workspace/zeronyth-points';
const LEDGER = path.join(DIR, 'ledger.jsonl'), STATE = path.join(DIR, 'state.json'), SNAP = path.join(DIR, 'snapshots');
const AI_FILE = process.env.ZERONYTH_POINTS_AI_ACCEPTED_FILE || path.join(DIR, 'ai-accepted.jsonl');
const PUB_KEY = process.env.ZERONYTH_POINTS_PUBLISHER_KEY || path.join(os.homedir(), '.zeronyth-secrets/points-publisher-key.json');
mkdirSync(SNAP, { recursive: true }); try { chmodSync(DIR, 0o700); } catch {}
const secretFile = (f, gen) => { if (!existsSync(f)) writeFileSync(f, gen(), { mode: 0o600 }); return readFileSync(f, 'utf8').trim(); };
const ADMIN_TOKEN = secretFile(path.join(DIR, 'admin.token'), () => randomBytes(32).toString('hex'));
const IP_SALT = secretFile(path.join(DIR, 'ip.salt'), () => randomBytes(32).toString('hex'));
const log = (...a) => console.log(new Date().toISOString(), ...a);
const lc = (a) => String(a || '').toLowerCase();
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || ''));
const ZERO = '0x' + '0'.repeat(64);

// ---------- config ----------
let pairInfo = new Map(), cfg, cfgHash, cfgMtime = 0, amm = null, systemSet = new Set(), teamSet = new Set(), faucetSet = new Set(), valOps = new Map();
function loadConfig() {
  const st = statSync(CONFIG), mf0 = cfg && path.resolve(path.dirname(CONFIG), cfg.indexer.ammManifest || '../deployments/main-amm.json');
  const mt = st.mtimeMs + (mf0 && existsSync(mf0) ? statSync(mf0).mtimeMs : 0); if (mt === cfgMtime) return;
  const raw = readFileSync(CONFIG, 'utf8'); const c = JSON.parse(raw); const k = c.categories;
  const others = Object.entries(k).filter(([n, v]) => !['validator', 'node', 'admin'].includes(n) && v.dailyCap != null).reduce((s, [, v]) => s + v.dailyCap, 0);
  if (!(k.validator.dailyCap > k.node.dailyCap && k.node.dailyCap > others)) { log('CONFIG REJECTED: ordering validator > node > others violated', k.validator.dailyCap, k.node.dailyCap, others); if (cfg) return; throw new Error('bad config ordering'); }
  cfg = c; cfgHash = createHash('sha256').update(raw).digest('hex'); cfg._others = others;
  const mf = path.resolve(path.dirname(CONFIG), c.indexer.ammManifest || '../deployments/main-amm.json');
  const mfMt = existsSync(mf) ? statSync(mf).mtimeMs : 0; // stat BEFORE reading so a write racing the read triggers another reload
  amm = mfMt ? JSON.parse(readFileSync(mf, 'utf8')) : null; cfgMtime = st.mtimeMs + mfMt;
  teamSet = new Set((c.team || []).map(lc)); faucetSet = new Set((c.antiSybil.faucetAddresses || []).map(lc));
  const ammAddrs = amm ? [amm.wznyt, amm.keeper, ...Object.values(amm.tokens || {}).map((t) => t.address), ...(amm.pools || []).flatMap((p) => [p.pair, p.router]), ...(amm.retired || []).flatMap((p) => [p.token, p.pair, p.router])] : [];
  systemSet = new Set([...(c.system?.addresses || []), c.indexer.economy, ...ammAddrs, ...faucetSet, '0x000000000000000000000000000000000000dead', ethers.ZeroAddress].filter(Boolean).map(lc));
  // per-pair metadata for swap/LP scoring: ZNYT value of each side (native side = 1, test tokens = labeled testPriceZnyt)
  pairInfo = new Map((amm?.pools || []).map((p) => { const side = (addr) => { if (lc(addr) === lc(amm.wznyt)) return { sym: 'ZNYT', dec: 18, px: 1 };
    const t = Object.values(amm.tokens).find((x) => lc(x.address) === lc(addr)); return { sym: t.symbol, dec: t.decimals, px: Number(t.testPriceZnyt) || 0, tracked: !!t.priceSource }; };
    return [lc(p.pair), { id: p.id, s0: side(p.token0), s1: side(p.token1) }]; }));
  if (pub) systemSet.add(lc(pub.address));
  valOps = new Map(Object.entries(c.validatorOperators || {}).filter(([v, o]) => isAddr(v) && isAddr(o)).map(([v, o]) => [lc(v), lc(o)]));
  log('config loaded', cfgHash.slice(0, 12), 'others-cap', others);
}

// ---------- time ----------
const dayOf = (sec) => new Date((sec + (cfg.dayUtcOffsetHours ?? 9) * 3600) * 1000).toISOString().slice(0, 10);
const nowSec = () => Math.floor(Date.now() / 1000);
const dayEndSec = (day) => Date.parse(day + 'T00:00:00Z') / 1000 - (cfg.dayUtcOffsetHours ?? 9) * 3600 + 86400;

// ---------- ledger (single writer, replayed on start) ----------
let head = { seq: 0, hash: ZERO };
const refs = new Set(), totals = new Map(), daily = new Map(), lifetime = new Map(), banned = new Map(), held = new Map(), flags = new Map(), suspended = new Map(), botCleared = new Map();
const cp = (pts) => Math.round(pts * 100);
function applyEntry(e) {
  head = { seq: e.seq, hash: e.hash }; if (e.ref) refs.add(e.ref);
  if (e.type === 'earn') {
    const t = totals.get(e.addr) || {}; t[e.cat] = (t[e.cat] || 0) + e.cp; totals.set(e.addr, t);
    const dk = `${e.day}|${e.addr}|${e.cat}`; daily.set(dk, (daily.get(dk) || 0) + e.cp);
    const lk = `${e.addr}|${e.cat}`; lifetime.set(lk, (lifetime.get(lk) || 0) + e.cp);
  } else if (e.type === 'zero') totals.set(e.addr, {});
  else if (e.type === 'ban') { banned.set(e.addr, { reason: e.reason, ts: e.ts, perm: !!e.perm, forfeit: !!e.forfeit, cluster: e.clusterOf || null }); suspended.delete(e.addr); if (e.forfeit) totals.set(e.addr, {}); }
  else if (e.type === 'suspend') suspended.set(e.addr, { reason: e.reason, ts: e.ts, score: e.score, signals: e.signals || [], linked: e.linked || [] });
  else if (e.type === 'unban') { banned.delete(e.addr); suspended.delete(e.addr); botCleared.set(e.addr, Math.floor(Date.parse(e.ts) / 1000)); }
  else if (e.type === 'hold') held.set(e.addr, { reason: e.reason, ts: e.ts });
  else if (e.type === 'clear') held.delete(e.addr);
  else if (e.type === 'flag') { const f = flags.get(e.addr) || []; f.push({ reason: e.reason, ts: e.ts, ...(e.signals ? { score: e.score, signals: e.signals } : {}) }); flags.set(e.addr, f); }
}
function append(entry) {
  const e = { seq: head.seq + 1, ts: new Date().toISOString(), ...entry, prev: head.hash };
  e.hash = ethers.keccak256(ethers.toUtf8Bytes(e.prev + JSON.stringify({ ...e, prev: undefined })));
  appendFileSync(LEDGER, JSON.stringify(e) + '\n'); applyEntry(e); return e;
}
function replay() {
  if (!existsSync(LEDGER)) return; let prev = ZERO, n = 0;
  for (const line of readFileSync(LEDGER, 'utf8').split('\n')) { if (!line) continue; const e = JSON.parse(line);
    const h = ethers.keccak256(ethers.toUtf8Bytes(prev + JSON.stringify({ ...e, prev: undefined, hash: undefined })));
    if (e.prev !== prev || e.hash !== h) throw new Error(`ledger chain broken at seq ${e.seq}`); applyEntry(e); prev = e.hash; n++; }
  log('ledger replayed', n, 'entries, head', head.seq);
}

// ---------- state (cursors + wallet metadata) ----------
let S = { lastBlock: null, usageOffset: 0, aiOffset: 0, wallets: {}, ipNew: {}, ipAll: {}, swapDay: {}, recentSwaps: {}, lp: { pairs: {}, lastHour: null, prev: {} }, valHours: {}, snapshots: [], lastSnapDay: null, bot: {} };
if (existsSync(STATE)) S = { ...S, ...JSON.parse(readFileSync(STATE, 'utf8')) };
S.lp ||= {}; S.lp.pairs ||= {}; S.lp.prev ||= {}; S.bot ||= {};
const saveState = () => { writeFileSync(STATE + '.tmp', JSON.stringify(S)); renameSync(STATE + '.tmp', STATE); };
const W = (a) => (S.wallets[a] ||= { firstSeen: null, established: false });

// ---------- earning ----------
function factorFor(addr, atSec) {
  const w = S.wallets[addr]; if (!w || w.established) return 1;
  const age = w.firstSeen == null ? 0 : atSec - w.firstSeen;
  return age >= (cfg.antiSybil.faucetOnlyUntilDays ?? 3) * 86400 ? 1 : (cfg.antiSybil.faucetOnlyFactor ?? 0.5);
}
function earn(addr, cat, pts, ref, atSec, extra = {}) {
  addr = lc(addr); if (!isAddr(addr) || systemSet.has(addr) || banned.has(addr) || suspended.has(addr) || (ref && refs.has(ref))) return 0;
  const c = cfg.categories[cat]; const day = dayOf(atSec);
  let want = cp(pts * (cat === 'admin' ? 1 : factorFor(addr, atSec))); if (want <= 0) return 0;
  if (c.dailyCap != null) want = Math.min(want, cp(c.dailyCap) - (daily.get(`${day}|${addr}|${cat}`) || 0));
  if (c.lifetimeCap != null) want = Math.min(want, cp(c.lifetimeCap) - (lifetime.get(`${addr}|${cat}`) || 0));
  if (want <= 0) return 0;
  append({ type: 'earn', day, addr, cat, cp: want, ref, ...extra }); return want;
}

// ---------- anti-sybil: IP sightings from the gateway (only a salted hash is stored) ----------
function seen(address, ip, src) {
  const a = lc(address); if (!isAddr(a) || !ip) return;
  const h = createHash('sha256').update(IP_SALT + ip).digest('hex').slice(0, 16), w = W(a), day = dayOf(nowSec());
  w.ips ||= []; if (!w.ips.includes(h)) { w.ips.push(h); if (w.ips.length > 20) w.ips.shift(); }
  const all = (S.ipAll[h] ||= []); if (!all.includes(a)) { all.push(a);
    if (all.length === (cfg.antiSybil.deviceClusterFlag ?? 20)) for (const x of all) if (!systemSet.has(x)) append({ type: 'flag', addr: x, reason: `device-cluster:${h.slice(0, 6)}:${all.length}` }); }
  if (!w.ipFirstDay) { w.ipFirstDay = day; const k = `${day}|${h}`; const list = (S.ipNew[k] ||= []); list.push(a);
    if (list.length > (cfg.antiSybil.maxNewWalletsPerIpPerDay ?? 3) && !held.has(a) && !systemSet.has(a) && !teamSet.has(a))
      append({ type: 'hold', addr: a, reason: `ip-new-wallet-limit:${h.slice(0, 6)}:${list.length}`, ref: `hold:${a}` }); }
  if (src) w.lastSrc = src;
}
const sameCluster = (a, b) => { const x = S.wallets[a]?.ips, y = S.wallets[b]?.ips; return !!(x && y && x.some((h) => y.includes(h))); };

// ---------- RPC ----------
let rpcId = 0;
async function rpc(method, params) {
  const r = await fetch(cfg.indexer.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }), signal: AbortSignal.timeout(20000) });
  const j = await r.json(); if (j.error) throw new Error(`${method}: ${j.error.message}`); return j.result;
}
const econIface = new ethers.Interface(['event WorkCredited(uint256 indexed epoch,address indexed provider,uint256 l1Units,uint256 aiUnits,uint256 rentalUnits,uint256 znyt,uint256 credits)', 'event Subscribed(uint256 indexed paymentId,address indexed payer,uint8 kind,uint256 amount,uint64 start,uint64 end)']);
const pairIface = new ethers.Interface(['event Swap(address indexed sender,address indexed to,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out)', 'event Transfer(address indexed from,address indexed to,uint256 value)', 'event Sync(uint112 reserve0,uint112 reserve1)']);
const T = { wc: econIface.getEvent('WorkCredited').topicHash, sub: econIface.getEvent('Subscribed').topicHash, swap: pairIface.getEvent('Swap').topicHash, xfer: pairIface.getEvent('Transfer').topicHash, sync: pairIface.getEvent('Sync').topicHash };
const toZ = (wei) => Number(ethers.formatEther(wei));

// ---------- scoring helpers ----------
function swapScore(n, vol) { const c = cfg.categories.swap; return c.pointsPerSwap * Math.min(n, c.fullRateSwaps) + c.pointsPerSwapAfter * Math.max(0, n - c.fullRateSwaps) + c.volumeFactor * Math.sqrt(vol); }
function onSwap(user, pool, dir, znyt, ts, ref) {
  const c = cfg.categories.swap; botEv(user, 's', ts, znyt); if (znyt < c.minZnyt) return;
  const rs = (S.recentSwaps[user] ||= []).filter((s) => ts - s.ts <= c.roundTripWindowSec); S.recentSwaps[user] = rs;
  const rt = rs.find((s) => s.pool === pool && s.dir !== dir && Math.abs(s.z - znyt) <= c.roundTripTolerance * Math.max(s.z, znyt));
  rs.push({ ts, pool, dir, z: znyt }); if (rt) { rs.splice(rs.indexOf(rt), 1); botEv(user, 'pp', ts); return; }
  const day = dayOf(ts), k = `${day}|${user}`, d = (S.swapDay[k] ||= { n: 0, v: 0 });
  const before = swapScore(d.n, d.v); d.n++; d.v += znyt; earn(user, 'swap', swapScore(d.n, d.v) - before, ref, ts);
}
// ---------- anti-bot detection (score-based, explainable; config antiBot) ----------
// Per-wallet rolling activity (block timestamps, so replays are deterministic): t=successful tx (z = ZNYT value sent), s=swap (z = ZNYT size),
// pp=round-trip (ping-pong) swap, la/lr=LP add/remove. Score >= suspendScore -> automatic 'suspend' ledger entry (accrual stops, hidden,
// excluded from snapshots, status BAN（審査中）); flagScore..suspendScore -> 'flag' entry once per day. Linked wallets (same funding source /
// IP hash) are listed as evidence only; they are banned only when an admin confirms with cluster=true. Role addresses are never scored.
const botExcluded = (a) => systemSet.has(a) || teamSet.has(a) || (amm && [amm.deployer, amm.keeper].filter(Boolean).map(lc).includes(a));
const botDirty = new Set();
function botEv(addr, k, ts, z = 0) {
  addr = lc(addr); const ab = cfg.antiBot; if (!ab?.enabled || !isAddr(addr) || botExcluded(addr)) return;
  const b = (S.bot[addr] ||= { ev: [] }); b.ev.push(z ? [ts, k, +z.toPrecision(6)] : [ts, k]);
  if (b.ev.length > (ab.maxEvents || 800)) b.ev.splice(0, b.ev.length - (ab.maxEvents || 800)); botDirty.add(addr);
}
const median = (xs) => { const v = [...xs].sort((a, b) => a - b), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
function botLinked(addr) { // wallets sharing this wallet's funding source (not faucet/system) or one of its IP hashes
  const w = S.wallets[addr] || {}, fund = new Set(), ip = new Set();
  if (w.fundedBy && !botExcluded(w.fundedBy)) { fund.add(w.fundedBy); for (const [a, x] of Object.entries(S.wallets)) if (x.fundedBy === w.fundedBy && a !== addr) fund.add(a); }
  for (const h of w.ips || []) for (const a of S.ipAll[h] || []) if (a !== addr && !botExcluded(a)) ip.add(a);
  return { funder: w.fundedBy && !botExcluded(w.fundedBy) ? w.fundedBy : null, byFunding: [...fund].filter((a) => !botExcluded(a)), byIp: [...ip] };
}
function botScore(addr, now) {
  const ab = cfg.antiBot, since = Math.max(now - (ab.windowSec || 86400), botCleared.get(addr) || 0);
  const ev = (S.bot[addr]?.ev || []).filter((e) => e[0] > since && e[0] <= now), sig = [];
  const add = (id, pts, detail) => sig.push({ id, pts, detail });
  const tx = ev.filter((e) => e[1] === 't'), sw = ev.filter((e) => e[1] === 's'), acts = tx; // every successful tx (swaps included) is one 't' event
  const F = ab.frequency, hour = acts.filter((e) => e[0] > now - 3600).length;
  if (hour >= F.perHourHigh) add('frequency', F.ptsHigh, `直近1時間に ${hour} 件の取引・スワップ（基準 ${F.perHourHigh} 件以上）`);
  else if (hour >= F.perHour) add('frequency', F.pts, `直近1時間に ${hour} 件の取引・スワップ（基準 ${F.perHour} 件以上）`);
  if (acts.length >= F.perDay) add('frequencyDay', F.ptsDay, `直近24時間に ${acts.length} 件（基準 ${F.perDay} 件以上）`);
  const R = ab.regular, seq = tx;
  if (seq.length >= R.lastN) { const last = seq.slice(-R.lastN).map((e) => e[0]), iv = last.slice(1).map((t, i) => t - last[i]);
    const m = iv.reduce((s, x) => s + x, 0) / iv.length, sd = Math.sqrt(iv.reduce((s, x) => s + (x - m) ** 2, 0) / iv.length), cv = m > 0 ? sd / m : 0;
    if (m <= R.maxMeanSec && cv <= R.maxCv) add('regular', R.pts, `直近 ${R.lastN} 件の間隔が機械的に一定（平均 ${m.toFixed(1)} 秒・ばらつき ${(cv * 100).toFixed(1)}%、基準 ${(R.maxCv * 100).toFixed(0)}% 以下）`); }
  const Z = ab.sameSize; for (const [label, list] of [['送金', tx], ['スワップ', sw]]) { const sized = list.filter((e) => e[2] > 0).slice(-Z.lastN);
    if (sized.length < Z.lastN) continue; const md = median(sized.map((e) => e[2])); if (md > Z.maxMedianZnyt) continue;
    const near = sized.filter((e) => Math.abs(e[2] - md) <= Z.tolerance * md).length;
    if (near / sized.length >= Z.share) { add('sameSize', Z.pts, `小さく同じ額の${label}の繰り返し（直近 ${sized.length} 件中 ${near} 件が ${md.toPrecision(3)} ZNYT ±${Z.tolerance * 100}%）`); break; } }
  const P = ab.pingPong, pp = ev.filter((e) => e[1] === 'pp').length;
  if (pp >= P.high) add('pingPong', P.ptsHigh, `往復スワップ ${pp} 回（基準 ${P.high} 回以上）`); else if (pp >= P.count) add('pingPong', P.pts, `往復スワップ ${pp} 回（基準 ${P.count} 回以上）`);
  const L = ab.lpCycle; let cyc = 0, open = false; for (const e of ev) { if (e[1] === 'la') open = true; else if (e[1] === 'lr' && open) { cyc++; open = false; } }
  if (cyc >= L.cycles) add('lpCycle', L.pts, `流動性の追加→引き出しを ${cyc} 回くり返し（基準 ${L.cycles} 回以上）`);
  const C = ab.cluster, lk = botLinked(addr), activeFund = lk.byFunding.filter((a) => S.bot[a]?.ev?.length).length;
  if (lk.funder && activeFund + 1 >= C.minSize) add('clusterFunding', C.pts, `同じ送金元 ${short(ethers.getAddress(lk.funder))} から資金を受けた活動中のウォレットが ${activeFund + 1} 個（基準 ${C.minSize} 個以上）`);
  if (lk.byIp.length + 1 >= C.minSize) add('clusterIp', C.pts, `同じ回線（IP ハッシュ）のウォレットが ${lk.byIp.length + 1} 個（基準 ${C.minSize} 個以上）`);
  const susp = [...new Set([...lk.byFunding, ...lk.byIp])].filter((a) => suspended.has(a) || banned.get(a)?.perm);
  if (susp.length && ev.length >= (ab.minEvents || 10)) add('clusterSuspended', C.suspendedMemberPts, `つながったウォレット ${susp.length} 個が BAN（審査中を含む）`);
  // cluster signals alone never suspend: they only add to activity-based signals
  const activity = sig.filter((x) => !x.id.startsWith('cluster')).reduce((s, x) => s + x.pts, 0), score = sig.reduce((s, x) => s + x.pts, 0);
  return { score: activity > 0 ? score : 0, activity, signals: sig, events: ev.length, linked: [...new Set([...lk.byFunding, ...lk.byIp])].slice(0, 50), funder: lk.funder };
}
function botCheck(now) {
  const ab = cfg.antiBot; if (!ab?.enabled) { botDirty.clear(); return; }
  for (const a of botDirty) { if (botExcluded(a) || suspended.has(a) || banned.has(a)) continue; const r = botScore(a, now);
    const why = r.signals.map((x) => x.id).join('+');
    if (r.score >= ab.suspendScore) { append({ type: 'suspend', addr: a, reason: `bot-score:${r.score}（${why}）`, score: r.score, signals: r.signals, linked: r.linked, atBlockTs: now }); rankCache.at = 0; log('bot suspend', a, r.score, why); }
    else if (r.score >= ab.flagScore) { const day = dayOf(now); if (!(flags.get(a) || []).some((f) => f.reason?.startsWith(`bot:${day}`))) append({ type: 'flag', addr: a, reason: `bot:${day}:${r.score}（${why}）`, score: r.score, signals: r.signals }); } }
  botDirty.clear();
  for (const [a, b] of Object.entries(S.bot)) { const cut = now - (ab.windowSec || 86400); if (b.ev.length && b.ev.at(-1)[0] < cut) delete S.bot[a]; else if (b.ev[0]?.[0] < cut) b.ev = b.ev.filter((e) => e[0] >= cut); }
}
// price-tracked tokens (e.g. zBNB): use the keeper's latest real-USD reference (deployments/main-amm-prices.json) if fresh (<1 h)
let pxCache = { at: 0, tokens: {} };
function livePx(side) {
  if (!side.tracked) return side.px;
  if (Date.now() - pxCache.at > 60_000) { pxCache.at = Date.now(); try { const f = path.resolve(path.dirname(CONFIG), cfg.indexer.ammPrices || '../deployments/main-amm-prices.json'); const j = JSON.parse(readFileSync(f, 'utf8')); pxCache.tokens = Date.now() - Date.parse(j.updatedAt) < 3_600_000 ? j.tokens : {}; } catch { pxCache.tokens = {}; } }
  return Number(pxCache.tokens[side.sym]?.znyt) || side.px;
}
const units = (raw, dec) => Number(ethers.formatUnits(raw, dec));
function lpValues() { // wallet -> ZNYT value of its LP share across all pools (both sides, at labeled test prices)
  const out = {};
  for (const [pairAddr, st] of Object.entries(S.lp.pairs)) { const info = pairInfo.get(pairAddr), sup = BigInt(st.supply || '0'); if (!info || !sup || !st.r0) continue;
    const poolZ = units(BigInt(st.r0), info.s0.dec) * livePx(info.s0) + units(BigInt(st.r1), info.s1.dec) * livePx(info.s1);
    for (const [a, b] of Object.entries(st.bal)) { const bal = BigInt(b); if (bal > 0n && !systemSet.has(a)) out[a] = (out[a] || 0) + poolZ * Number(bal * 1_000_000n / sup) / 1e6; } }
  return out;
}
function lpHourly(ts) {
  const hour = Math.floor(ts / 3600); if (S.lp.lastHour == null) { S.lp.lastHour = hour; S.lp.prev = lpValues(); return; }
  if (hour <= S.lp.lastHour) return; const c = cfg.categories.lp, cur = lpValues();
  const h0 = S.lp.lastHour; // award the hour [h0, h0+1) using values sampled at its start and now (its end)
  for (const [a, v0] of Object.entries(S.lp.prev)) { const v = Math.min(v0, cur[a] || 0); if (v >= c.minZnyt) earn(a, 'lp', c.pointsPerSqrtZnytHour * Math.sqrt(v), `lp:${h0}:${a}`, h0 * 3600 + 1800); }
  S.lp.lastHour = hour; S.lp.prev = cur;
}

// ---------- indexer ----------
let indexing = false, lastTickErr = null, headBlock = null;
async function indexBlocks() {
  headBlock = parseInt(await rpc('eth_blockNumber', []), 16);
  let from = S.lastBlock == null ? cfg.indexer.startBlock : S.lastBlock + 1;
  delete S.lp.bal; delete S.lp.supply; delete S.lp.rz; // pre-multi-pool state shape
  // pool added to the token list after the indexer passed its deploy block: rebuild its LP balances/reserves (no retro swap points)
  for (const addr of pairInfo.keys()) if (!S.lp.pairs[addr] && S.lastBlock != null) {
    const st = { bal: {}, supply: '0', r0: '0', r1: '0' };
    for (let a = Number(amm.startBlock || cfg.indexer.startBlock); a <= S.lastBlock; a += 5000) {
      const logs = await rpc('eth_getLogs', [{ fromBlock: '0x' + a.toString(16), toBlock: '0x' + Math.min(S.lastBlock, a + 4999).toString(16), address: addr, topics: [[T.sync, T.xfer]] }]);
      for (const l of logs) { const e = pairIface.parseLog(l);
        if (l.topics[0] === T.sync) { st.r0 = e.args.reserve0.toString(); st.r1 = e.args.reserve1.toString(); }
        else { const f = lc(e.args.from), t = lc(e.args.to), v = e.args.value;
          if (f === ethers.ZeroAddress) st.supply = (BigInt(st.supply) + v).toString(); else st.bal[f] = (BigInt(st.bal[f] || 0) - v).toString();
          if (t === ethers.ZeroAddress) st.supply = (BigInt(st.supply) - v).toString(); else st.bal[t] = (BigInt(st.bal[t] || 0) + v).toString(); } } }
    S.lp.pairs[addr] = st; log('backfilled pool', pairInfo.get(addr).id, 'supply', st.supply);
  }
  while (from <= headBlock) {
    const to = Math.min(headBlock, from + 199);
    const blocks = await Promise.all(Array.from({ length: to - from + 1 }, (_, i) => rpc('eth_getBlockByNumber', ['0x' + (from + i).toString(16), true])));
    const addrs = [cfg.indexer.economy, ...[...pairInfo.keys()]];
    const logs = await rpc('eth_getLogs', [{ fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), address: addrs }]);
    const byBlock = new Map(); for (const l of logs) { const n = parseInt(l.blockNumber, 16); if (!byBlock.has(n)) byBlock.set(n, []); byBlock.get(n).push(l); }
    for (const b of blocks) {
      const n = parseInt(b.number, 16), ts = parseInt(b.timestamp, 16); lpHourly(ts);
      // validator: approved validator proposing >=1 block in an hour -> its operator wallet
      const miner = lc(b.miner), op = valOps.get(miner);
      if (op) earn(op, 'validator', cfg.categories.validator.pointsPerHourProposing, `val:${Math.floor(ts / 3600)}:${miner}`, ts);
      let receipts = null; if (b.transactions.length) receipts = await rpc('eth_getBlockReceipts', ['0x' + n.toString(16)]);
      const rmap = new Map((receipts || []).map((r) => [r.transactionHash, r]));
      const txFrom = new Map();
      for (const tx of b.transactions) {
        const from_ = lc(tx.from), to_ = lc(tx.to), val = BigInt(tx.value), ok = rmap.get(tx.hash)?.status === '0x1'; txFrom.set(tx.hash, from_);
        for (const a of [from_, to_]) if (a && isAddr(a)) { const w = W(a); if (w.firstSeen == null) w.firstSeen = ts; }
        if (!ok) continue;
        if (to_ && val > 0n && isAddr(to_) && !W(to_).fundedBy && from_ !== to_) W(to_).fundedBy = from_; // first funding source (cluster evidence)
        if (from_ && from_ !== to_) botEv(from_, 't', ts, toZ(val));
        // activity age: funds from an established (or operator, non-faucet) wallet mark the receiver established
        if (to_ && val > 0n && !faucetSet.has(from_) && (systemSet.has(from_) || teamSet.has(from_) || (S.wallets[from_]?.firstSeen != null && ts - S.wallets[from_].firstSeen >= (cfg.antiSybil.faucetOnlyUntilDays ?? 3) * 86400))) W(to_).established = true;
        const c = cfg.categories.tx, plain = !tx.input || tx.input === '0x';
        if (!from_ || systemSet.has(from_) || from_ === to_) continue;
        if (plain && (toZ(val) < c.minTransferZnyt || sameCluster(from_, to_))) continue;
        earn(from_, 'tx', c.pointsPerTx, `tx:${tx.hash}`, ts);
      }
      for (const l of byBlock.get(n) || []) {
        const ref = `${l.transactionHash}:${parseInt(l.logIndex, 16)}`, t0 = l.topics[0], addr = lc(l.address);
        if (addr === lc(cfg.indexer.economy)) {
          if (t0 === T.wc) { const e = econIface.parseLog(l); if (e.args.credits > 0n || e.args.l1Units > 0n || e.args.aiUnits > 0n || e.args.rentalUnits > 0n) earn(e.args.provider, 'node', cfg.categories.node.pointsPerCreditedEpoch, `wc:${e.args.epoch}:${lc(e.args.provider)}`, ts); }
          else if (t0 === T.sub) { const e = econIface.parseLog(l); earn(e.args.payer, 'plan', cfg.categories.plan.pointsPerZnyt * toZ(e.args.amount), `sub:${e.args.paymentId}`, ts); }
        } else if (pairInfo.has(addr)) {
          const e = pairIface.parseLog(l), info = pairInfo.get(addr), st = (S.lp.pairs[addr] ||= { bal: {}, supply: '0', r0: '0', r1: '0' });
          if (t0 === T.sync) { st.r0 = e.args.reserve0.toString(); st.r1 = e.args.reserve1.toString(); }
          else if (t0 === T.xfer) { const f = lc(e.args.from), t = lc(e.args.to), v = e.args.value;
            if (f === ethers.ZeroAddress && t !== ethers.ZeroAddress) botEv(t, 'la', ts); else if (t === addr) botEv(f, 'lr', ts);
            if (f === ethers.ZeroAddress) st.supply = (BigInt(st.supply) + v).toString(); else st.bal[f] = (BigInt(st.bal[f] || 0) - v).toString();
            if (t === ethers.ZeroAddress) st.supply = (BigInt(st.supply) - v).toString(); else st.bal[t] = (BigInt(st.bal[t] || 0) + v).toString(); }
          else if (t0 === T.swap) { const user = txFrom.get(l.transactionHash); if (!user || systemSet.has(user)) continue;
            // swap size in ZNYT: the input side valued at 1 (ZNYT) or its labeled test price
            const in0 = e.args.amount0In > 0n, z = in0 ? units(e.args.amount0In, info.s0.dec) * livePx(info.s0) : units(e.args.amount1In, info.s1.dec) * livePx(info.s1);
            onSwap(user, info.id, in0 ? '0to1' : '1to0', z, ts, `swap:${ref}`); }
        }
      }
      botCheck(ts); S.lastBlock = n; S.lastBlockTs = ts;
    }
    saveState(); from = to + 1;
  }
}
function tail(file, offKey, onLine) {
  if (!existsSync(file)) return; const size = statSync(file).size; if (size < S[offKey]) S[offKey] = 0; if (size === S[offKey]) return;
  const fd = openSync(file, 'r'); const buf = Buffer.alloc(size - S[offKey]); readSync(fd, buf, 0, buf.length, S[offKey]); closeSync(fd);
  const txt = buf.toString('utf8'); const end = txt.lastIndexOf('\n'); if (end < 0) return;
  for (const line of txt.slice(0, end).split('\n')) { if (!line.trim()) continue; try { onLine(JSON.parse(line), line); } catch {} }
  S[offKey] += Buffer.byteLength(txt.slice(0, end + 1));
}
function tailFiles() {
  const c = cfg.categories.planUse;
  tail(cfg.indexer.usageFile, 'usageOffset', (j, line) => { const ts = Math.floor(Date.parse(j.ts) / 1000); const h = createHash('sha256').update(line).digest('hex').slice(0, 16);
    if (j.type === 'ai-chat') earn(j.address, 'planUse', c.pointsPerAiChat, `rcpt:${h}`, ts); else if (j.type === 'vps-start') earn(j.address, 'planUse', c.pointsPerVpsStart, `rcpt:${h}`, ts); });
  // AI learning-gate hook (stub until ai-chat links accepted items to wallets): JSONL {address, itemId, acceptedAt}
  tail(AI_FILE, 'aiOffset', (j) => { if (j.itemId) earn(j.address, 'aiFeedback', cfg.categories.aiFeedback.pointsPerAccepted, `ai:${j.itemId}`, Math.floor(Date.parse(j.acceptedAt || Date.now()) / 1000) || nowSec()); });
}

// ---------- snapshots + on-chain publication ----------
let pub = null;
function publisher() {
  if (pub) return pub; const dir = path.dirname(PUB_KEY); mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!existsSync(PUB_KEY)) { const w = ethers.Wallet.createRandom(); writeFileSync(PUB_KEY, JSON.stringify({ address: w.address, privateKey: w.privateKey, purpose: 'ZERONYTH points snapshot publisher (chain 9127 testnet)' }), { mode: 0o600 }); }
  const k = JSON.parse(readFileSync(PUB_KEY, 'utf8')); pub = new ethers.Wallet(k.privateKey, new ethers.JsonRpcProvider(cfg.indexer.rpc, 9127, { staticNetwork: true })); systemSet.add(lc(pub.address)); return pub;
}
function status(a) { return teamSet.has(a) ? 'team' : systemSet.has(a) ? 'system' : banned.has(a) ? 'banned' : suspended.has(a) ? 'suspended' : held.has(a) ? 'held' : 'eligible'; }
const STATUS_LABEL = { eligible: '対象', team: 'チーム（対象外）', system: '運営アドレス', banned: 'BAN（確定・ポイント没収）', suspended: 'BAN（審査中）', held: '確認待ち（保留）' };
function balancesUpTo(day) {
  const b = new Map(); if (!existsSync(LEDGER)) return b;
  for (const line of readFileSync(LEDGER, 'utf8').split('\n')) { if (!line) continue; const e = JSON.parse(line);
    if (e.type === 'earn' && e.day <= day) b.set(e.addr, (b.get(e.addr) || 0) + e.cp); else if (e.type === 'zero' || (e.type === 'ban' && e.forfeit)) b.set(e.addr, 0); }
  return b;
}
async function snapshot(day, partial = false) {
  const bal = balancesUpTo(day), entries = [], excluded = { team: [], system: [], banned: [], suspended: [], held: [] };
  for (const a of banned.keys()) if (!bal.has(a) && banned.get(a).forfeit) bal.set(a, 0);
  for (const [a, v] of bal) { if (v <= 0 && !banned.get(a)?.forfeit) continue; const s = status(a); if (s === 'eligible') entries.push({ address: ethers.getAddress(a), centipoints: v }); else excluded[s].push({ address: ethers.getAddress(a), centipoints: v, ...(s === 'banned' ? { reason: banned.get(a).reason, ...(banned.get(a).forfeit ? { forfeited: true } : {}) } : s === 'suspended' ? { reason: suspended.get(a).reason } : s === 'held' ? { reason: held.get(a).reason } : {}) }); }
  entries.sort((x, y) => y.centipoints - x.centipoints || (x.address < y.address ? -1 : 1));
  // outlier flags (flag-only): z-score of that day's earnings
  const dayTot = new Map(); for (const [k, v] of daily) { const [d, a] = k.split('|'); if (d === day && status(a) === 'eligible') dayTot.set(a, (dayTot.get(a) || 0) + v); }
  if (dayTot.size >= (cfg.antiSybil.outlierMinWallets ?? 10)) { const xs = [...dayTot.values()], m = xs.reduce((s, x) => s + x, 0) / xs.length, sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length) || 1;
    for (const [a, v] of dayTot) if ((v - m) / sd > (cfg.antiSybil.outlierZ ?? 4) && !(flags.get(a) || []).some((f) => f.reason === `outlier:${day}`)) append({ type: 'flag', addr: a, reason: `outlier:${day}` }); }
  const tree = merkle.build(entries.map((e) => merkle.leafOf(e.address, e.centipoints)));
  const snap = { format: 'zeronyth-points-snapshot/v1', chainId: 9127, day, partial, createdAt: new Date().toISOString(), unit: 'centipoints (1 point = 100)',
    leaf: 'keccak256(abi.encodePacked(address, uint256 centipoints)); sorted-pair keccak tree (OpenZeppelin MerkleProof compatible)',
    merkleRoot: tree.root, ledgerHead: head, configSha256: cfgHash, eligibleCount: entries.length, totalCentipoints: entries.reduce((s, e) => s + e.centipoints, 0),
    entries, excluded, disclaimer: 'Testnet points. For testing only; no monetary value. Bots/automated farming are banned and forfeit points.' };
  const name = partial ? `${day}-partial-${Date.now()}` : day; const body = JSON.stringify(snap, null, 1);
  writeFileSync(path.join(SNAP, name + '.json'), body); const fileSha = createHash('sha256').update(body).digest('hex');
  const rec = { name, day, partial, merkleRoot: tree.root, ledgerSeq: head.seq, fileSha256: fileSha, eligibleCount: entries.length, createdAt: snap.createdAt, tx: null };
  try { const w = publisher(); const data = ethers.hexlify(ethers.toUtf8Bytes(`ZNYT-POINTS v1 day=${day}${partial ? ' partial' : ''} root=${tree.root} ledger=${head.seq}:${head.hash} file=sha256:${fileSha}`));
    const tx = await w.sendTransaction({ to: w.address, value: 0n, data, gasLimit: 80_000n, gasPrice: 1_000_000_000n, type: 0, chainId: 9127 }); rec.tx = tx.hash;
    tx.wait(1, 120_000).then((r) => { rec.block = r.blockNumber; rec.status = r.status; saveState(); }).catch((e) => { rec.publishError = String(e.message).slice(0, 200); saveState(); });
  } catch (e) { rec.publishError = String(e.shortMessage || e.message).slice(0, 200); log('publish failed', rec.publishError); }
  S.snapshots.push(rec); if (!partial) S.lastSnapDay = day; saveState(); log('snapshot', name, tree.root, rec.tx || rec.publishError); return rec;
}
async function maybeDailySnapshot() {
  const today = dayOf(nowSec()); const prev = new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  if (prev < cfg.programStart || S.lastSnapDay >= prev) return;
  if ((S.lastBlockTs || 0) < dayEndSec(prev) + 120 || nowSec() < dayEndSec(prev) + 600) return; // indexer past the day end, LP hour closed
  await snapshot(prev);
}

async function tick() {
  if (indexing) return; indexing = true;
  try { loadConfig(); await indexBlocks(); tailFiles(); saveState(); await maybeDailySnapshot(); lastTickErr = null; }
  catch (e) { lastTickErr = String(e.message).slice(0, 300); log('tick error', lastTickErr); }
  finally { indexing = false; }
}

// ---------- API ----------
const authCache = new Map();
async function whoami(req) {
  const h = String(req.headers.authorization || ''); if (!/^Bearer [A-Za-z0-9._~+/=-]{16,512}$/.test(h)) return null;
  const c = authCache.get(h); if (c && c.exp > Date.now()) return c.addr;
  const r = await fetch(`${cfg.indexer.accessUrl}/me`, { headers: { authorization: h, ...(/^[0-9a-fA-F:.]{3,45}$/.test(String(req.headers['x-zeronyth-client-ip'] || '')) ? { 'x-zeronyth-client-ip': String(req.headers['x-zeronyth-client-ip']) } : {}) }, signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!r || !r.ok) return null; const j = await r.json().catch(() => ({})); if (!isAddr(j.address)) return null;
  const addr = lc(j.address); authCache.set(h, { addr, exp: Date.now() + 60_000 }); if (authCache.size > 5000) authCache.delete(authCache.keys().next().value); return addr;
}
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
function ranking() { return [...totals.entries()].map(([a, t]) => [a, Object.values(t).reduce((s, v) => s + v, 0)]).filter(([a, v]) => v > 0 && status(a) === 'eligible').sort((x, y) => y[1] - x[1]); }
let rankCache = { at: 0, list: [] }; const ranked = () => { if (Date.now() - rankCache.at > 15000) rankCache = { at: Date.now(), list: ranking() }; return rankCache.list; };
function rules() {
  const cats = Object.fromEntries(Object.entries(cfg.categories).map(([k, v]) => [k, v]));
  return { categories: cats, ordering: { validator: cfg.categories.validator.dailyCap, node: cfg.categories.node.dailyCap, othersCombined: cfg._others, text: cfg.ordering?.text },
    antiSybil: { maxNewWalletsPerIpPerDay: cfg.antiSybil.maxNewWalletsPerIpPerDay, faucetOnlyFactor: cfg.antiSybil.faucetOnlyFactor, faucetOnlyUntilDays: cfg.antiSybil.faucetOnlyUntilDays },
    antiBot: cfg.antiBot, programStart: cfg.programStart, day: dayOf(nowSec()), dayTimezone: `UTC+${cfg.dayUtcOffsetHours}`, configSha256: cfgHash,
    amm: amm && { chainId: 9127, label: amm.label, wznyt: amm.wznyt, tokens: amm.tokens, pools: (amm.pools || []).map((p) => ({ id: p.id, kind: p.kind, a: p.a, b: p.b, pair: p.pair, router: p.router, token0: p.token0, token1: p.token1, note: p.note })), znytUsdTest: amm.znytUsdTest || 10, prices: (() => { livePx({ tracked: true, sym: '' }); return pxCache.tokens; })() }, publisher: pub?.address || null };
}
function me(addr) {
  const t = totals.get(addr) || {}, day = dayOf(nowSec()), list = ranked(), idx = list.findIndex(([a]) => a === addr);
  const today = Object.fromEntries(Object.entries(cfg.categories).map(([k, c]) => [k, { earned: (daily.get(`${day}|${addr}|${k}`) || 0) / 100, cap: c.dailyCap }]));
  const w = S.wallets[addr] || {};
  const sp = suspended.get(addr), bn = banned.get(addr);
  return { address: ethers.getAddress(addr), status: status(addr), statusLabel: STATUS_LABEL[status(addr)], reason: bn?.reason || sp?.reason || held.get(addr)?.reason || null, flags: (flags.get(addr) || []).length,
    ban: bn ? { since: bn.ts, permanent: bn.perm, forfeited: bn.forfeit } : sp ? { since: sp.ts, permanent: false, underReview: true, evidence: sp.signals.map((x) => x.detail) } : null,
    total: Object.values(t).reduce((s, v) => s + v, 0) / 100, breakdown: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v / 100])), today, day,
    rank: idx >= 0 ? idx + 1 : null, participants: list.length, factor: factorFor(addr, nowSec()), checkedInToday: refs.has(`ci:${day}:${addr}`) };
}
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((ok) => { let s = ''; req.on('data', (d) => { s += d; if (s.length > 8192) req.destroy(); }).on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { ok({}); } }); });
const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const proxied = (req) => req.headers['x-zeronyth-client-ip'] !== undefined;
const adminOk = (req) => { const t = Buffer.from(String(req.headers['x-points-admin'] || '')), k = Buffer.from(ADMIN_TOKEN); return isLoopback(req) && !proxied(req) && t.length === k.length && timingSafeEqual(t, k); };

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x'), p = u.pathname, clientIp = String(req.headers['x-zeronyth-client-ip'] || '');
    if (!isLoopback(req)) return json(res, 403, { error: 'loopback only' });
    if (p === '/health') return json(res, 200, { ok: !lastTickErr, lastBlock: S.lastBlock, head: headBlock, ledgerSeq: head.seq, wallets: totals.size, lastSnapshot: S.snapshots.at(-1) || null, error: lastTickErr });
    if (p === '/rules') return json(res, 200, rules());
    if (p === '/leaderboard') { const n = Math.min(Math.max(Number(u.searchParams.get('n')) || cfg.leaderboardTopN, 1), cfg.leaderboardTopN);
      return json(res, 200, { day: dayOf(nowSec()), participants: ranked().length, top: ranked().slice(0, n).map(([a, v], i) => ({ rank: i + 1, address: short(ethers.getAddress(a)), points: v / 100 })), note: 'チーム・運営アドレス、BAN（審査中を含む）・保留中のウォレットは除外' }); }
    if (p === '/me' || (p === '/checkin' && req.method === 'POST')) {
      const addr = await whoami(req); if (!addr) return json(res, 401, { error: 'ログインが必要です（ウォレット署名でログインしてください）' });
      if (clientIp) seen(addr, clientIp, p);
      if (p === '/checkin') { const day = dayOf(nowSec()); const got = earn(addr, 'checkin', cfg.categories.checkin.points, `ci:${day}:${addr}`, nowSec()); saveState(); rankCache.at = 0; return json(res, 200, { ok: true, earned: got / 100, me: me(addr) }); }
      return json(res, 200, me(addr));
    }
    if (p === '/snapshots') return json(res, 200, { snapshots: S.snapshots.slice(-60).reverse() });
    if (p === '/snapshot' || p === '/proof') { const name = String(u.searchParams.get('day') || ''); if (!/^\d{4}-\d{2}-\d{2}(-partial-\d+)?$/.test(name)) return json(res, 400, { error: 'day=YYYY-MM-DD' });
      const f = path.join(SNAP, name + '.json'); if (!existsSync(f)) return json(res, 404, { error: 'no snapshot' });
      if (p === '/snapshot') { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' }); return res.end(readFileSync(f)); }
      const a = String(u.searchParams.get('address') || ''); if (!isAddr(a)) return json(res, 400, { error: 'address' });
      const s = JSON.parse(readFileSync(f, 'utf8')); const e = s.entries.find((x) => lc(x.address) === lc(a)); if (!e) return json(res, 404, { error: 'not in snapshot' });
      const tree = merkle.build(s.entries.map((x) => merkle.leafOf(x.address, x.centipoints))); const leaf = merkle.leafOf(e.address, e.centipoints);
      return json(res, 200, { day: name, root: s.merkleRoot, address: e.address, centipoints: e.centipoints, leaf, proof: merkle.proof(tree, leaf) }); }
    if (p === '/internal/seen' && req.method === 'POST') { if (proxied(req)) return json(res, 404, { error: 'not found' }); const b = await readBody(req); seen(b.address, b.ip, b.src); return json(res, 200, { ok: true }); }
    if (p.startsWith('/admin/')) {
      if (!adminOk(req)) return json(res, 404, { error: 'not found' });
      const b = req.method === 'POST' ? await readBody(req) : {}; const a = lc(b.address); const need = () => { if (!isAddr(a)) throw Object.assign(new Error('address required'), { code: 400 }); if (!String(b.reason || '').trim()) throw Object.assign(new Error('reason required'), { code: 400 }); };
      const r = (e) => { rankCache.at = 0; saveState(); return json(res, 200, { ok: true, entry: e }); };
      switch (p) {
        case '/admin/grant': { need(); const pts = Number(b.points); if (!(pts > 0 && pts <= 10000)) return json(res, 400, { error: 'points 0..10000' });
          return r(append({ type: 'earn', day: dayOf(nowSec()), addr: a, cat: 'admin', cp: cp(pts), ref: `adm:${Date.now()}:${a}`, reason: String(b.reason).slice(0, 300), by: 'admin-cli' })); }
        case '/admin/ban': need(); return r(append({ type: 'ban', addr: a, reason: String(b.reason).slice(0, 300) }));
        case '/admin/unban': need(); return r(append({ type: 'unban', addr: a, reason: String(b.reason).slice(0, 300) }));
        case '/admin/zero': need(); return r(append({ type: 'zero', addr: a, reason: String(b.reason).slice(0, 300) }));
        case '/admin/hold': need(); return r(append({ type: 'hold', addr: a, reason: String(b.reason).slice(0, 300) }));
        case '/admin/clear': need(); return r(append({ type: 'clear', addr: a, reason: String(b.reason).slice(0, 300) }));
        case '/admin/flags': return json(res, 200, { held: Object.fromEntries(held), suspended: Object.fromEntries(suspended), banned: Object.fromEntries(banned), flags: Object.fromEntries(flags) });
        case '/admin/bot-flags': { const now = S.lastBlockTs || nowSec(); const live = Object.keys(S.bot).filter((x) => !botExcluded(x)).map((x) => ({ address: x, status: status(x), ...botScore(x, now) })).filter((x) => x.score > 0).sort((x, y) => y.score - x.score).slice(0, 100);
          return json(res, 200, { thresholds: { suspendScore: cfg.antiBot?.suspendScore, flagScore: cfg.antiBot?.flagScore }, suspended: Object.fromEntries(suspended), banned: Object.fromEntries(banned),
            botFlags: Object.fromEntries([...flags].map(([x, f]) => [x, f.filter((y) => y.reason?.startsWith('bot:'))]).filter(([, f]) => f.length)), liveScores: live }); }
        case '/admin/bot-score': { if (!isAddr(a)) return json(res, 400, { error: 'address required' }); return json(res, 200, { address: a, status: status(a), excluded: botExcluded(a), ...botScore(a, S.lastBlockTs || nowSec()), recentEvents: (S.bot[a]?.ev || []).slice(-30) }); }
        case '/admin/confirm-ban': { need(); if (botExcluded(a)) return json(res, 400, { error: 'role address (system/team/keeper/deployer) cannot be banned' });
          const ev = suspended.get(a), out = [append({ type: 'ban', addr: a, perm: true, forfeit: true, reason: String(b.reason).slice(0, 300), evidence: ev ? { score: ev.score, signals: ev.signals } : null, by: 'admin-cli' })];
          if (b.cluster) { const linked = [...new Set([...(ev?.linked || []), ...botLinked(a).byFunding, ...botLinked(a).byIp])].filter((x) => isAddr(x) && !botExcluded(x) && !banned.get(x)?.perm);
            for (const x of linked) out.push(append({ type: 'ban', addr: x, perm: true, forfeit: true, clusterOf: a, reason: `cluster-of:${a} ${String(b.reason).slice(0, 200)}`, by: 'admin-cli' })); }
          rankCache.at = 0; saveState(); return json(res, 200, { ok: true, banned: out.map((e) => e.addr), entries: out }); }
        case '/admin/status': return json(res, 200, { head, lastBlock: S.lastBlock, wallets: Object.keys(S.wallets).length, publisher: publisher().address, snapshots: S.snapshots.slice(-10), configSha256: cfgHash });
        case '/admin/wallet': return json(res, 200, { ...me(a), wallet: S.wallets[a] || null });
        case '/admin/snapshot': { await tick(); const day = /^\d{4}-\d{2}-\d{2}$/.test(b.day || '') ? b.day : dayOf(nowSec()); return json(res, 200, await snapshot(day, b.partial !== false && day >= dayOf(nowSec()))); }
        case '/admin/verify': { replayCheck(); return json(res, 200, { ok: true, head }); }
      }
      return json(res, 404, { error: 'unknown admin route' });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) { json(res, e.code === 400 ? 400 : 500, { error: String(e.message).slice(0, 200) }); }
}).listen(PORT, '127.0.0.1', () => log('points service on 127.0.0.1:' + PORT));

function replayCheck() { let prev = ZERO; for (const line of readFileSync(LEDGER, 'utf8').split('\n')) { if (!line) continue; const e = JSON.parse(line);
  const h = ethers.keccak256(ethers.toUtf8Bytes(prev + JSON.stringify({ ...e, prev: undefined, hash: undefined }))); if (e.prev !== prev || e.hash !== h) throw new Error('ledger chain broken at seq ' + e.seq); prev = e.hash; } }

loadConfig(); replay(); publisher(); log('publisher', pub.address);
await tick(); setInterval(tick, (cfg.indexer.tickSeconds || 60) * 1000);
