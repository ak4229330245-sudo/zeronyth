import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOGS, LOCALES } from '../dashboard/assets/i18n.mjs';
const r = (p) => readFileSync(new URL('../dashboard/' + p, import.meta.url), 'utf8');
test('roadmap is linked and keys exist in all locales', () => {
  assert.match(r('index.html'), /href="#roadmap"/);
  assert.match(r('node.html'), /href="index\.html#roadmap"/);
  assert.match(r('index.html'), /id="roadmap"/);
  assert.doesNotMatch(r('index.html'), /data-i18n="road\.[^"]+">x</);
  for (const l of LOCALES) {
    const keys = Object.keys(CATALOGS[l]).filter((k) => k.startsWith('road.'));
    assert.ok(keys.length >= 21, l);
    assert.ok(CATALOGS[l]['nav.roadmap']);
  }
});
test('English roadmap makes no completion claims', () => {
  const t = Object.entries(CATALOGS.en).filter(([k]) => k.startsWith('road.')).map(([, v]) => v).join(' ');
  assert.doesNotMatch(t, /\b\d+(\.\d+)?%|passed successfully|completed successfully/i);
  assert.match(t, /reproducible results/);
  assert.doesNotMatch(t, /only the first exists|none of these tests.*(?:complete|passed)/i);
  assert.match(t, /NOT post-quantum-secure/);
});
