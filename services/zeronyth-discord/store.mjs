// Tiny JSON store (GM streaks, pending reviews). Atomic, debounced writes.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const FILE = process.env.ZERONYTH_DISCORD_DATA || join(dirname(fileURLToPath(import.meta.url)), 'data', 'state.json');
let state = { gm: {}, reviews: {} };
try { state = { ...state, ...JSON.parse(readFileSync(FILE, 'utf8')) }; } catch {}
let timer = null;
export function save() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE + '.tmp', JSON.stringify(state)); renameSync(FILE + '.tmp', FILE); }
    catch (e) { console.log('[store] save failed', String(e?.message || e)); }
  }, 2000);
}
export function flush() { if (timer) { clearTimeout(timer); timer = null; } try { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE + '.tmp', JSON.stringify(state)); renameSync(FILE + '.tmp', FILE); } catch {} }
export default state;
