// ZERONYTH chat AI service (loopback only). Ollama backend + retrieval memory over kb/ + opt-in feedback log.
//   POST /chat      {messages:[{role,content}], consent:boolean}  -> NDJSON stream: meta | queue | delta | done | error
//   POST /feedback  {id, rating: 1|-1, comment?}                   -> stored only if that conversation was opted in
//   GET  /status
// Learning: consented conversations + ratings go to data/*.jsonl (no IPs; personal data redacted). learner.mjs (pm2,
// scheduled) filters them into a versioned "learned memory" that is retrieved here next to kb/ once it passes an eval
// gate; finetune/nightly.sh trains LoRA candidates and may promote one via data/model/current.json (A/B gated).
import http from 'node:http';
import { createStreamCleaner, ASKS_AIRDROP, POINTS_ONLY_ANSWER } from './lib/clean.mjs';
import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKb } from './retrieval.mjs';
import { redact, looksSecret } from './lib/safety.mjs';
import { buildContext } from './lib/prompt.mjs';
import { openStore, indexItems, embed, EMBED_MODEL } from './lib/memory.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ZERONYTH_AI_CHAT_PORT || 9803);
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const BASE_MODEL = process.env.ZERONYTH_AI_MODEL || 'znyt-chat';
const BASE_LABEL = process.env.ZERONYTH_AI_MODEL_LABEL || 'Qwen3-4B-Instruct-2507 (Q4_K_M, Apache-2.0)';
const DATA = process.env.ZERONYTH_AI_DATA || path.join(here, 'data');
const MAX_QUEUE = Number(process.env.ZERONYTH_AI_MAX_QUEUE || 6);
const MAX_TOKENS = Number(process.env.ZERONYTH_AI_MAX_TOKENS || 450);
mkdirSync(DATA, { recursive: true, mode: 0o700 });
const kb = loadKb(path.join(here, 'kb'));
// Learned memory + active model are hot-reloaded from pointer files written by learner.mjs / finetune/nightly.sh.
const store = openStore(DATA);
let learned = { snap: null, index: indexItems([]), mtime: -1 };
let model = { name: BASE_MODEL, label: BASE_LABEL, version: 'base', mtime: -1 };
let embedOk = null;
function reloadLearning() {
  try { const m = store.mtime(); if (m !== learned.mtime) { const snap = store.current(); learned = { snap, index: indexItems(snap.items || []), mtime: m }; console.log(`learned memory ${snap.version}: ${snap.items?.length || 0} items`); } } catch (e) { console.error('learned reload failed', e.message); }
  try { const f = path.join(DATA, 'model', 'current.json'); let m = 0; try { m = statSync(f).mtimeMs; } catch {}
    if (m !== model.mtime) { const p = m ? JSON.parse(readFileSync(f, 'utf8')) : null;
      model = p?.model ? { name: p.model, label: p.label || p.model, version: p.version || p.model, mtime: m } : { name: BASE_MODEL, label: BASE_LABEL, version: 'base', mtime: m };
      console.log(`active model ${model.name}`); } } catch (e) { console.error('model pointer reload failed', e.message); }
}
reloadLearning(); setInterval(reloadLearning, 10_000).unref();
const publicLearning = () => { const s = store.readJson(store.file('status.json'), {}); return { memoryVersion: learned.snap?.version || 'v0000', learnedItems: learned.index.size,
  lastLearned: s.lastLearned || null, lastRun: s.lastRun || null, lastResult: s.lastResult || null, reviewQueue: s.reviewQueue ?? 0, needsFaq: s.needsFaq ?? 0,
  rejectedTotal: s.rejectedTotal ?? 0, eval: s.eval || null, embedding: embedOk === false ? 'off (BM25 only)' : `${EMBED_MODEL} + BM25`, modelVersion: model.version,
  fineTune: s.fineTune || null, schedule: s.schedule || null }; };
const consented = new Map(); // id -> ts (memory only; feedback accepted for opted-in ids for 24 h)
const stats = { started: new Date().toISOString(), chats: 0, consented: 0, feedback: 0, rejected: 0, active: 0, queued: 0, avgTokS: 0 };
let running = 0; const waiters = [];
const acquire = (priority = false) => (running < 1 ? (running++, Promise.resolve()) : new Promise((r) => (priority ? waiters.unshift(r) : waiters.push(r))));
// Plan tier (10-day ZNYT AI plan on the box test chain): only the local access service knows this key (file 0600);
// the public gateway never forwards client headers, so visitors cannot claim it.
let TIER_KEY = null;
try { if (process.env.ZERONYTH_AI_TIER_KEY_FILE) TIER_KEY = readFileSync(process.env.ZERONYTH_AI_TIER_KEY_FILE, 'utf8').trim() || null; } catch { TIER_KEY = null; }
const isPlan = (req) => !!TIER_KEY && typeof req.headers['x-znyt-tier-key'] === 'string' && req.headers['x-znyt-tier-key'].length === TIER_KEY.length
  && timingSafeEqual(Buffer.from(req.headers['x-znyt-tier-key']), Buffer.from(TIER_KEY));
const release = () => { const n = waiters.shift(); if (n) n(); else running--; };
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
async function readBody(req, max = 16384) { let size = 0; const parts = []; for await (const c of req) { size += c.length; if (size > max) throw Object.assign(new Error('too large'), { code: 413 }); parts.push(c); } return JSON.parse(Buffer.concat(parts).toString() || '{}'); }
function validMessages(m) {
  if (!Array.isArray(m) || !m.length || m.length > 12) return null;
  const out = []; let total = 0;
  for (const x of m) { if (!x || !['user', 'assistant'].includes(x.role) || typeof x.content !== 'string') return null; const c = x.content.slice(0, 2000); total += c.length; out.push({ role: x.role, content: c }); }
  if (out.at(-1).role !== 'user' || total > 8000) return null;
  return out.slice(-8);
}
async function chat(req, res) {
  let body; try { body = await readBody(req); } catch (e) { return json(res, e.code || 400, { error: e.code === 413 ? 'too large' : 'invalid JSON' }); }
  const messages = validMessages(body.messages); if (!messages) return json(res, 400, { error: 'invalid messages (max 12, 2000 chars each)' });
  const q = messages.at(-1).content;
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  const send = (o) => res.write(JSON.stringify(o) + '\n');
  const id = randomUUID(); const consent = body.consent === true; const plan = isPlan(req); if (plan) stats.planChats = (stats.planChats || 0) + 1;
  if (looksSecret(q)) { send({ type: 'meta', id, sources: [], consent: false }); send({ type: 'delta', t: '⚠️ 秘密鍵やシードフレーズのようなものが含まれています。絶対に誰にも送らないでください（この AI にも）。メッセージは保存していません。' }); send({ type: 'done' }); return res.end(); }
  if (ASKS_AIRDROP.test(q)) { send({ type: 'meta', id, sources: [], consent: false }); send({ type: 'delta', t: POINTS_ONLY_ANSWER }); send({ type: 'done' }); return res.end(); }
  if (running >= 1 && waiters.length >= MAX_QUEUE + (plan ? 2 : 0)) { stats.rejected++; send({ type: 'error', error: 'busy', message: 'いま混み合っています。少し待ってからもう一度どうぞ。' }); return res.end(); }
  let qEmb = null;
  if (learned.index.size) { try { [qEmb] = await embed([q], 1500); embedOk = true; } catch { embedOk = false; } }
  const built = buildContext({ kb, learned: learned.index, messages, qEmb }); const sources = built.sources;
  const MODEL = model.name, MODEL_LABEL = model.label;
  send({ type: 'meta', id, sources, consent, model: MODEL_LABEL, memoryVersion: learned.snap?.version || 'v0000', learnedHits: built.mem.length, tier: plan ? 'plan' : 'free' });
  const ac = new AbortController(); let closed = false;
  res.on('close', () => { closed = true; ac.abort(); });
  if (running >= 1) send({ type: 'queue', position: plan ? 1 : waiters.length + 1 });
  stats.queued++; await acquire(plan); stats.queued--;
  if (closed) return release();
  stats.active = 1; stats.chats++; let answer = '', evalCount = 0, evalNs = 0;
  try {
    const r = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', signal: AbortSignal.any([ac.signal, AbortSignal.timeout(180_000)]), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, stream: true, keep_alive: '30m', options: { num_predict: plan ? MAX_TOKENS * 2 : MAX_TOKENS }, messages: [{ role: 'system', content: built.system }, ...messages] }) });
    if (!r.ok) throw new Error(`backend ${r.status}`);
    let buf = '';
    const cleaner = createStreamCleaner((t) => { answer += t; send({ type: 'delta', t }); });
    for await (const chunk of r.body) {
      buf += Buffer.from(chunk).toString(); let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; const d = JSON.parse(line);
        if (d.message?.content) cleaner.push(d.message.content);
        if (d.done) { evalCount = d.eval_count || 0; evalNs = d.eval_duration || 0; } }
    }
    cleaner.flush();
    const tokS = evalNs ? evalCount / (evalNs / 1e9) : 0; if (tokS) stats.avgTokS = stats.avgTokS ? stats.avgTokS * 0.8 + tokS * 0.2 : tokS;
    send({ type: 'done', tokens: evalCount, tokPerSec: Math.round(tokS * 10) / 10 });
    if (consent && answer) {
      consented.set(id, Date.now()); stats.consented++;
      appendFileSync(path.join(DATA, 'conversations.jsonl'), JSON.stringify({ id, ts: new Date().toISOString(), model: MODEL_LABEL, kbVersion: kb.size, memoryVersion: learned.snap?.version || 'v0000', learnedIds: built.mem.map((m) => m.id), sources, messages: messages.map((m) => ({ role: m.role, content: redact(m.content) })), answer: redact(answer) }) + '\n', { mode: 0o600 });
    }
  } catch (e) { if (!closed) send({ type: 'error', error: 'backend', message: 'AI が応答できませんでした。少し待ってからもう一度どうぞ。' }); }
  finally { stats.active = 0; release(); if (!closed) res.end(); }
}
async function feedback(req, res) {
  let b; try { b = await readBody(req, 4096); } catch { return json(res, 400, { error: 'invalid' }); }
  if (typeof b.id !== 'string' || ![1, -1].includes(b.rating)) return json(res, 400, { error: 'id and rating (1|-1) required' });
  const t = consented.get(b.id); if (!t || Date.now() - t > 86_400_000) return json(res, 200, { stored: false, reason: 'not opted in' });
  stats.feedback++;
  appendFileSync(path.join(DATA, 'feedback.jsonl'), JSON.stringify({ id: b.id, ts: new Date().toISOString(), rating: b.rating, comment: redact(String(b.comment || '').slice(0, 500)) }) + '\n', { mode: 0o600 });
  return json(res, 200, { stored: true });
}
setInterval(() => { const now = Date.now(); for (const [k, t] of consented) if (now - t > 86_400_000) consented.delete(k); }, 600_000).unref();
http.createServer((req, res) => {
  const p = (req.url || '').split('?')[0];
  if (p === '/chat' && req.method === 'POST') return chat(req, res).catch(() => { try { res.end(); } catch {} });
  if (p === '/feedback' && req.method === 'POST') return feedback(req, res);
  if (p === '/status' && req.method === 'GET') return json(res, 200, { model: model.label, runtime: 'Ollama on CPU (box)', kbChunks: kb.size, learning: publicLearning(), maxQueue: MAX_QUEUE, ...stats, avgTokS: Math.round(stats.avgTokS * 10) / 10, busy: running > 0, waiting: waiters.length });
  json(res, 404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => console.log(`zeronyth ai-chat on 127.0.0.1:${PORT}, model ${model.name}, kb ${kb.size} chunks, learned ${learned.index.size}`));
