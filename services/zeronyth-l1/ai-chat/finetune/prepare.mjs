#!/usr/bin/env node
// Builds the LoRA training set: seed-sft.jsonl (hand-written, kb-grounded) + the current learned memory (already
// consent-gated, filtered and eval-gated). Fixed eval questions are excluded so the A/B stays honest.
// Usage: node finetune/prepare.mjs <out.jsonl>   (prints {n, hash})
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../lib/memory.mjs';
import { SYSTEM } from '../lib/prompt.mjs';
import { unsafeReasons, factViolations } from '../lib/safety.mjs';
import { loadCases } from '../eval.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.ZERONYTH_AI_DATA || path.join(here, '..', 'data');
const evalQ = new Set(loadCases().map((c) => c.q.trim()));
const seed = readFileSync(path.join(here, 'seed-sft.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => ({ ...JSON.parse(l), from: 'seed' }));
const learned = openStore(DATA).current().items.map((x) => ({ q: x.q, a: x.a, from: x.from }));
const rows = [...seed, ...learned].filter((x) => !evalQ.has(x.q.trim()) && !unsafeReasons(x.a).length && !factViolations(x.a).length)
  .map((x) => ({ messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: x.q }, { role: 'assistant', content: x.a }], from: x.from }));
const out = process.argv[2] || '/dev/stdout'; const body = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
writeFileSync(out, body, { mode: 0o600 });
console.error(JSON.stringify({ n: rows.length, seed: seed.length, learned: learned.length, hash: createHash('sha256').update(body).digest('hex').slice(0, 12) }));
