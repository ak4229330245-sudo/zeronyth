#!/usr/bin/env node
// Eval for the chat AI. Two levels:
//   retrieval gate (default, fast, no model call): does the context the chat would build contain the required facts,
//     and is every retrieved learned item free of unsafe content / fact contradictions?
//   --llm: generate real answers with Ollama (temperature 0) and check required / forbidden patterns + safety filters.
// Usage: node eval.mjs [--llm] [--model znyt-chat] [--version current|none|v0003] [--cases eval/eval-set.json] [--extra file.json] [--json]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKb } from './retrieval.mjs';
import { buildContext } from './lib/prompt.mjs';
import { openStore, indexItems, embed, OLLAMA } from './lib/memory.mjs';
import { unsafeReasons, factViolations } from './lib/safety.mjs';
import { cleanText } from './lib/clean.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA = process.env.ZERONYTH_AI_DATA || path.join(here, 'data');
export const loadCases = (f = path.join(here, 'eval', 'eval-set.json')) => JSON.parse(readFileSync(f, 'utf8')).cases;
const rx = (s) => new RegExp(s, 'i');
async function qEmbFor(index, q) { if (!index.size) return null; try { return (await embed([q], 8000))[0]; } catch { return null; } }
export async function evalRetrieval({ kb, index, cases }) {
  const out = [];
  for (const c of cases) {
    const qEmb = await qEmbFor(index, c.q);
    const b = buildContext({ kb, learned: index, messages: [{ role: 'user', content: c.q }], qEmb });
    const missing = (c.ctx || []).filter((r) => !rx(r).test(b.system));
    const bad = b.mem.flatMap((m) => [...unsafeReasons(m.q + '\n' + m.a), ...factViolations(m.a)].map((r) => `${m.id}:${r}`));
    const want = (c.learned || []).filter((id) => !b.mem.some((m) => m.id === id));
    out.push({ id: c.id, pass: !missing.length && !bad.length && !want.length, missing, bad, learnedHits: b.mem.map((m) => m.id) });
  }
  return { kind: 'retrieval', score: out.filter((x) => x.pass).length, total: out.length, cases: out };
}
export async function evalLlm({ kb, index, cases, model = 'znyt-chat', numPredict = 260 }) {
  const out = [];
  for (const c of cases) {
    const qEmb = await qEmbFor(index, c.q);
    const b = buildContext({ kb, learned: index, messages: [{ role: 'user', content: c.q }], qEmb });
    const t0 = Date.now(); let answer = '';
    try {
      const r = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(240_000),
        body: JSON.stringify({ model, stream: false, keep_alive: '10m', options: { temperature: 0, seed: 7, num_predict: numPredict }, messages: [{ role: 'system', content: b.system }, { role: 'user', content: c.q }] }) });
      answer = cleanText((await r.json()).message?.content || '');
    } catch (e) { answer = `[error ${e.message}]`; }
    answer = answer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const missing = (c.ans || []).filter((r) => !rx(r).test(answer)), forbidden = (c.not || []).filter((r) => rx(r).test(answer));
    const unsafe = [...unsafeReasons(answer).filter((r) => r !== 'foreign-link'), ...factViolations(answer)];
    out.push({ id: c.id, pass: !missing.length && !forbidden.length && !unsafe.length, missing, forbidden, unsafe, ms: Date.now() - t0, answer: answer.slice(0, 400) });
  }
  return { kind: 'llm', model, score: out.filter((x) => x.pass).length, total: out.length, cases: out };
}
export function indexFor(version) {
  if (version === 'none') return { index: indexItems([]), version: 'none' };
  const store = openStore(DATA); const snap = version === 'current' ? store.current() : store.load(version);
  if (!snap) throw new Error(`unknown version ${version}`);
  return { index: indexItems(snap.items || []), version: snap.version };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const kb = loadKb(path.join(here, 'kb'));
  let cases = loadCases(arg('--cases')); if (arg('--extra')) cases = [...cases, ...JSON.parse(readFileSync(arg('--extra'), 'utf8')).cases];
  if (arg('--only')) cases = cases.filter((c) => arg('--only').split(',').includes(c.id));
  const { index, version } = indexFor(arg('--version', 'current'));
  const res = process.argv.includes('--llm') ? await evalLlm({ kb, index, cases, model: arg('--model', 'znyt-chat') }) : await evalRetrieval({ kb, index, cases });
  res.memoryVersion = version;
  if (process.argv.includes('--json')) console.log(JSON.stringify(res, null, 1));
  else { console.log(`${res.kind}${res.model ? ' ' + res.model : ''} memory=${version}: ${res.score}/${res.total}`); for (const c of res.cases) console.log(` ${c.pass ? 'PASS' : 'FAIL'} ${c.id}${c.pass ? '' : ' ' + JSON.stringify({ ...c, id: undefined, pass: undefined, answer: undefined })}${c.answer ? '\n    → ' + c.answer.replace(/\n/g, ' ').slice(0, 160) : ''}`); }
}
