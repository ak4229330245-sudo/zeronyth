import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dashboard');
const read = (p) => readFileSync(join(root, p), 'utf8');
const langs = ['en', 'ja', 'zh-CN', 'ko'];
const cats = {};
for (const l of langs) cats[l] = (await import(`../dashboard/assets/i18n-${l}.mjs`)).default;
const html = read('research.html');

test('local assets exist and nav links are relative', () => {
  for (const f of ['assets/research-results.json', 'assets/research.css', 'assets/research-ui.mjs', 'assets/zeronyth-technical-summary.md', 'assets/wallet-acceptance-checklist.md']) assert.ok(existsSync(join(root, f)), f);
  assert.match(read('index.html'), /href="research\.html"/);
  assert.match(read('node.html'), /href="research\.html"/);
  assert.match(html, /href="assets\/research-results\.json"/);
  assert.doesNotMatch(html, /style=|<script(?![^>]*src=)|https?:\/\//);
});

test('research keys have 4-language parity and cover the page', () => {
  const keys = Object.keys(cats.en).filter((k) => k.startsWith('research.') || k === 'nav.research' || k === 'meta.title.research');
  assert.ok(keys.length > 80);
  // A single CJK character (e.g. 是 / 否) can be a complete, valid translation.
  for (const l of langs) for (const k of keys) assert.ok(typeof cats[l][k] === 'string' && cats[l][k].trim().length > 0, `${l}:${k}`);
  for (const m of html.matchAll(/data-i18n(?:-attr)?="([^"]+)"/g)) {
    for (const part of m[1].split(';')) { const key = part.includes(':') ? part.split(':')[1] : part; assert.ok(key in cats.en, key); }
  }
  assert.doesNotMatch(html, />\s*(x|-|\?|TODO|placeholder)\s*</i);
});

test('no secret paths or unearned claims', () => {
  const blob = [html, read('assets/zeronyth-technical-summary.md'), read('assets/wallet-acceptance-checklist.md'), read('assets/research-ui.mjs'), ...langs.map((l) => Object.entries(cats[l]).filter(([k]) => k.startsWith('research.')).map(([, v]) => v).join('\n'))].join('\n');
  assert.doesNotMatch(blob, /\/Users\/|\/home\/|[A-Z]:\\|BEGIN [A-Z ]*PRIVATE KEY|0x[0-9a-fA-F]{64}/);
  assert.doesNotMatch(cats.en['research.boundary'], /quantum-safe|guaranteed/i);
  assert.match(cats.en['research.gate.a.b'], /Recorded: no/);
  assert.doesNotMatch(read('assets/wallet-acceptance-checklist.md'), /\|\s*(pass|passed)\s*\|/i);
});

test('research.html has no stray < glyphs and gate label is not blanket "Not performed"', () => {
  assert.doesNotMatch(html, /<</);
  assert.doesNotMatch(html, /[^\s<>"=]<(?![/a-zA-Z!])/);
  for (const l of langs) assert.ok(cats[l]['research.gate.notperformed'] !== cats[l]['research.gate.notimpl']);
  assert.match(cats.en['research.gate.notperformed'], /pending/i);
});
