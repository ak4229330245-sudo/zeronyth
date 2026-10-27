#!/usr/bin/env node
// Learning loop v1 (OFFLINE). Builds datasets from OPT-IN chat logs + ratings. Does not train anything.
//   node build-dataset.mjs [--data ./data] [--out ./datasets/<date>]
// Outputs:
//   sft.jsonl        conversations rated 👍 (latest rating wins) in chat format {messages:[system?,user,assistant...]} for LoRA/SFT
//   eval.jsonl       questions rated 👎 -> regression set {question, bad_answer, sources}; fix the KB or write a gold answer
//   kb-gaps.md       questions where retrieval found no KB section (candidates for new FAQ entries in kb/)
//   summary.json     counts
// Re-redacts text before writing. Review files by hand before any fine-tune (e.g. unsloth/axolotl LoRA on a GPU machine);
// then re-import the GGUF into Ollama under a NEW model name and A/B it with eval.jsonl before switching ZERONYTH_AI_MODEL.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', process.env.ZERONYTH_AI_DATA || path.join(here, 'data'));
const OUT = arg('--out', path.join(here, 'datasets', new Date().toISOString().slice(0, 10)));
const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);
const redact = (s) => String(s).replace(/\b(0x)?[0-9a-fA-F]{64}\b/g, '[redacted-key]').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted-email]');
const convs = lines(path.join(DATA, 'conversations.jsonl'));
const rating = new Map(); const comments = new Map();
for (const f of lines(path.join(DATA, 'feedback.jsonl'))) { rating.set(f.id, f.rating); if (f.comment) comments.set(f.id, f.comment); }
mkdirSync(OUT, { recursive: true });
const sft = [], evals = [], gaps = [];
for (const c of convs) {
  const q = c.messages.at(-1)?.content || '';
  if (rating.get(c.id) === 1) sft.push({ id: c.id, messages: [...c.messages, { role: 'assistant', content: c.answer }].map((m) => ({ role: m.role, content: redact(m.content) })) });
  if (rating.get(c.id) === -1) evals.push({ id: c.id, question: redact(q), bad_answer: redact(c.answer), sources: c.sources, comment: comments.get(c.id) || '' });
  if (!c.sources?.length) gaps.push(redact(q));
}
writeFileSync(path.join(OUT, 'sft.jsonl'), sft.map((x) => JSON.stringify(x)).join('\n') + (sft.length ? '\n' : ''));
writeFileSync(path.join(OUT, 'eval.jsonl'), evals.map((x) => JSON.stringify(x)).join('\n') + (evals.length ? '\n' : ''));
writeFileSync(path.join(OUT, 'kb-gaps.md'), `# 資料に無かった質問 (${gaps.length})\n\n${[...new Set(gaps)].map((q) => `- ${q.replace(/\n/g, ' ').slice(0, 200)}`).join('\n')}\n`);
const summary = { built: new Date().toISOString(), conversations: convs.length, rated: rating.size, sft: sft.length, eval: evals.length, kbGaps: gaps.length, out: OUT, trained: false };
writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
