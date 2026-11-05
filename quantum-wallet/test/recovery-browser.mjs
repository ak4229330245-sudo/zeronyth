// Recovery browser E2E for Quantum Wallet v2 — drives the real UI in a
// headless Chromium (Playwright) against the local Phase 4 test chain.
//
//   UI:  http://127.0.0.1:18080/   (qwallet-v2 dist/)
//   RPC: http://127.0.0.1:18545    (Besu test chain, chainId 912701)
//
// Flow: create with recovery phrase -> record words + addresses ->
// reveal phrase -> export encrypted backup -> wipe -> restore from
// phrase (addresses must be identical) -> send from a restored PQ
// account -> wipe -> import the encrypted backup (identical again).
//
// Run:  PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers node test/recovery-browser.mjs
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(root, '.pw-browsers');
const { chromium } = await import('playwright-core');

const run = promisify(execFile);
const UI_URL = 'http://127.0.0.1:18080/';
const RPC_URL = 'http://127.0.0.1:18545';
const PASSWORD = 'recovery-e2e-pass-01';
const NEW_PASSWORD = 'recovery-e2e-pass-02';
const THIRD_PASSWORD = 'recovery-e2e-pass-03';
const BACKUP_PASSWORD = 'recovery-e2e-backup-01';
const FUND_SH = path.join(root, 'evidence/phase4/fund.sh');
const SHOTS = path.join(root, 'evidence/phase4/shots');
mkdirSync(SHOTS, { recursive: true });

const results = [];
const state = { words: [], addrs: {}, backupText: '' };
function log(...a) {
  console.log(new Date().toISOString(), ...a);
}
async function step(id, title, fn, { dependsOn = [] } = {}) {
  const blocked = dependsOn.filter((d) => {
    const r = results.find((x) => x.id === d);
    return !r || r.status !== 'PASS';
  });
  if (blocked.length) {
    results.push({ id, title, status: 'SKIPPED', detail: `depends on failed step(s): ${blocked.join(', ')}` });
    log(`SKIP ${id} ${title}`);
    return;
  }
  try {
    const detail = await fn();
    results.push({ id, title, status: 'PASS', detail });
    log(`PASS ${id} ${title} — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  } catch (e) {
    results.push({ id, title, status: 'FAIL', detail: String(e?.message || e).slice(0, 600) });
    log(`FAIL ${id} ${title} — ${e?.message || e}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function rpc(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`RPC ${method}: ${j.error.message}`);
  return j.result;
}
async function waitReceipt(hash, timeoutMs = 30000) {
  const t0 = Date.now();
  for (;;) {
    const r = await rpc('eth_getTransactionReceipt', [hash]);
    if (r) return r;
    if (Date.now() - t0 > timeoutMs) throw new Error(`no receipt for ${hash}`);
    await new Promise((r2) => setTimeout(r2, 1000));
  }
}
async function readAccounts(page) {
  const out = {};
  for (const card of await page.locator('.acct').all()) {
    const badge = (await card.locator('.badge').textContent()).trim();
    out[badge] = (await card.locator('.addr').textContent()).trim();
  }
  return out;
}
async function wipeViaUi(page) {
  // From an unlocked session: lock -> unlock screen -> reset -> confirm.
  await page.click('#lock-btn');
  await page.locator('#unlock-pw').waitFor({ state: 'visible' });
  await page.click('button[data-act="reset-open"]');
  await page.locator('button[data-act="reset-confirm"]').waitFor({ state: 'visible' });
  await page.click('button[data-act="reset-confirm"]');
  await page.locator('button[data-act="phrase-begin"]').waitFor({ state: 'visible', timeout: 30000 });
  const vaultVal = await page.evaluate(() => localStorage.getItem('zeronyth-vault-v1'));
  assert(vaultVal === null, 'vault still present after wipe');
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.on('pageerror', (e) => log('PAGEERROR', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') log('CONSOLE-ERROR', m.text().slice(0, 300));
});
const T = 90000;
page.setDefaultTimeout(T);

// --------------------------------------------------------------- r1 create
await step('r1', 'Create wallet via recovery-phrase flow (3 index-0 accounts)', async () => {
  await page.goto(UI_URL, { waitUntil: 'load' });
  await page.locator('button[data-act="phrase-begin"]').waitFor({ state: 'visible' });
  await page.click('button[data-act="phrase-begin"]');
  await page.locator('.word').first().waitFor({ state: 'visible' });
  const words = await page.evaluate(() =>
    [...document.querySelectorAll('.word')].map((el) => el.childNodes[1].textContent.trim()),
  );
  assert(words.length === 24, `expected 24 words, got ${words.length}`);
  assert(words.every((w) => /^[a-z]+$/.test(w)), 'words are lowercase alpha');
  state.words = words;
  await page.screenshot({ path: path.join(SHOTS, 'r1-phrase-grid.png') });
  await page.click('button[data-act="phrase-written"]');
  // Confirmation: fill the 3 requested positions from the recorded words.
  const inputs = await page.locator('input[id^="confirm-word-"]').all();
  assert(inputs.length === 3, `expected 3 confirmation inputs, got ${inputs.length}`);
  for (const input of inputs) {
    const id = await input.getAttribute('id');
    const pos = Number(id.replace('confirm-word-', ''));
    await input.fill(words[pos]);
  }
  await page.click('button[data-act="phrase-confirm-check"]');
  await page.locator('#create-pw').waitFor({ state: 'visible' });
  await page.fill('#create-pw', PASSWORD);
  await page.fill('#create-pw2', PASSWORD);
  await page.click('button[data-act="phrase-create"]');
  await page.locator('.acct').first().waitFor({ state: 'visible', timeout: T });
  const addrs = await readAccounts(page);
  assert(Object.keys(addrs).length === 3, `expected 3 accounts, got ${JSON.stringify(addrs)}`);
  state.addrs = addrs;
  await page.screenshot({ path: path.join(SHOTS, 'r1-created.png') });
  return `ML-DSA ${addrs['ML-DSA-65']}, Falcon ${addrs['Falcon-1024']}, ECDSA ${addrs['ECDSA']}`;
});

// --------------------------------------------------------------- r2 rpc
await step('r2', 'Point RPC at local test chain (912701)', async () => {
  await page.fill('#rpc-url', RPC_URL);
  await page.click('button[data-act="save-rpc"]');
  await page.waitForFunction(
    () => document.getElementById('conn')?.classList.contains('ok'),
    null,
    { timeout: 30000 },
  );
  return 'connected to local 912701';
}, { dependsOn: ['r1'] });

// --------------------------------------------------------------- r3 fund
await step('r3', 'Fund restored-to-be ML-DSA account with 50 ZNYT', async () => {
  const { stdout } = await run(FUND_SH, [state.addrs['ML-DSA-65'], '50'], { timeout: 120000 });
  const hash = stdout.trim().split('\n').pop();
  const r = await waitReceipt(hash);
  assert(r.status === '0x1', `funding status ${r.status}`);
  await page.click('button[data-act="refresh"]');
  await page.waitForFunction(
    () => [...document.querySelectorAll('[data-balance-for]')].some((el) => el.textContent.trim() === '50 ZNYT'),
    null,
    { timeout: 30000 },
  );
  return `funded via ${hash}`;
}, { dependsOn: ['r2'] });

// --------------------------------------------------------------- r4 reveal
await step('r4', 'Reveal phrase in settings with password re-entry', async () => {
  await page.fill('#reveal-pw', PASSWORD);
  await page.click('button[data-act="reveal-submit"]');
  await page.locator('.words .word').first().waitFor({ state: 'visible', timeout: T });
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll('.words .word')].map((el) => el.childNodes[1].textContent.trim()),
  );
  assert(JSON.stringify(shown) === JSON.stringify(state.words), 'revealed phrase differs from create phrase');
  await page.click('button[data-act="reveal-hide"]');
  return 'revealed phrase matches the create phrase exactly';
}, { dependsOn: ['r1'] });

// --------------------------------------------------------------- r5 backup
await step('r5', 'Export encrypted backup from settings', async () => {
  await page.fill('#backup-pw', BACKUP_PASSWORD);
  await page.fill('#backup-pw2', BACKUP_PASSWORD);
  await page.click('button[data-act="export-backup"]');
  await page.locator('#backup-text').waitFor({ state: 'visible', timeout: T });
  const text = await page.locator('#backup-text').inputValue();
  const parsed = JSON.parse(text);
  assert(parsed.format === 'zeronyth-wallet-backup', `backup format: ${parsed.format}`);
  assert(!text.includes(state.words.join(' ')), 'backup leaks the phrase');
  state.backupText = text;
  writeFileSync(path.join(SHOTS, 'r5-backup.json'), text);
  return 'backup JSON exported (encrypted, no phrase material inside)';
}, { dependsOn: ['r1'] });

// --------------------------------------------------------------- r6 wipe
await step('r6', 'Wipe the device wallet via the reset flow', async () => {
  await wipeViaUi(page);
  return 'vault removed; create screen shown';
}, { dependsOn: ['r3'] });

// --------------------------------------------------------------- r7 restore
await step('r7', 'Restore from phrase under a NEW password — addresses identical', async () => {
  await page.click('button[data-act="open-restore-phrase"]');
  await page.locator('#restore-words').waitFor({ state: 'visible' });
  await page.fill('#restore-words', state.words.join(' '));
  await page.fill('#restore-pw', NEW_PASSWORD);
  await page.fill('#restore-pw2', NEW_PASSWORD);
  await page.click('button[data-act="restore-phrase-submit"]');
  await page.locator('.acct').first().waitFor({ state: 'visible', timeout: T });
  const addrs = await readAccounts(page);
  assert(
    JSON.stringify(addrs) === JSON.stringify(state.addrs),
    `restored addresses differ:\n  before ${JSON.stringify(state.addrs)}\n  after  ${JSON.stringify(addrs)}`,
  );
  // The restore ran under the default RPC (unreachable from this sandbox),
  // so probing fell back to index-0 — which is all this wallet has. Point
  // the session at the local chain for the send step.
  await page.fill('#rpc-url', RPC_URL);
  await page.click('button[data-act="save-rpc"]');
  await page.waitForFunction(
    () => document.getElementById('conn')?.classList.contains('ok'),
    null,
    { timeout: 30000 },
  );
  await page.screenshot({ path: path.join(SHOTS, 'r7-restored.png') });
  return `all 3 addresses identical after restore: ${JSON.stringify(addrs)}`;
}, { dependsOn: ['r6'] });

// --------------------------------------------------------------- r8 send
await step('r8', 'Send 0.5 ZNYT from the restored ML-DSA account', async () => {
  const card = page.locator('.acct', { has: page.locator('.badge', { hasText: 'ML-DSA-65' }) })
    .filter({ hasText: 'ML-DSA-65' }).first();
  await card.locator('button[data-act="send"]').click();
  await page.locator('#send-to').waitFor({ state: 'visible' });
  await page.fill('#send-to', state.addrs['ECDSA']);
  await page.fill('#send-value', '0.5');
  await page.click('button[data-act="review"]');
  const approve = page.locator('button[data-act="approve"]');
  await approve.waitFor({ state: 'visible' });
  assert(await approve.isEnabled(), 'approve disabled (balance not seen?)');
  await approve.click();
  await page.waitForFunction(
    () => /^0x[0-9a-f]{64}$/i.test(document.querySelector('section.panel .mono')?.textContent?.trim() || ''),
    null,
    { timeout: T },
  );
  const hash = (await page.locator('section.panel .mono').first().textContent()).trim();
  await page.waitForFunction(
    () => document.getElementById('receipt-status')?.textContent?.trim() === '完了しました',
    null,
    { timeout: T },
  );
  const receipt = await waitReceipt(hash);
  assert(receipt.status === '0x1', `receipt status ${receipt.status}`);
  const gasUsed = parseInt(receipt.gasUsed, 16);
  assert(gasUsed === 147176, `gasUsed ${gasUsed}, expected 147176 (ML-DSA intrinsic)`);
  const bal = await rpc('eth_getBalance', [state.addrs['ECDSA'], 'latest']);
  assert(BigInt(bal) === 500000000000000000n, `ECDSA balance after send: ${bal}`);
  return `tx ${hash}, gasUsed ${gasUsed}, recipient balance exactly 0.5 ZNYT`;
}, { dependsOn: ['r7'] });

// --------------------------------------------------------------- r9 import
await step('r9', 'Wipe, then import the encrypted backup — addresses identical', async () => {
  await page.click('button[data-act="back-accounts"]');
  await page.locator('.acct').first().waitFor({ state: 'visible' });
  await wipeViaUi(page);
  await page.click('button[data-act="open-import-backup"]');
  await page.locator('#import-text').waitFor({ state: 'visible' });
  await page.fill('#import-text', state.backupText);
  await page.fill('#import-backup-pw', BACKUP_PASSWORD);
  await page.fill('#import-pw', THIRD_PASSWORD);
  await page.fill('#import-pw2', THIRD_PASSWORD);
  await page.click('button[data-act="import-backup-submit"]');
  await page.locator('.acct').first().waitFor({ state: 'visible', timeout: T });
  const addrs = await readAccounts(page);
  assert(
    JSON.stringify(addrs) === JSON.stringify(state.addrs),
    `imported addresses differ:\n  before ${JSON.stringify(state.addrs)}\n  after  ${JSON.stringify(addrs)}`,
  );
  return 'backup import reproduces all 3 addresses under a third password';
}, { dependsOn: ['r5', 'r8'] });

// --------------------------------------------------------------- r10 sw
await step('r10', 'Service worker cache is v11', async () => {
  const keys = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return caches.keys();
  });
  assert(
    keys.some((k) => k.includes('zeronyth-qwallet-912701v11')),
    `cache keys: ${JSON.stringify(keys)}`,
  );
  return `caches ${JSON.stringify(keys)}`;
}, { dependsOn: ['r1'] });

await browser.close();
const fails = results.filter((r) => r.status !== 'PASS');
console.log('\n===== RECOVERY BROWSER E2E SUMMARY =====');
for (const r of results) console.log(`${r.status.padEnd(7)} ${r.id}. ${r.title} — ${r.detail ?? ''}`);
console.log(`\n${results.filter((r) => r.status === 'PASS').length}/${results.length} steps passed`);
process.exit(fails.length ? 1 : 0);
