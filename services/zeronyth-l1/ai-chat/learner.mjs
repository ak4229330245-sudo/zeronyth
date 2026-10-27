#!/usr/bin/env node
// ZERONYTH continuous learner (testnet). Grows the "learned memory" the chat retrieves from, ONLY from conversations whose
// user ticked「改善に使ってよい」. Run by pm2 every 30 min at nice 19 (deploy/pm2-learning.config.cjs).
//   node learner.mjs run [--dry]          ingest new opted-in conversations + 👍/👎 -> filter -> candidate snapshot -> eval gate -> promote
//   node learner.mjs status               counts, current version, history
//   node learner.mjs rollback [vNNNN]     move the pointer back (default: the version before the current one); newer items stay blocked
//   node learner.mjs queue                review queue (👎 answers = needs-FAQ, repeated unanswered questions)
//   node learner.mjs approve <key> "<answer>"   operator gold answer for a queue item (still goes through filters + gate)
//   node learner.mjs dismiss <key> | forget <itemId>
//   node learner.mjs model-rollback        switch the chat back to the base model (undo a fine-tune promotion)
// Rules: 👍 + consent + safety filters (secrets, prompt injection, abuse, financial advice, asking for keys, foreign links)
// + fact check against canonical ZERONYTH facts + minimum quality + dedupe. New items go live only if the fixed eval set
// does not regress and each new item is retrievable by its own question. Every change is a new immutable snapshot.
import { readFileSync, existsSync, appendFileSync, mkdirSync, openSync, closeSync, unlinkSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKb, terms } from './retrieval.mjs';
import { openStore, indexItems, embed, cosine, writeJsonAtomic, EMBED_MODEL } from './lib/memory.mjs';
import { redact, unsafeReasons, factViolations, qualityReasons, saysDontKnow } from './lib/safety.mjs';
import { evalRetrieval, loadCases } from './eval.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.ZERONYTH_AI_DATA || path.join(here, 'data');
const MAX_NEW_PER_RUN = Number(process.env.ZERONYTH_LEARN_MAX_NEW || 20);
const FEEDBACK_WINDOW_MS = 24 * 3600_000;
const store = openStore(DATA);
const now = () => new Date().toISOString();
const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);
const STATE = store.file('state.json'), QUEUE = store.file('queue.json'), OPERATOR = store.file('operator.json'), STATUS = store.file('status.json'), REJECTED = store.file('rejected.jsonl');
const loadState = () => store.readJson(STATE, { processed: {}, blocked: {}, counted: {}, rejectedTotal: 0, learnedTotal: 0, lastLearned: null });
const bigrams = (s) => new Set(terms(s));
const jaccard = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / Math.max(1, a.size + b.size - i); };
const hid = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);
const schedule = { learner: '30 分ごと（pm2 zeronyth-ai-learner, nice 19）', fineTune: '毎晩 03:30 JST（pm2 zeronyth-ai-finetune, nice 19, メモリ・時間の上限つき）' };
function lock() { const f = store.file('learner.lock'); try { const fd = openSync(f, 'wx'); closeSync(fd); return () => { try { unlinkSync(f); } catch {} }; }
  catch { try { if (Date.now() - statSync(f).mtimeMs > 30 * 60_000) { unlinkSync(f); return lock(); } } catch {} return null; } }
function writeStatus(extra = {}) {
  const st = loadState(); const q = store.readJson(QUEUE, { items: [] }); const snap = store.current(); const prev = store.readJson(STATUS, {});
  const surfaced = q.items.filter((x) => x.kind === 'needs-faq' || x.count >= 2);
  // Public, no personal data: counts, versions, timestamps, eval scores only.
  writeJsonAtomic(STATUS, { ...prev, memoryVersion: snap.version, learnedItems: snap.items.length, learnedTotal: st.learnedTotal, rejectedTotal: st.rejectedTotal,
    lastLearned: st.lastLearned, reviewQueue: surfaced.length, needsFaq: q.items.filter((x) => x.kind === 'needs-faq').length, schedule, ...extra }, 0o644);
}
async function queueAdd(q, kind, convId, badAnswer) {
  const Q = store.readJson(QUEUE, { items: [] }); const b = bigrams(q);
  let emb = null; try { [emb] = await embed([q], 20_000); } catch {}
  let item = Q.items.find((x) => x.kind === kind && (jaccard(bigrams(x.q), b) >= 0.5 || (emb && x.emb && cosine(emb, x.emb) >= 0.92)));
  if (!item) Q.items.push(item = { key: `${kind === 'needs-faq' ? 'F' : 'U'}${hid(q + convId)}`, kind, q: redact(q).slice(0, 300), emb, count: 0, convs: [], first: now() });
  if (!item.convs.includes(convId)) { item.count++; item.convs = [...item.convs, convId].slice(-20); }
  item.last = now(); if (badAnswer) item.badAnswer = redact(badAnswer).slice(0, 500);
  writeJsonAtomic(QUEUE, Q);
}
async function withEmbeddings(items) {
  const need = items.filter((x) => !x.emb);
  if (need.length) { try { const vs = await embed(need.map((x) => x.q), 60_000); need.forEach((x, i) => { x.emb = vs[i]; x.embModel = EMBED_MODEL; }); } catch (e) { console.log(`embeddings unavailable (${e.message}); BM25 only`); } }
  return items;
}
async function run({ dry = false } = {}) {
  const release = lock(); if (!release) { console.log('another learner run is active'); return; }
  try {
    const st = loadState(); const cur = store.current(); const items = cur.items.map((x) => ({ ...x }));
    const convs = lines(path.join(DATA, 'conversations.jsonl'));
    const rating = new Map(); for (const f of lines(path.join(DATA, 'feedback.jsonl'))) rating.set(f.id, f.rating);
    const log = { removed: [], added: [], rejected: [], merged: 0, queued: 0, scanned: 0 };
    // 1) items whose source answer was later 👎, or that keep getting 👎 when used, are removed.
    for (const c of convs) {
      if (st.counted[c.id] || !rating.has(c.id) || !c.learnedIds?.length) continue;
      for (const id of c.learnedIds) { const it = items.find((x) => x.id === id); if (it) { if (rating.get(c.id) > 0) it.up = (it.up || 0) + 1; else it.down = (it.down || 0) + 1; } }
      st.counted[c.id] = 1;
    }
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if ((it.from === 'chat' && rating.get(it.conv) === -1) || ((it.down || 0) >= 2 && (it.down || 0) > (it.up || 0) + (it.support || 1))) { log.removed.push({ id: it.id, why: 'downvoted' }); st.blocked[it.conv || it.id] = 1; items.splice(i, 1); }
    }
    // 2) new conversations (rated, or past the 24 h feedback window).
    const fresh = []; st.uq ||= {};
    for (const c of convs) { // repeated unanswered questions -> review queue (no need to wait for a rating)
      if (st.uq[c.id]) continue; st.uq[c.id] = 1;
      const q = c.messages?.at(-1)?.content || '';
      if (saysDontKnow(c.answer || '') || !(c.sources || []).some((s) => !String(s.file).startsWith('learned:'))) { await queueAdd(q, 'unanswered', c.id); log.queued++; }
    }
    for (const c of convs) {
      if (st.processed[c.id]) continue;
      const age = Date.now() - Date.parse(c.ts); const r = rating.get(c.id);
      if (r === undefined && age < FEEDBACK_WINDOW_MS) continue;
      log.scanned++; st.processed[c.id] = 1;
      const q = c.messages?.at(-1)?.content || ''; const a = c.answer || '';
      if (r === -1) { await queueAdd(q, 'needs-faq', c.id, a); log.queued++; continue; }
      if (r !== 1) continue;
      const reasons = [...new Set([...unsafeReasons(q + '\n' + a), ...factViolations(a), ...factViolations(q), ...qualityReasons(q, a), ...(st.blocked[c.id] ? ['blocked'] : [])])];
      if (reasons.length) { log.rejected.push({ conv: c.id, reasons }); continue; }
      if (fresh.length >= MAX_NEW_PER_RUN) { delete st.processed[c.id]; continue; } // next run
      fresh.push({ id: `L${hid(c.id + q)}`, q: redact(q).trim(), a: redact(a).trim(), from: 'chat', conv: c.id, support: 1, up: 0, down: 0, added: now() });
    }
    // 3) operator-approved answers for review-queue items.
    const op = store.readJson(OPERATOR, { pending: [] });
    for (const p of op.pending.splice(0)) {
      const reasons = [...new Set([...unsafeReasons(p.q + '\n' + p.a), ...factViolations(p.a)])];
      if (reasons.length) { log.rejected.push({ operator: p.key, reasons }); continue; }
      fresh.push({ id: `O${hid(p.key + p.a)}`, q: p.q, a: p.a, from: 'operator', conv: p.key, support: 1, up: 0, down: 0, added: now() });
    }
    // dedupe (same question asked differently): bigram Jaccard >= 0.6 or e5 cosine >= 0.93 -> merge as extra support.
    await withEmbeddings([...items, ...fresh]);
    for (let i = 0; i < fresh.length; i++) {
      const x = fresh[i], b = bigrams(x.q);
      const dup = [...items, ...fresh.slice(0, i)].find((y) => jaccard(bigrams(y.q), b) >= 0.6 || (x.emb && y.emb && cosine(x.emb, y.emb) >= 0.93));
      if (dup) { dup.support = (dup.support || 1) + 1; log.merged++; fresh.splice(i--, 1); }
    }
    for (const r of log.rejected) appendFileSync(REJECTED, JSON.stringify({ ts: now(), ...r }) + '\n', { mode: 0o600 });
    st.rejectedTotal += log.rejected.length;
    if (!fresh.length && !log.removed.length && !log.merged) {
      if (!dry) { writeJsonAtomic(STATE, st); writeJsonAtomic(OPERATOR, op); writeStatus({ lastRun: now(), lastResult: { changed: false, scanned: log.scanned, rejected: log.rejected.length, queued: log.queued } }); }
      console.log(JSON.stringify({ changed: false, ...log })); return;
    }
    // 4) eval gate: fixed set must not regress; each new item must be found by its own question.
    const candidate = await withEmbeddings([...items, ...fresh]);
    const kb = loadKb(path.join(here, 'kb')); const cases = loadCases();
    const before = await evalRetrieval({ kb, index: indexItems(cur.items), cases });
    let after = await evalRetrieval({ kb, index: indexItems(candidate), cases: [...cases, ...fresh.map((x) => ({ id: `self:${x.id}`, q: x.q, ctx: [], learned: [x.id] }))] });
    const notRecalled = after.cases.filter((x) => x.id.startsWith('self:') && !x.pass).map((x) => x.id.slice(5));
    const kept = candidate.filter((x) => !notRecalled.includes(x.id));
    for (const id of notRecalled) log.rejected.push({ item: id, reasons: ['not-retrievable'] });
    after = await evalRetrieval({ kb, index: indexItems(kept), cases });
    const regress = after.cases.filter((x) => !x.pass && before.cases.find((y) => y.id === x.id)?.pass).map((x) => x.id);
    const gate = { pass: after.score >= before.score && !regress.length, before: `${before.score}/${before.total}`, after: `${after.score}/${after.total}`, regress };
    const added = fresh.filter((x) => kept.includes(x)); log.added = added.map((x) => x.id);
    const version = store.nextVersion();
    const snap = { version, created: now(), parent: cur.version, embedModel: EMBED_MODEL, items: kept, eval: gate, change: { added: log.added, removed: log.removed, merged: log.merged } };
    if (dry) { console.log(JSON.stringify({ dry: true, gate, ...log }, null, 1)); return; }
    store.save(snap);
    if (gate.pass && (added.length || log.removed.length || log.merged)) {
      store.promote(version, `learner: +${added.length} -${log.removed.length} merged ${log.merged}`);
      st.learnedTotal += added.length; if (added.length) st.lastLearned = now();
    } else {
      for (const x of added) { st.blocked[x.conv] = 1; appendFileSync(REJECTED, JSON.stringify({ ts: now(), item: x.id, reasons: ['eval-gate'], gate }) + '\n', { mode: 0o600 }); }
      st.rejectedTotal += added.length;
    }
    writeJsonAtomic(STATE, st); writeJsonAtomic(OPERATOR, op);
    writeStatus({ lastRun: now(), lastResult: { changed: true, promoted: gate.pass, version, added: added.length, removed: log.removed.length, rejected: log.rejected.length, queued: log.queued }, eval: { gate: gate.after, at: now() } });
    console.log(JSON.stringify({ version, promoted: gate.pass, gate, ...log }, null, 1));
  } finally { release(); }
}
function rollback(target) {
  const p = store.pointer(); const cur = store.current(); const vs = store.versions();
  if (!target) { const promoted = (p.history || []).map((h) => h.to); const idx = promoted.lastIndexOf(cur.version); target = idx > 0 ? promoted[idx - 1] : 'v0000'; }
  if (!target || (target !== 'v0000' && !vs.includes(target))) throw new Error(`no version to roll back to (have ${vs.join(',') || 'none'})`);
  const tgt = target === 'v0000' ? { items: [] } : store.load(target); const st = loadState();
  for (const it of cur.items) if (!tgt.items.some((x) => x.id === it.id)) st.blocked[it.conv || it.id] = 1;
  for (const it of tgt.items) delete st.blocked[it.conv || it.id]; // restoring a version un-blocks its own items
  writeJsonAtomic(STATE, st);
  if (target === 'v0000') { store.save({ version: store.nextVersion(), created: now(), parent: cur.version, items: [], eval: { pass: true, note: 'empty (rollback)' } }); target = store.versions().at(-1); }
  store.promote(target, `rollback from ${cur.version}`); writeStatus({ lastResult: { rollback: `${cur.version} -> ${target}`, at: now() } });
  console.log(`rolled back ${cur.version} -> ${target} (${tgt.items.length} items); items added after ${target} stay blocked`);
}
const [cmd, a1, a2] = process.argv.slice(2);
if (cmd === 'run') await run({ dry: process.argv.includes('--dry') });
else if (cmd === 'status') { writeStatus(); const p = store.pointer(); console.log(JSON.stringify({ ...store.readJson(STATUS, {}), versions: store.versions(), history: (p.history || []).slice(-10) }, null, 1)); }
else if (cmd === 'rollback') rollback(a1);
else if (cmd === 'queue') { const q = store.readJson(QUEUE, { items: [] }); for (const x of q.items) console.log(`${x.key}\t${x.kind}\tx${x.count}\t${x.q.replace(/\n/g, ' ').slice(0, 100)}`); }
else if (cmd === 'approve') { const q = store.readJson(QUEUE, { items: [] }); const it = q.items.find((x) => x.key === a1); if (!it || !a2) throw new Error('usage: approve <key> "<answer>"');
  const op = store.readJson(OPERATOR, { pending: [] }); op.pending.push({ key: it.key, q: it.q, a: a2.trim() }); writeJsonAtomic(OPERATOR, op);
  q.items = q.items.filter((x) => x !== it); writeJsonAtomic(QUEUE, q); console.log('queued for the next learner run (filters + eval gate apply)'); }
else if (cmd === 'dismiss') { const q = store.readJson(QUEUE, { items: [] }); q.items = q.items.filter((x) => x.key !== a1); writeJsonAtomic(QUEUE, q); writeStatus(); console.log('dismissed'); }
else if (cmd === 'forget') { const cur = store.current(); const it = cur.items.find((x) => x.id === a1); if (!it) throw new Error('no such item');
  const st = loadState(); st.blocked[it.conv || it.id] = 1; writeJsonAtomic(STATE, st);
  const v = store.nextVersion(); store.save({ ...cur, version: v, created: now(), parent: cur.version, items: cur.items.filter((x) => x !== it), change: { removed: [{ id: a1, why: 'operator' }] } });
  store.promote(v, `forget ${a1}`); writeStatus(); console.log(`removed ${a1} -> ${v}`); }
else if (cmd === 'model-rollback') { const f = path.join(DATA, 'model', 'current.json'); mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  const prev = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; writeFileSync(f + '.tmp', JSON.stringify({ model: null, version: 'base', rolledBackFrom: prev?.model || null, at: now() })); 
  (await import('node:fs')).renameSync(f + '.tmp', f); console.log(`chat model -> base (was ${prev?.model || 'base'})`); }
else { console.log('usage: learner.mjs run [--dry] | status | rollback [vNNNN] | queue | approve <key> "<answer>" | dismiss <key> | forget <itemId> | model-rollback'); process.exitCode = 2; }
