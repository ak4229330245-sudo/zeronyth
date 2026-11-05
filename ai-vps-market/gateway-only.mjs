// Site gateway ONLY (no validators/faucet/signal) for the public site, serving a COPY of the dashboard and
// proxying /rpc to the 912701 test net through the production gateway code (same method allow-list + rate limits).
// 912701 layer: services that are still bound to the stopped 9127 chain (bridge, economy, access plans/AI/VPS)
// answer an honest 503 "not connected" instead of stale 9127 data. Points: the 912701 points service (ledger carried
// over 1:1 from 9127, ZERONYTH_POINTS_PORT) and its wallet-signature login (points-auth-912701 on ZERONYTH_ACCESS_PORT,
// only /api/access/auth/challenge, /auth/verify and /me are exposed); /api/points/rules gets the 912701 AMM block.
// [912701 AI/VPS] economy (falcon912701-econ :18801) and access plans/VPS (falcon912701-access :18806) are now connected;
// the ZERYTH HUD endpoints (/api/ai/chat|feedback adapter, /api/p2p/nodes|models|security/pqc[/dual], /api/vps/*) are
// served here from live 912701 backends only (no synthetic telemetry). Bridge stays an honest 503.
import { createGateway } from "/home/solbot/zeronyth-primary/services/zeronyth-l1/scripts/replit-gateway.mjs";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { stat as fsStat } from "node:fs/promises";
import nodePath from "node:path";
if (process.env.ZERONYTH_RPC_PORT === "8545" || process.env.ZERONYTH_RPC_PORT === "9545") throw new Error("refusing 9127 RPC");
const CHAIN_ID = 912701;
const ACCESS_912701 = new Set(["/api/access/auth/challenge", "/api/access/auth/verify", "/api/access/me"]); // points login only
if (process.env.ZERONYTH_POINTS_PORT === "9807" || process.env.ZERONYTH_ACCESS_PORT === "9805") throw new Error("refusing 9127 points/access service");
const ECON_912701_PORT = "18801", ACCESS_PLANS_912701_PORT = "18806", AI_CHAT_PORT = Number(process.env.ZERONYTH_AI_CHAT_PORT || 8803);
process.env.ZERONYTH_ECON_PORT = ECON_912701_PORT; // inner econ proxy (allow-list + limits) now targets the 912701 coordinator
const MANIFEST = "/home/solbot/zeronyth-falcon-912701/deployments/main-amm.json";
const server = createGateway(process.env.SITE_DASHBOARD);
const inner = server.listeners("request").slice();
server.removeAllListeners("request");
const json = (res, code, data) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
const notConnected = (res, svc) => json(res, 503, { connected: false, chainId: CHAIN_ID, service: svc,
  error: `${svc} is not connected to the ZERONYTH Falcon Testnet (chain 912701) yet; the previous chain 9127 is stopped` });
let rulesCache = { at: 0, body: null };
async function rules912701() {
  if (rulesCache.body && Date.now() - rulesCache.at < 30_000) return rulesCache.body;
  const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
  let base = {};
  try { const r = await fetch(`http://127.0.0.1:${process.env.ZERONYTH_POINTS_PORT || 9807}/rules`, { signal: AbortSignal.timeout(4000) }); if (r.ok) base = await r.json(); } catch {}
  const prices = base?.amm?.prices || null; // market reference prices (CoinGecko/peg), chain independent
  const amm = { chainId: CHAIN_ID, label: m.label, wznyt: m.wznyt, tokens: m.tokens, pools: m.pools, znytUsdTest: m.znytUsdTest, prices };
  const body = { ...base, amm, network: { chainId: CHAIN_ID, name: "ZERONYTH Falcon Testnet",
    pointsLedger: "connected — 912701 points service; balances carried over 1:1 by address from the stopped 9127 ledger (ledger seq 400, migrate entry seq 401, from 912701 block 9234)" } };
  rulesCache = { at: Date.now(), body };
  return body;
}
let pqValsCache = { at: 0, quorum: null };
async function pqSummary() {
  const port = process.env.ZERONYTH_PQ_PORT || 18799;
  const c = await fetch(`http://127.0.0.1:${port}/finality/latest`, { signal: AbortSignal.timeout(4000) }).then((r) => { if (!r.ok) throw new Error("pq " + r.status); return r.json(); });
  if (!pqValsCache.quorum || Date.now() - pqValsCache.at > 60_000) {
    const v = await fetch(`http://127.0.0.1:${port}/validators`, { signal: AbortSignal.timeout(4000) }).then((r) => r.json());
    pqValsCache = { at: Date.now(), quorum: Number(v.quorum) || null };
  }
  return { scheme: c.scheme, chainId: c.chainId, height: c.height, blockHash: c.blockHash, timestamp: c.timestamp,
    validatorSetHash: c.validatorSetHash, pqSetHash: c.pqSetHash, signers: Array.isArray(c.signatures) ? c.signatures.length : 0,
    quorum: pqValsCache.quorum, falconSigners: c.falconSigners, summary: true };
}
// ---------- [912701 AI/VPS] ZERYTH HUD adapters ----------
const TRUST_CF = process.env.ZERONYTH_TRUST_CF === "1" || process.env.TRUST_CF === "1";
function clientIp(req) {
  const peer = String(req.socket.remoteAddress || "");
  const cf = String(req.headers["cf-connecting-ip"] || "");
  if (TRUST_CF && /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(peer) && /^[0-9a-fA-F:.]{3,45}$/.test(cf)) return cf;
  return peer;
}
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now(); let b = buckets.get(key);
  if (!b || now - b.t > windowMs) { b = { t: now, n: 0 }; buckets.set(key, b); }
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.t > 120_000) buckets.delete(k);
  return ++b.n > max;
}
function readBody(req, max = 24_576) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > max) { reject(Object.assign(new Error("too large"), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
const getJson = (url, ms = 4000) => fetch(url, { signal: AbortSignal.timeout(ms) }).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
const cached = new Map();
async function cache(key, ms, fn) { const c = cached.get(key); if (c && Date.now() - c.at < ms) return c.v; const v = await fn(); cached.set(key, { at: Date.now(), v }); return v; }
const aiStatus = () => cache("ai", 5000, async () => { const t0 = Date.now(); const s = await getJson(`http://127.0.0.1:${AI_CHAT_PORT}/status`); return { s, latency: Date.now() - t0 }; });
// AI worker PQ authentication: the ai-chat worker signs every response with ML-DSA-65; this gateway
// verifies each signature against the worker's published key before relaying it. The counters below
// are what /api/p2p/security/pqc reports — no key or no verifications means "disabled", never faked.
let aiPq = null;
const aiAuth = { verified: 0, failed: 0, lastVerifiedAt: null };
try {
  const m = await import("file:///home/solbot/zeronyth-falcon-912701/pq-lib/ai-worker-pq.mjs");
  const idf = JSON.parse(readFileSync("/home/solbot/zeronyth-falcon-912701/site/ai-worker-identity.json", "utf8"));
  aiPq = { verifyAttestation: m.verifyAttestation, publicKey: new Uint8Array(Buffer.from(idf.public_key_hex, "hex")), identity: idf };
} catch { aiPq = null; }
const relayAttestation = (e) => { const ok = aiPq ? aiPq.verifyAttestation(e, aiPq.publicKey) : false;
  if (ok) { aiAuth.verified++; aiAuth.lastVerifiedAt = new Date().toISOString(); } else aiAuth.failed++;
  return JSON.stringify({ ...e, verified: ok }) + "\n"; };
const econStatus = () => cache("econ", 10_000, () => getJson(`http://127.0.0.1:${ECON_912701_PORT}/status`));
const vpsPublic = () => cache("vpspub", 10_000, () => getJson(`http://127.0.0.1:${ACCESS_PLANS_912701_PORT}/vps/public`, 8000));
const modelId = (name) => String(name || "model").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

async function hudChat(req, res) {
  if (limited("hudchat:" + clientIp(req), 6, 60_000)) return json(res, 429, { type: "error", error: "rate limited", message: "Too many requests; please wait a minute." });
  let body; try { body = JSON.parse(await readBody(req) || "{}"); } catch (e) { return json(res, e.code === 413 ? 413 : 400, { error: e.code === 413 ? "body too large" : "bad json" }); }
  const legacy = Array.isArray(body.messages);
  let messages;
  if (legacy) messages = body.messages;
  else {
    const msg = typeof body.message === "string" ? body.message.trim() : "";
    if (!msg) return json(res, 400, { error: "message required" });
    const hist = (Array.isArray(body.history) ? body.history : []).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-11).map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
    messages = [...hist, { role: "user", content: msg.slice(0, 2000) }];
  }
  const consent = legacy ? body.consent === true : body.learning_consent === true;
  let up;
  try {
    up = await fetch(`http://127.0.0.1:${AI_CHAT_PORT}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: messages.slice(-12), consent }), signal: AbortSignal.timeout(180_000) });
  } catch { return json(res, 502, { type: "error", error: "AI backend unavailable" }); }
  if (!up.ok || !up.body) { const t = await up.text().catch(() => ""); res.writeHead(up.status || 502, { "Content-Type": up.headers.get("content-type") || "application/json", "Cache-Control": "no-store" }); return res.end(t.slice(0, 4000)); }
  res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
  let closed = false; res.on("close", () => { closed = true; });
  const hb = setInterval(() => { if (!closed) res.write("\n"); }, 15_000); // keep Cloudflare tunnel stream alive while the CPU model loads

  const reader = up.body.getReader(); const dec = new TextDecoder(); let buf = "";
  const emit = (line) => {
    if (legacy) { try { const e = JSON.parse(line); if (e && e.type === "attestation") return res.write(relayAttestation(e)); } catch {} return res.write(line + "\n"); }
    let e; try { e = JSON.parse(line); } catch { return; }
    if (e.type === "meta") res.write(JSON.stringify({ type: "meta", task_id: e.id, model: e.model, worker_id: "zeronyth-ai-chat", memory_version: e.memoryVersion, consent: e.consent, chain_id: CHAIN_ID }) + "\n");
    else if (e.type === "delta" && typeof e.t === "string") res.write(JSON.stringify({ delta: e.t }) + "\n");
    else if (e.type === "queue") res.write(JSON.stringify({ type: "queue", position: e.position }) + "\n");
    else if (e.type === "attestation") res.write(relayAttestation(e));
    else if (e.type === "done") res.write(JSON.stringify({ type: "done", tokens: e.tokens, tok_per_sec: e.tokPerSec }) + "\n");
    else if (e.type === "error") res.write(JSON.stringify({ type: "error", error: e.error || "error", message: e.message || "AI error" }) + "\n");
  };
  try {
    while (!closed) {
      const { value, done } = await reader.read();
      buf += dec.decode(value || new Uint8Array(), { stream: !done });
      const lines = buf.split("\n"); buf = lines.pop() || "";
      for (const l of lines) if (l.trim()) emit(l.trim());
      if (done) { if (buf.trim()) emit(buf.trim()); break; }
    }
  } catch {} finally { clearInterval(hb); reader.cancel().catch(() => {}); res.end(); }
}
async function hudFeedback(req, res) {
  if (limited("hudfb:" + clientIp(req), 30, 60_000)) return json(res, 429, { error: "rate limited" });
  let b; try { b = JSON.parse(await readBody(req, 16_384) || "{}"); } catch { return json(res, 400, { error: "bad json" }); }
  let out;
  if (typeof b.id === "string" && (b.rating === 1 || b.rating === -1)) out = { id: b.id, rating: b.rating, comment: typeof b.comment === "string" ? b.comment.slice(0, 500) : "" };
  else {
    const rating = b.rating === "positive" || b.rating === 1 ? 1 : b.rating === "negative" || b.rating === -1 ? -1 : 0;
    if (typeof b.task_id !== "string" || !rating) return json(res, 400, { error: "task_id and rating (positive|negative) required" });
    out = { id: b.task_id, rating, comment: typeof b.comment === "string" ? b.comment.slice(0, 500) : "" };
  }
  try {
    const r = await fetch(`http://127.0.0.1:${AI_CHAT_PORT}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(out), signal: AbortSignal.timeout(8000) });
    const t = await r.text(); res.writeHead(r.status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); return res.end(t.slice(0, 4000));
  } catch { return json(res, 502, { error: "AI backend unavailable" }); }
}
async function hudNodes() {
  const nodes = []; let throughput = null, latency = null;
  try {
    const { s, latency: l } = await aiStatus();
    latency = l; throughput = Number.isFinite(Number(s.avgTokS)) ? Number(s.avgTokS) : null;
    nodes.push({ id: "zeronyth-ai-chat", name: "ZERONYTH VPS · AI chat", compute: "CPU", model: s.model, status: s.busy ? "busy" : "online",
      jobs: Number.isFinite(Number(s.chats)) ? Number(s.chats) : null, latency_ms: l, speed_tps: throughput, cpu: true, gpu: false, source: "ai-chat /status" });
  } catch {}
  try { const e = await econStatus(); for (const p of (Array.isArray(e.providers) ? e.providers : []).slice(0, 50)) {
    const id = String(p.id || p.address || p.provider || "").slice(0, 14); if (!id) continue;
    nodes.push({ id: "provider-" + id, name: "ZNYT provider", compute: String(p.kind || p.compute || "provider").slice(0, 24), model: "—", status: p.online === false ? "offline" : "online", jobs: Number(p.jobs) || 0, source: "econ coordinator" });
  } } catch {}
  return { nodes, metrics: { throughput_tps: throughput, latency_ms: latency }, chain_id: CHAIN_ID, source: "live 912701 backends" };
}
async function hudModels() {
  const { s } = await aiStatus();
  const L = s.learning || {}; const m = /^(\d+)\/(\d+)$/.exec(String(L.eval?.gate || ""));
  const runs = Number(/^v(\d+)$/.exec(String(L.memoryVersion || ""))?.[1]);
  return { models: [{ id: modelId(s.model), name: s.model, status: s.busy ? "busy" : "serving" }], metrics: { tokens_per_second: Number(s.avgTokS) || null },
    training_runs: Number.isFinite(runs) ? runs : null, training_note: "training_runs = accepted retrieval-memory versions (learner); base model not fine-tuned (promoted=false)",
    evaluation: m ? { score: Math.round((Number(m[1]) / Number(m[2])) * 100), gate: L.eval.gate, at: L.eval.at } : null,
    learning: { memoryVersion: L.memoryVersion, learnedItems: L.learnedItems, lastRun: L.lastRun, lastResult: L.lastResult, reviewQueue: L.reviewQueue }, chain_id: CHAIN_ID };
}
async function pqStats() { return cache("pqstats", 10_000, () => getJson(`http://127.0.0.1:${process.env.ZERONYTH_PQ_PORT || 18799}/stats`)); }
async function pqHealthy() { try { const st = await pqStats(); const c = await pqSummary(); return { ok: Date.now() / 1000 - Number(c.timestamp) < 120 && c.signers >= (c.quorum || 3), st, c }; } catch { return { ok: false }; } }
async function hudPqc() {
  const h = await pqHealthy();
  // Falcon-1024 is enforced for QBFT commit seals on chain 912701. AI-worker authentication is
  // ML-DSA-65: the worker signs every response and this gateway verifies it (live counters below).
  return { schema: "zeryth.pqc.status.v1", algorithm: "Falcon-1024", verification: aiPq ? "enabled" : "disabled", runtime: h.ok ? "ready" : "unavailable", authenticated_workers: aiPq ? 1 : 0,
    implementation: "besu-qbft-falcon1024",
    worker_auth: { algorithm: "ML-DSA-65", worker: aiPq ? aiPq.identity.address : null, verified_total: aiAuth.verified, failed_total: aiAuth.failed, last_verified_at: aiAuth.lastVerifiedAt, identity: "/api/ai/worker-identity" },
    scope_note: "Falcon-1024 secures 912701 validator commit seals (consensus). AI worker responses are signed with ML-DSA-65 and verified by this gateway before relay (see worker_auth). Other off-chain services are not PQ-authenticated.", chain_id: CHAIN_ID };
}
function hudWorkerIdentity() {
  if (!aiPq) return { schema: "zeronyth.ai.worker-identity.v1", error: "worker identity unavailable" };
  return { schema: "zeronyth.ai.worker-identity.v1", algorithm: "ML-DSA-65", address: aiPq.identity.address, public_key_hex: aiPq.identity.public_key_hex,
    domain: "ZERONYTH/AI-WORKER/ATTEST/V1",
    payload: "UTF8(domain + \"\\n\" + JSON.stringify({v:1,id,model,q,a,ts})) with q = keccak256(JSON.stringify(messages)) hex and a = keccak256(answer) hex; the signature is ML-DSA-65 over those bytes and can be verified independently against public_key_hex.",
    attestations_verified: aiAuth.verified, attestations_failed: aiAuth.failed, chain_id: CHAIN_ID };
}
async function hudPqcDual() {
  const h = await pqHealthy();
  return { schema: "zeronyth.pqc.dual-status.v1", chain_id: CHAIN_ID,
    algorithms: { ml_dsa: { scheme: "ML-DSA-65", runtime: h.ok ? "ready" : "unavailable", source: "pq-finality attester" },
      fn_dsa: { scheme: "FN-DSA-1024", runtime: h.ok ? "ready" : "unavailable", note: "Falcon-1024 (pre-FIPS 206) commit seals" } },
    policy: { mode: "monitor", downgrade_protection: false, replay_protection: false, note: "ML-DSA-65 finality certificates are produced and checked off-chain (monitor); consensus itself requires Falcon-1024 seals" },
    domains: { l1_proof: { verification: "monitor" }, ai_workers: { verification: aiPq ? "enabled" : "disabled", algorithm: "ML-DSA-65" }, vps_providers: { verification: "disabled" } },
    latest: h.c ? { height: h.c.height, signers: h.c.signers, quorum: h.c.quorum } : null };
}
// ---------- VPS market (real order flow): PQ-native payment on chain 912701, operator fulfillment ----------
// Customers order with their PQ address and pay the exact payable amount (price + order-seq wei, so each
// order's amount is unique) from that same PQ account as a native PQ tx (0x7E Falcon / 0x7F ML-DSA) to the
// market treasury. A watcher scans new blocks and marks orders paid on a confirmed matching tx; the lease
// then waits for the operator to provision a server off-band and record its access details (tenant
// workloads never run on the validator host). Store: site/vps-market.json (atomic tmp+rename writes).
const VPS_TREASURY = (() => { try { return JSON.parse(readFileSync("/home/solbot/zeronyth-falcon-912701/site/vps-treasury.json", "utf8")); } catch { return null; } })();
const VPS_ADMIN_KEY = (() => { try { return readFileSync("/home/solbot/zeronyth-falcon-912701/net/secrets/vps-admin.key", "utf8").trim(); } catch { return null; } })();
// VPS market admin PQ auth: fulfill/cancel additionally accept an ML-DSA-65 signature from the
// operator key (seed in net/secrets/vps-admin-mldsa.seed, never here; public identity pinned from
// site/vps-admin-identity.json, also published at /vps-admin-identity.json). Payload:
// UTF8("ZERONYTH/VPS-ADMIN/V1" + "\n" + JSON.stringify({action, id, access: access ?? null, ts})),
// ts in unix seconds with a ±300 s window. The legacy admin_key stays as a break-glass fallback;
// admin responses report which method passed ("pq" | "legacy").
const VPS_ADMIN_DOMAIN = "ZERONYTH/VPS-ADMIN/V1";
let vpsAdminPq = null;
try {
  const m = await import("file:///home/solbot/zeronyth-falcon-912701/pq-lib/pq-noble.mjs");
  const idf = JSON.parse(readFileSync("/home/solbot/zeronyth-falcon-912701/site/vps-admin-identity.json", "utf8"));
  vpsAdminPq = { ml_dsa65: m.ml_dsa65, publicKey: new Uint8Array(Buffer.from(idf.public_key_hex, "hex")), identity: idf };
} catch { vpsAdminPq = null; }
function vpsAdminPqVerify(body, action) {
  if (!vpsAdminPq) return false;
  try {
    const ts = Number(body.ts);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
    const sig = Buffer.from(String(body.signature || ""), "hex");
    if (sig.length !== 3309) return false;
    const payload = new TextEncoder().encode(VPS_ADMIN_DOMAIN + "\n" + JSON.stringify({ action, id: body.id, access: body.access ?? null, ts }));
    return vpsAdminPq.ml_dsa65.verify(sig, payload, vpsAdminPq.publicKey) === true;
  } catch { return false; }
}
// VPS access disclosure (security fix, 2026-11-05): lease access details are NEVER returned by
// public endpoints — an order id is sequential and public, so it cannot be a credential. The
// customer retrieves access only by proving control of the ordering PQ address:
// POST /api/vps/order/access {id, ts, publicKey, signature}, payload
// UTF8("ZERONYTH/VPS-ACCESS/V1" + "\n" + JSON.stringify({id, ts})), ts in unix seconds within
// ±300 s. The signer address is derived chain-style (keccak256(publicKey)[12:]) and must equal
// the order's customer. ML-DSA-65 (1952-byte key) verifies via the shared pq-lib bundle;
// Falcon-1024 (1793-byte key) via the vendored @noble/post-quantum 0.7.1 in jsdeps (the build
// the chain accepts). Fail-closed: if the crypto libs fail to load, every request is refused,
// and every refusal is the same generic 403 (no oracle detail).
const VPS_ACCESS_DOMAIN = "ZERONYTH/VPS-ACCESS/V1";
let vpsAccessPq = null;
try {
  const m = await import("file:///home/solbot/zeronyth-falcon-912701/pq-lib/pq-noble.mjs");
  const f = await import("file:///home/solbot/zeronyth-falcon-912701/jsdeps/node_modules/@noble/post-quantum/falcon.js");
  vpsAccessPq = { ml_dsa65: m.ml_dsa65, keccak_256: m.keccak_256, falcon1024: f.falcon1024 };
} catch { vpsAccessPq = null; }
// Store path is overridable only so the module can be fixture-tested against a throwaway store;
// production leaves ZERONYTH_VPS_STORE unset and uses the live path.
const VPS_STORE_PATH = process.env.ZERONYTH_VPS_STORE || "/home/solbot/zeronyth-falcon-912701/site/vps-market.json";
const VPS_OFFERS = [{ id: "ai-vps-starter", name: "AI VPS スターター", price_znyt: 100, period_days: 10,
  specs: "1 vCPU / 1 GB RAM / 20 GB SSD 相当", includes: "ZERONYTH AI チャット プラン（期間中・上限拡大）", fulfillment: "operator" }];
let vpsStore = (() => { try { return JSON.parse(readFileSync(VPS_STORE_PATH, "utf8")); } catch { return { seq: 0, cursor: 0, orders: [], leases: [] }; } })();
function vpsSave() { const tmp = VPS_STORE_PATH + ".tmp"; writeFileSync(tmp, JSON.stringify(vpsStore, null, 2)); renameSync(tmp, VPS_STORE_PATH); }
async function vpsRpc(method, params) { const r = await fetch(ZNY_NODE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10_000) }); const j = await r.json(); if (j.error) throw new Error(j.error.message || "rpc error"); return j.result; }
let vpsWatchBusy = false;
async function vpsWatchTick() {
  if (!VPS_TREASURY || vpsWatchBusy) return; vpsWatchBusy = true;
  try {
    const head = parseInt(await vpsRpc("eth_blockNumber", []), 16);
    if (!vpsStore.cursor) { vpsStore.cursor = head; vpsSave(); return; }
    if (!vpsStore.orders.some((o) => o.status === "awaiting_payment")) { if (vpsStore.cursor !== head) { vpsStore.cursor = head; vpsSave(); } return; }
    let n = vpsStore.cursor, dirty = false;
    while (n < head) {
      n++;
      const blk = await vpsRpc("eth_getBlockByNumber", ["0x" + n.toString(16), true]);
      if (!blk) break;
      for (const tx of blk.transactions || []) {
        if ((tx.type !== "0x7e" && tx.type !== "0x7f") || !tx.to || tx.to.toLowerCase() !== VPS_TREASURY.address) continue;
        const ord = vpsStore.orders.find((o) => o.status === "awaiting_payment" && o.customer === String(tx.from || "").toLowerCase() && BigInt(tx.value) === BigInt(o.payable_wei));
        if (!ord) continue;
        const rc = await vpsRpc("eth_getTransactionReceipt", [tx.hash]);
        if (!rc || rc.status !== "0x1") continue;
        ord.status = "paid"; ord.tx = tx.hash; ord.paid_block = n; ord.paid_at = new Date().toISOString();
        vpsStore.leases.push({ id: ord.id, offer_id: ord.offer_id, customer: ord.customer, status: "provisioning", paid_tx: tx.hash, amount_znyt: ord.price_znyt, period_days: ord.period_days, start: null, end: null, access: null, created_at: ord.paid_at });
        dirty = true;
      }
      vpsStore.cursor = n;
    }
    if (dirty || vpsStore.cursor !== n) vpsSave();
  } catch { /* next tick */ } finally { vpsWatchBusy = false; }
}
setInterval(vpsWatchTick, 15_000).unref();
const vpsPublicOrder = (o) => ({ id: o.id, offer_id: o.offer_id, customer: o.customer, price_znyt: o.price_znyt, payable_wei: o.payable_wei, payable_znyt: Number(BigInt(o.payable_wei) / 10n ** 15n) / 1000, treasury: VPS_TREASURY?.address || null, status: o.status, tx: o.tx || null, created_at: o.created_at, paid_at: o.paid_at || null });
async function hudVpsStatus() {
  const open = vpsStore.orders.filter((o) => o.status === "awaiting_payment").length;
  const active = vpsStore.leases.filter((l) => l.status === "active").length;
  const prov = vpsStore.leases.filter((l) => l.status === "provisioning").length;
  return { schema: "zeronyth.vps.status.v1", chain_id: CHAIN_ID, ready: !!VPS_TREASURY, marketplace_state: "live",
    backend: "operator", provisioning: "manual_operator", treasury: VPS_TREASURY?.address || null,
    payment: "native PQ tx only (Falcon-1024 0x7E / ML-DSA-65 0x7F) on chain 912701",
    offers: VPS_OFFERS.length, orders_open: open, leases_provisioning: prov, leases_active: active,
    note: "Orders are paid with quantum-resistant transactions and detected on-chain automatically. A paid lease is provisioned by the operator off-band (no tenant workloads on the validator host) and activated here with its access details. ZNYT is an experimental token with no monetary value." };
}
async function hudVpsOffers() {
  return { schema: "zeronyth.vps.offers.v1", chain_id: CHAIN_ID, treasury: VPS_TREASURY?.address || null, offers: VPS_OFFERS.map((o) => ({ ...o, payment: "PQ tx (0x7E/0x7F) of the exact payable amount from your PQ address", order: "POST /api/vps/order" })) };
}
async function hudVpsRentals() {
  return { schema: "zeronyth.vps.rentals.v1", chain_id: CHAIN_ID, rentals: vpsStore.leases.slice(-200).map((l) => ({ id: l.id, offer_id: l.offer_id, status: l.status, amount_znyt: l.amount_znyt, period_days: l.period_days, paid_tx: l.paid_tx, start: l.start, end: l.end })) };
}
async function vpsCreateOrder(req, res) {
  if (!VPS_TREASURY) return json(res, 503, { error: "market treasury unavailable" });
  if (limited("vpsorder:" + clientIp(req), 10, 60_000)) return json(res, 429, { error: "rate limited" });
  let body; try { body = JSON.parse(await readBody(req, 4096) || "{}"); } catch { return json(res, 400, { error: "bad json" }); }
  const offer = VPS_OFFERS.find((o) => o.id === body.offer_id);
  if (!offer) return json(res, 400, { error: "unknown offer_id" });
  const customer = String(body.customer || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(customer)) return json(res, 400, { error: "customer must be your PQ address (0x...)" });
  const seq = ++vpsStore.seq;
  const payable = BigInt(offer.price_znyt) * 10n ** 18n + BigInt(seq);
  let head = 0; try { head = parseInt(await vpsRpc("eth_blockNumber", []), 16); } catch {}
  const order = { id: "ZVPS-" + String(seq).padStart(4, "0"), offer_id: offer.id, customer, price_znyt: offer.price_znyt, period_days: offer.period_days, payable_wei: payable.toString(), status: "awaiting_payment", created_at: new Date().toISOString(), from_block: head, tx: null };
  vpsStore.orders.push(order); vpsSave();
  return json(res, 201, { ...vpsPublicOrder(order), instructions: `Pay exactly ${order.payable_wei} wei (${offer.price_znyt} ZNYT + ${seq} wei order tag) from ${customer} to the treasury ${VPS_TREASURY.address} as a native PQ transaction (Falcon 0x7E or ML-DSA 0x7F) on chain 912701. ECDSA payments are not accepted. Payment is detected automatically within about a minute.` });
}
async function vpsGetOrder(req, res) {
  const id = new URL(req.url, "http://x").searchParams.get("id") || "";
  const o = vpsStore.orders.find((x) => x.id === id);
  if (!o) return json(res, 404, { error: "order not found" });
  const lease = vpsStore.leases.find((l) => l.id === id) || null;
  // The public lookup NEVER serializes lease access (security fix, 2026-11-05) — only whether
  // access has been registered. Retrieval is the signed POST /api/vps/order/access below.
  return json(res, 200, { ...vpsPublicOrder(o), lease: lease ? { status: lease.status, start: lease.start, end: lease.end, access_registered: !!lease.access } : null });
}
async function vpsOrderAccess(req, res) {
  const deny = () => json(res, 403, { error: "forbidden" }); // one generic refusal for every failure
  if (limited("vpsaccess:" + clientIp(req), 10, 60_000)) return json(res, 429, { error: "rate limited" });
  if (!vpsAccessPq) return deny();
  let body; try { body = JSON.parse(await readBody(req, 16_384) || "{}"); } catch { return deny(); }
  try {
    const id = String(body.id || "");
    const ts = Number(body.ts);
    if (!id || !Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return deny();
    const hexBytes = (v) => { const s = String(v || "").replace(/^0x/, ""); return s.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(s) ? Buffer.from(s, "hex") : null; };
    const pub = hexBytes(body.publicKey), sig = hexBytes(body.signature);
    if (!pub || !sig) return deny();
    const order = vpsStore.orders.find((x) => x.id === id);
    const lease = order ? vpsStore.leases.find((l) => l.id === id) : null;
    if (!order || !lease || !lease.access) return deny();
    const signer = "0x" + Buffer.from(vpsAccessPq.keccak_256(pub).slice(12)).toString("hex");
    if (signer !== order.customer) return deny();
    const payload = new TextEncoder().encode(VPS_ACCESS_DOMAIN + "\n" + JSON.stringify({ id, ts }));
    let ok = false;
    if (pub.length === 1952) ok = sig.length === 3309 && vpsAccessPq.ml_dsa65.verify(sig, payload, pub) === true;
    else if (pub.length === 1793) ok = vpsAccessPq.falcon1024.verify(sig, payload, pub) === true;
    if (!ok) return deny();
    return json(res, 200, { id, access: lease.access });
  } catch { return deny(); }
}
async function vpsAdmin(req, res, action) {
  let body; try { body = JSON.parse(await readBody(req, 16384) || "{}"); } catch { return json(res, 400, { error: "bad json" }); }
  let auth = null;
  if (body.signature || body.ts) { if (vpsAdminPqVerify(body, action)) auth = "pq"; }
  else if (VPS_ADMIN_KEY && String(body.admin_key || "") === VPS_ADMIN_KEY) auth = "legacy";
  if (!auth) return json(res, 403, { error: (body.signature || body.ts) ? "invalid or expired PQ admin signature" : "forbidden" });
  const lease = vpsStore.leases.find((l) => l.id === body.id);
  if (!lease) return json(res, 404, { error: "lease not found", auth });
  if (action === "fulfill") {
    if (lease.status !== "provisioning") return json(res, 409, { error: "lease is " + lease.status, auth });
    lease.status = "active"; lease.access = String(body.access || "").slice(0, 1000);
    lease.start = new Date().toISOString(); lease.end = new Date(Date.now() + lease.period_days * 86_400_000).toISOString();
  } else { lease.status = "cancelled"; lease.access = null; }
  vpsSave();
  return json(res, 200, { id: lease.id, status: lease.status, start: lease.start, end: lease.end, auth });
}
// ---------- theme song (static audio) ----------
// The inner static handler has no audio MIME type and no Range support (mobile Safari needs 206), so same-origin
// mp3 files under dashboard/assets/audio/ are streamed here: audio/mpeg, strong ETag, single byte ranges, no gzip.
const AUDIO_ROOT = nodePath.join(process.env.SITE_DASHBOARD || "", "assets", "audio");
async function serveAudio(req, res, p) {
  const name = p.slice("/assets/audio/".length);
  if (!/^[a-z0-9][a-z0-9-]{0,63}\.mp3$/.test(name)) return json(res, 404, { error: "Not found" });
  const file = nodePath.join(AUDIO_ROOT, name);
  let info; try { info = await fsStat(file); } catch { return json(res, 404, { error: "Not found" }); }
  if (!info.isFile()) return json(res, 404, { error: "Not found" });
  const size = info.size, etag = `"a-${size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`, lastMod = info.mtime.toUTCString();
  const base = { "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes", ETag: etag, "Last-Modified": lastMod, "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "Strict-Transport-Security": "max-age=15552000" };
  const range = req.headers.range, ifRange = req.headers["if-range"];
  if (!range && req.headers["if-none-match"] === etag) { res.writeHead(304, base); return res.end(); }
  let start = 0, end = size - 1, status = 200;
  const m = range && (!ifRange || ifRange === etag || ifRange === lastMod) ? /^bytes=(\d*)-(\d*)$/.exec(String(range).trim()) : null;
  if (m && (m[1] !== "" || m[2] !== "")) { // unparsable / multi-range: ignore and send the whole file (RFC 9110)
    if (m[1] === "") start = Math.max(0, size - Number(m[2]));
    else { start = Number(m[1]); if (m[2] !== "") end = Math.min(Number(m[2]), size - 1); }
    if (!Number.isSafeInteger(start) || start >= size || start > end || (m[1] === "" && Number(m[2]) === 0)) {
      res.writeHead(416, { ...base, "Content-Range": `bytes */${size}`, "Content-Length": 0 }); return res.end();
    }
    status = 206;
  }
  const headers = { ...base, "Content-Length": end - start + 1 };
  if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  res.writeHead(status, headers);
  if (req.method === "HEAD") return res.end();
  const st = createReadStream(file, { start, end });
  st.on("error", () => res.destroy());
  res.on("close", () => st.destroy());
  st.pipe(res);
}
// ---------- [912701] tasks (quests): /api/tasks/* -> falcon912701-tasks (loopback); /api/tasks/admin* is never exposed ----------
const TASKS_PORT = Number(process.env.ZERONYTH_TASKS_PORT || 18810);
async function proxyTasks(req, res, p) {
  if (req.method !== "GET" && req.method !== "POST") return json(res, 405, { error: "method not allowed" });
  const ip = clientIp(req); if (limited("tasks:" + ip, 90, 60_000)) return json(res, 429, { code: "rate", error: "rate limited" });
  let body; if (req.method === "POST") { try { body = await readBody(req, 8192); } catch { return json(res, 413, { error: "too large" }); } }
  if (p.startsWith("/api/tasks/admin")) return json(res, 404, { error: "not found" });
  const q = String(req.url).includes("?") ? String(req.url).slice(String(req.url).indexOf("?")) : "";
  const h = { "x-zeronyth-client-ip": ip.replace(/^::ffff:/, "") }; if (req.headers.authorization) h.authorization = String(req.headers.authorization).slice(0, 600); if (body !== undefined) h["content-type"] = "application/json";
  try { const r = await fetch(`http://127.0.0.1:${TASKS_PORT}${p.slice("/api/tasks".length)}${q}`, { method: req.method, headers: h, body, signal: AbortSignal.timeout(20_000) });
    res.writeHead(r.status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); return res.end(await r.text());
  } catch { return json(res, 503, { connected: false, error: "tasks service unavailable" }); }
}
const HUD_GET = { "/api/p2p/nodes": hudNodes, "/api/p2p/models": hudModels, "/api/p2p/security/pqc": hudPqc, "/api/p2p/security/pqc/dual": hudPqcDual, "/api/ai/worker-identity": hudWorkerIdentity,
  "/api/vps/status": hudVpsStatus, "/api/vps/offers": hudVpsOffers, "/api/vps/rentals": hudVpsRentals };
// ---------- Quantum Wallet PQ adapter (zny_* -> Besu 912701) ----------
// The Quantum Wallet PWA speaks the experimental protocol "zeronyth-pq-experimental-v1": it
// probes zny_getCapabilities, claims test funds via zny_faucet and submits wallet-signed
// ML-DSA-65 transactions via zny_sendTransaction, expecting its own JSON-canonical hash back.
// Besu speaks none of that, so this adapter answers those methods here: capabilities are
// reported, faucet claims are forwarded to the faucet service (with the real client IP, so
// its limits apply), signed transactions are transcoded into the chain's canonical 0x7F RLP
// form and submitted to the public node, and wallet hashes are mapped to Besu hashes so
// eth_getTransactionReceipt keeps working for the wallet. All other /rpc traffic is replayed
// untouched to the inner gateway.
const ZNY_NODE = "http://127.0.0.1:18605", ZNY_NODE_FALLBACK = "http://127.0.0.1:18601";
const ZNY_FAUCET_URL = "http://127.0.0.1:18797/claim";
const ZNY_MAP_FILE = "/home/solbot/zeronyth-falcon-912701/site/zny-tx-map.json";
const ZNY_PROTOCOL = "zeronyth-pq-experimental-v1";
let znyMap = null;
function znyLoadMap() {
  if (znyMap) return znyMap;
  try { znyMap = JSON.parse(readFileSync(ZNY_MAP_FILE, "utf8")); } catch { znyMap = {}; }
  if (!znyMap || typeof znyMap !== "object" || Array.isArray(znyMap)) znyMap = {};
  return znyMap;
}
function znySaveMap() {
  try {
    const keys = Object.keys(znyMap);
    if (keys.length > 5000) for (const k of keys.slice(0, keys.length - 5000)) delete znyMap[k];
    writeFileSync(ZNY_MAP_FILE + ".tmp", JSON.stringify(znyMap));
    renameSync(ZNY_MAP_FILE + ".tmp", ZNY_MAP_FILE);
  } catch {}
}
// Keccak-256 (original Keccak padding, not SHA3-256) — needed for the wallet's JSON hash.
const ZNY_RC = [0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an, 0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n];
const ZNY_RHO = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
const ZNY_PILN = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];
const ZNY_MASK64 = (1n << 64n) - 1n;
function znyKeccakF(state) {
  const rotl = (x, n) => ((x << BigInt(n)) | (x >> BigInt(64 - n))) & ZNY_MASK64;
  for (let round = 0; round < 24; round++) {
    const c = [];
    for (let x = 0; x < 5; x++) c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) state[x + 5 * y] ^= d;
    }
    let t = state[1];
    for (let i = 0; i < 24; i++) { const j = ZNY_PILN[i]; const tmp = state[j]; state[j] = rotl(t, ZNY_RHO[i]); t = tmp; }
    for (let y = 0; y < 5; y++) {
      const row = state.slice(5 * y, 5 * y + 5);
      for (let x = 0; x < 5; x++) state[5 * y + x] = row[x] ^ (~row[(x + 1) % 5] & row[(x + 2) % 5]);
    }
    state[0] ^= ZNY_RC[round];
  }
}
function znyKeccak256(data) {
  const rate = 136, state = new Array(25).fill(0n);
  const padded = Array.from(data); padded.push(1);
  while (padded.length % rate !== rate - 1) padded.push(0);
  padded.push(0x80);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let j = 7; j >= 0; j--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + j]);
      state[i] ^= lane;
    }
    znyKeccakF(state);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) { let lane = state[i]; for (let j = 0; j < 8; j++) { out[i * 8 + j] = Number(lane & 0xffn); lane >>= 8n; } }
  return out;
}
// RLP helpers (canonical Besu transaction encoding).
function znyBigBytes(v) { if (v === 0n) return Buffer.alloc(0); const h = v.toString(16); return Buffer.from(h.length % 2 ? "0" + h : h, "hex"); }
function znyLenPrefix(len, offset) {
  if (len < 56) return Buffer.from([offset + len]);
  const lb = znyBigBytes(BigInt(len));
  return Buffer.concat([Buffer.from([offset + 55 + lb.length]), lb]);
}
function znyRlpBytes(b) { if (b.length === 1 && b[0] < 0x80) return Buffer.from(b); return Buffer.concat([znyLenPrefix(b.length, 0x80), b]); }
function znyRlpScalar(v) { return znyRlpBytes(znyBigBytes(v)); }
function znyRlpList(items) { const payload = Buffer.concat(items); return Buffer.concat([znyLenPrefix(payload.length, 0xc0), payload]); }
async function znyNodeCall(url, method, params) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10_000) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "node error");
  return j.result;
}
async function znyNode(method, params) {
  try { return await znyNodeCall(ZNY_NODE, method, params); }
  catch { return await znyNodeCall(ZNY_NODE_FALLBACK, method, params); }
}
function znyRpcReply(res, id, result) { res.setHeader("Access-Control-Allow-Origin", "*"); return json(res, 200, { jsonrpc: "2.0", id, result }); }
function znyRpcError(res, id, message) { res.setHeader("Access-Control-Allow-Origin", "*"); return json(res, 200, { jsonrpc: "2.0", id, error: { code: -32000, message } }); }
const ZNY_DEC = /^(0|[1-9][0-9]*)$/;
function znyHexBytes(s, len) {
  if (typeof s !== "string" || !/^0x[0-9a-f]+$/.test(s)) return null;
  const b = Buffer.from(s.slice(2), "hex");
  return b.length === len ? b : null;
}
async function znySendTransaction(req, res, id, a) {
  try {
    if (limited("znytx:" + clientIp(req), 30, 60_000)) return znyRpcError(res, id, "Transaction rate limit exceeded");
    const tx = a && a.tx;
    if (!tx || tx.version !== ZNY_PROTOCOL || tx.chainId !== CHAIN_ID) throw new Error("Unsupported PQ transaction");
    for (const k of ["nonce", "gasPrice", "gasLimit", "value"]) if (typeof tx[k] !== "string" || !ZNY_DEC.test(tx[k])) throw new Error("Invalid transaction field: " + k);
    if (typeof tx.to !== "string" || !/^0x[0-9a-f]{40}$/.test(tx.to)) throw new Error("Invalid recipient");
    if (typeof tx.data !== "string" || !/^0x([0-9a-f]{2})*$/.test(tx.data)) throw new Error("Invalid data");
    const publicKey = znyHexBytes(a.publicKey, 1952), signature = znyHexBytes(a.signature, 3309);
    if (!publicKey || !signature) throw new Error("Invalid public key or signature");
    const raw = Buffer.concat([Buffer.from([0x7f]), znyRlpList([
      znyRlpScalar(BigInt(tx.nonce)), znyRlpScalar(BigInt(tx.gasPrice)), znyRlpScalar(BigInt(tx.gasLimit)),
      znyRlpBytes(Buffer.from(tx.to.slice(2), "hex")), znyRlpScalar(BigInt(tx.value)),
      znyRlpBytes(Buffer.from(tx.data.slice(2), "hex")), znyRlpScalar(BigInt(tx.chainId)),
      znyRlpBytes(publicKey), znyRlpBytes(signature),
    ])]);
    const canonicalTx = { version: tx.version, chainId: tx.chainId, nonce: tx.nonce, to: tx.to, value: tx.value, gasLimit: tx.gasLimit, gasPrice: tx.gasPrice, data: tx.data };
    const walletHash = "0x" + znyKeccak256(Buffer.from(JSON.stringify({ tx: canonicalTx, publicKey: a.publicKey, signature: a.signature }), "utf8")).toString("hex");
    const besuHash = await znyNode("eth_sendRawTransaction", ["0x" + raw.toString("hex")]);
    const map = znyLoadMap(); map[walletHash] = besuHash; znySaveMap();
    return znyRpcReply(res, id, walletHash);
  } catch (e) { return znyRpcError(res, id, String((e && e.message) || e)); }
}
async function znyInterceptRpc(req, res) {
  let text = "";
  try { text = await readBody(req, 1_048_576); } catch { return json(res, 413, { error: "body too large" }); }
  const replay = () => {
    const r = new Readable({ read() {} });
    r.push(Buffer.from(text, "utf8")); r.push(null);
    r.method = req.method; r.url = req.url; r.headers = req.headers; r.socket = req.socket; r.connection = req.connection; r.httpVersion = req.httpVersion;
    for (const l of inner) l.call(server, r, res);
  };
  try {
    let payload = null;
    try { payload = JSON.parse(text || ""); } catch {}
    if (!payload || Array.isArray(payload) || typeof payload.method !== "string") return replay();
    const id = "id" in payload ? payload.id : null;
    if (payload.method === "zny_getCapabilities") {
      return znyRpcReply(res, id, { protocol: ZNY_PROTOCOL, algorithm: "ML-DSA-65", experimental: true, chainId: CHAIN_ID });
    }
    if (payload.method === "zny_faucet") {
      const address = Array.isArray(payload.params) ? payload.params[0] : null;
      if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) return znyRpcError(res, id, "Invalid address");
      try {
        const r = await fetch(ZNY_FAUCET_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-zeronyth-client-ip": clientIp(req).replace(/^::ffff:/, "") }, body: JSON.stringify({ address }), signal: AbortSignal.timeout(30_000) });
        const j = await r.json().catch(() => ({}));
        if (!j.ok) return znyRpcError(res, id, j.error || j.message || "Faucet refused");
        return znyRpcReply(res, id, j.txHash);
      } catch { return znyRpcError(res, id, "Faucet unavailable"); }
    }
    if (payload.method === "zny_sendTransaction") {
      return await znySendTransaction(req, res, id, Array.isArray(payload.params) ? payload.params[0] : null);
    }
    if (payload.method === "eth_getTransactionReceipt" && Array.isArray(payload.params) && typeof payload.params[0] === "string") {
      const mapped = znyLoadMap()[payload.params[0].toLowerCase()];
      if (mapped) {
        const receipt = await znyNode("eth_getTransactionReceipt", [mapped]);
        if (receipt) receipt.transactionHash = payload.params[0].toLowerCase();
        return znyRpcReply(res, id, receipt);
      }
    }
    return replay();
  } catch (e) {
    if (!res.headersSent) return znyRpcError(res, null, String((e && e.message) || e));
    return res.end();
  }
}
server.on("request", async (req, res) => {
  let p = "/";
  try { p = new URL(req.url, "http://localhost").pathname; } catch {}
  try {
    // Public downloads (large files streamed from disk, never cached in memory; Range supported).
    const DL = { "/downloads/besu-912701-pq.tar.gz": "application/gzip", "/downloads/besu-912701-pq.tar.gz.sha256": "text/plain; charset=utf-8" };
    if (DL[p] && (req.method === "GET" || req.method === "HEAD")) {
      const file = "/home/solbot/zeronyth-falcon-912701/downloads" + p.slice("/downloads".length);
      try {
        const st = await fsStat(file);
        const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
        let start = 0, end = st.size - 1, status = 200;
        if (range) {
          start = range[1] === "" ? Math.max(0, st.size - Number(range[2] || 0)) : Number(range[1]);
          end = range[2] === "" || range[1] === "" ? st.size - 1 : Math.min(Number(range[2]), st.size - 1);
          if (start > end || start >= st.size) { res.writeHead(416, { "Content-Range": `bytes */${st.size}` }); return res.end(); }
          status = 206;
        }
        const headers = { "Content-Type": DL[p], "Content-Length": end - start + 1, "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=3600" };
        if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${st.size}`;
        res.writeHead(status, headers);
        if (req.method === "HEAD") return res.end();
        return createReadStream(file, { start, end }).pipe(res);
      } catch { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("not found"); }
    }
    // Quantum Wallet (static PWA under dashboard/quantum-wallet/): the inner gateway 404s directories, so send the bare path to index.html.
    if ((p === "/quantum-wallet" || p === "/quantum-wallet/") && (req.method === "GET" || req.method === "HEAD")) {
      const q = String(req.url).includes("?") ? "&" + String(req.url).slice(String(req.url).indexOf("?") + 1) : "";
      res.writeHead(302, { Location: "/quantum-wallet/index.html?v=9" + q, "Cache-Control": "no-store" }); return res.end();
    }
    if (p.startsWith("/assets/audio/") && (req.method === "GET" || req.method === "HEAD")) return await serveAudio(req, res, p);
    if (p === "/api/pq/finality/latest" && req.method === "GET" && new URL(req.url, "http://localhost").searchParams.get("summary") === "1") {
      try { return json(res, 200, await pqSummary()); } catch { return json(res, 502, { error: "PQ attester unavailable" }); }
    }
    if (p.startsWith("/api/tasks/")) return await proxyTasks(req, res, p);
    if (p === "/api/points/rules" && req.method === "GET") return json(res, 200, await rules912701());
    if (p === "/api/ai/chat" && req.method === "POST") return await hudChat(req, res);
    if (p === "/api/ai/feedback" && req.method === "POST") return await hudFeedback(req, res);
    if (HUD_GET[p] && req.method === "GET") {
      if (limited("hud:" + clientIp(req), 120, 60_000)) return json(res, 429, { error: "rate limited" });
      try { return json(res, 200, await HUD_GET[p]()); } catch { return json(res, 503, { connected: false, chainId: CHAIN_ID, error: "backend unavailable" }); }
    }
    if (p === "/api/vps/pricing") return json(res, 200, { schema: "zeronyth.vps.pricing.v1", chain_id: 912701, mode: "fixed_znyt", payment_token: "ZNYT", offers: VPS_OFFERS.map((o) => ({ id: o.id, price_znyt: o.price_znyt, period_days: o.period_days })), note: "Prices are fixed in ZNYT (experimental token, no monetary value, no USD rate). Payment is by native PQ transaction only." });
    if (p === "/api/vps/order" && req.method === "POST") return await vpsCreateOrder(req, res);
    if (p === "/api/vps/order" && req.method === "GET") return await vpsGetOrder(req, res);
    if (p === "/api/vps/order/access" && req.method === "POST") return await vpsOrderAccess(req, res);
    if (p === "/api/vps/admin/fulfill" && req.method === "POST") return await vpsAdmin(req, res, "fulfill");
    if (p === "/api/vps/admin/cancel" && req.method === "POST") return await vpsAdmin(req, res, "cancel");
    if (p.startsWith("/api/access/") && !ACCESS_912701.has(p)) {
      // plans/accounting/VPS go to falcon912701-access; the inner gateway picks its upstream synchronously, so swap the port only for this call.
      const prev = process.env.ZERONYTH_ACCESS_PORT; process.env.ZERONYTH_ACCESS_PORT = ACCESS_PLANS_912701_PORT;
      try { for (const l of inner) l.call(server, req, res); } finally { process.env.ZERONYTH_ACCESS_PORT = prev; }
      return;
    }
  } catch (e) { if (!res.headersSent) return json(res, 500, { error: "internal" }); return res.end(); }
  if (p === "/rpc" && req.method === "POST") { await znyInterceptRpc(req, res); return; }
  for (const l of inner) l.call(server, req, res);
});
server.listen(Number(process.env.PORT), "127.0.0.1", () => console.log("[SITE-912701] gateway on 127.0.0.1:" + process.env.PORT + " rpc 127.0.0.1:" + process.env.ZERONYTH_RPC_PORT));
