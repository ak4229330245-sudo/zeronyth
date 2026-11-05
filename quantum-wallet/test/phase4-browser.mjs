// Phase 4 browser E2E for Quantum Wallet v2 — drives the real UI in a
// headless Chromium (Playwright) against the local Phase 4 test chain.
//
//   UI:  http://127.0.0.1:18080/   (qwallet-v2 dist/)
//   RPC: http://127.0.0.1:18545    (Besu test chain, chainId 912701)
//   Funding: evidence/phase4/fund.sh <address> <znyAmount>
//
// Re-runnable: uses a fresh browser context every run (fresh localStorage,
// fresh service-worker registration). Steps are independent where the app
// allows; a failed step is recorded and dependents are marked SKIPPED.
//
// Run:  PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers node test/phase4-browser.mjs
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(root, '.pw-browsers');
const { chromium } = await import('playwright-core');

const run = promisify(execFile);
const UI_URL = 'http://127.0.0.1:18080/';
const RPC_URL = 'http://127.0.0.1:18545';
const PASSWORD = 'phase4-e2e-test-01';
const FUND_SH = path.join(root, 'evidence/phase4/fund.sh');
const SHOTS = path.join(root, 'evidence/phase4/shots');
mkdirSync(SHOTS, { recursive: true });

const results = [];
const state = { addrs: {}, hashes: {} };
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
    log(`SKIP ${id} ${title} (depends on ${blocked.join(', ')})`);
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
    if (Date.now() - t0 > timeoutMs) throw new Error(`no receipt for ${hash} within ${timeoutMs}ms`);
    await new Promise((r2) => setTimeout(r2, 1000));
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext(); // fresh profile: storage + SW
const page = await context.newPage();
page.on('pageerror', (e) => log('PAGEERROR', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') log('CONSOLE-ERROR', m.text().slice(0, 300));
});
const T = 90000; // generous default timeout (PBKDF2 + keygen + polling)
page.setDefaultTimeout(T);

// --------------------------------------------------------------- step a
await step('a', 'Create vault (first account ML-DSA-65)', async () => {
  await page.goto(UI_URL, { waitUntil: 'load' });
  await page.locator('#create-pw').waitFor({ state: 'visible' });
  await page.fill('#create-pw', PASSWORD);
  await page.fill('#create-pw2', PASSWORD);
  const checked = await page.locator('input[name="create-scheme"]:checked').getAttribute('value');
  assert(checked === 'mldsa', `default create scheme is ${checked}, expected mldsa`);
  await page.click('button[data-act="create"]');
  await page.locator('.acct .addr').first().waitFor({ state: 'visible', timeout: T });
  const addr = (await page.locator('.acct .addr').first().textContent()).trim();
  assert(/^0x[0-9a-fA-F]{40}$/.test(addr), `bad ML-DSA address: ${addr}`);
  const badge = (await page.locator('.acct .badge').first().textContent()).trim();
  assert(badge === 'ML-DSA-65', `first account badge is ${badge}`);
  state.addrs.mldsa = addr;
  await page.screenshot({ path: path.join(SHOTS, 'a-create-accounts.png') });
  return `ML-DSA address ${addr}`;
});

// --------------------------------------------------------------- step b
await step('b', 'Point RPC at local test chain (912701)', async () => {
  await page.fill('#rpc-url', RPC_URL);
  await page.click('button[data-act="save-rpc"]');
  await page.waitForFunction(
    () => document.getElementById('conn')?.classList.contains('ok'),
    null,
    { timeout: 30000 },
  );
  const connText = (await page.locator('#conn').textContent()).trim();
  assert(connText.includes('PQ取引対応RPCに接続'), `conn indicator: ${connText}`);
  const saved = await page.locator('#rpc-url').inputValue();
  assert(saved === RPC_URL, `rpc-url field shows ${saved}`);
  return `conn="${connText}"`;
}, { dependsOn: ['a'] });

// --------------------------------------------------------------- step c
async function addAccount(scheme, badgeName) {
  await page.locator(`label.scheme:has(input[name="add-scheme"][value="${scheme}"])`).click();
  const before = await page.locator('.acct').count();
  await page.click('button[data-act="add-account"]');
  await page.waitForFunction(
    (n) => document.querySelectorAll('.acct').length === n + 1,
    before,
    { timeout: T },
  );
  const cards = await page.locator('.acct').all();
  for (const card of cards) {
    const badge = (await card.locator('.badge').textContent()).trim();
    if (badge === badgeName) return (await card.locator('.addr').textContent()).trim();
  }
  throw new Error(`no card with badge ${badgeName}`);
}
await step('c', 'Add Falcon-1024 and ECDSA accounts', async () => {
  state.addrs.falcon = await addAccount('falcon', 'Falcon-1024');
  state.addrs.ecdsa = await addAccount('ecdsa', 'ECDSA');
  assert(/^0x[0-9a-fA-F]{40}$/.test(state.addrs.falcon), 'bad falcon address');
  assert(/^0x[0-9a-fA-F]{40}$/.test(state.addrs.ecdsa), 'bad ecdsa address');
  await page.screenshot({ path: path.join(SHOTS, 'c-three-accounts.png') });
  return `Falcon ${state.addrs.falcon}, ECDSA ${state.addrs.ecdsa}`;
}, { dependsOn: ['a'] });

// --------------------------------------------------------------- step d
await step('d', 'Fund 50 ZNYT each via fund.sh; UI shows balances', async () => {
  const hashes = {};
  for (const [scheme, addr] of Object.entries(state.addrs)) {
    const { stdout } = await run(FUND_SH, [addr, '50'], { timeout: 120000 });
    hashes[scheme] = stdout.trim().split('\n').pop();
    const r = await waitReceipt(hashes[scheme]);
    assert(r.status === '0x1', `funding tx for ${scheme} status ${r.status}`);
  }
  await page.click('button[data-act="refresh"]');
  await page.waitForFunction(
    () => [...document.querySelectorAll('[data-balance-for]')].every((el) => el.textContent.trim() === '50 ZNYT'),
    null,
    { timeout: 30000 },
  );
  return `funded: ${JSON.stringify(hashes)}`;
}, { dependsOn: ['c'] });

// ----------------------------------------------------------- send helper
async function uiSend(fromBadge, toAddr, amount, expectGas, shotName) {
  const card = page.locator('.acct', { has: page.locator('.badge', { hasText: fromBadge }) })
    .filter({ hasText: fromBadge }).first();
  await card.locator('button[data-act="send"]').click();
  await page.locator('#send-to').waitFor({ state: 'visible' });
  await page.fill('#send-to', toAddr);
  await page.fill('#send-value', amount);
  await page.click('button[data-act="review"]');
  await page.locator('button[data-act="approve"]').waitFor({ state: 'visible' });
  const reviewText = await page.locator('section.panel').first().textContent();
  assert(reviewText.includes('取引を確認'), 'review screen heading missing');
  if (shotName) await page.screenshot({ path: path.join(SHOTS, shotName) });
  const approve = page.locator('button[data-act="approve"]');
  assert(await approve.isEnabled(), 'approve button disabled (insufficient balance?)');
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
  assert(gasUsed === expectGas, `gasUsed ${gasUsed}, expected ${expectGas}`);
  await page.click('button[data-act="back-accounts"]');
  await page.locator('.acct').first().waitFor({ state: 'visible' });
  return { hash, gasUsed };
}

// --------------------------------------------------------------- step e
await step('e', 'Send 1 ZNYT ML-DSA → Falcon via UI', async () => {
  const r = await uiSend('ML-DSA-65', state.addrs.falcon, '1', 147176, 'e-review-mldsa.png');
  state.hashes.e = r.hash;
  return `tx ${r.hash}, gasUsed ${r.gasUsed}`;
}, { dependsOn: ['d'] });

// --------------------------------------------------------------- step f
await step('f', 'Send 1 ZNYT Falcon → ECDSA via UI', async () => {
  const r = await uiSend('Falcon-1024', state.addrs.ecdsa, '1', 103080);
  state.hashes.f = r.hash;
  return `tx ${r.hash}, gasUsed ${r.gasUsed}`;
}, { dependsOn: ['d'] });

// --------------------------------------------------------------- step g
await step('g', 'Send 0.5 ZNYT ECDSA → ML-DSA via UI', async () => {
  const r = await uiSend('ECDSA', state.addrs.mldsa, '0.5', 21000);
  state.hashes.g = r.hash;
  return `tx ${r.hash}, gasUsed ${r.gasUsed}`;
}, { dependsOn: ['d'] });

// --------------------------------------------------------------- step l
await step('l', 'Faucet button surfaces node error without breaking UI', async () => {
  const card = page.locator('.acct').first();
  await card.locator('button[data-act="faucet"]').click();
  await page.waitForFunction(
    () => {
      const el = document.querySelector('p.err');
      return el && el.textContent.trim().length > 0;
    },
    null,
    { timeout: 30000 },
  );
  const errText = (await page.locator('p.err').first().textContent()).trim();
  const cards = await page.locator('.acct').count();
  assert(cards === 3, `accounts screen broken: ${cards} cards after faucet error`);
  return `error shown: "${errText}"`;
}, { dependsOn: ['c'] });

// --------------------------------------------------------------- step h
await step('h', 'Stay-unlocked across reload; Lock clears it', async () => {
  await page.reload({ waitUntil: 'load' });
  await page.locator('.acct .addr').first().waitFor({ state: 'visible', timeout: T });
  assert((await page.locator('#unlock-pw').count()) === 0, 'unlock screen shown after reload — autounlock failed');
  await page.screenshot({ path: path.join(SHOTS, 'h-stay-unlocked.png') });
  await page.click('#lock-btn');
  await page.locator('#unlock-pw').waitFor({ state: 'visible' });
  await page.reload({ waitUntil: 'load' });
  await page.locator('#unlock-pw').waitFor({ state: 'visible', timeout: 30000 });
  assert((await page.locator('.acct').count()) === 0, 'accounts visible after Lock+reload — autounlock not cleared');
  return 'auto-unlock on reload OK; after Lock, reload stays on unlock screen';
}, { dependsOn: ['a'] });

// --------------------------------------------------------------- step j
await step('j', 'Service worker registered with v7 cache', async () => {
  const info = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const keys = await caches.keys();
    return {
      hasReg: !!reg,
      active: !!reg?.active,
      scriptURL: reg?.active?.scriptURL || reg?.installing?.scriptURL || reg?.waiting?.scriptURL || null,
      keys,
    };
  });
  assert(info.hasReg, 'no service worker registration');
  assert(
    info.keys.some((k) => k.includes('zeronyth-qwallet-912701v8')),
    `cache keys: ${JSON.stringify(info.keys)}`,
  );
  return `scriptURL ${info.scriptURL}, caches ${JSON.stringify(info.keys)}, active=${info.active}`;
}, { dependsOn: ['h'] });

// --------------------------------------------------------------- step i
await step('i', 'Language switch ja → en → ja', async () => {
  const h2 = page.locator('#view h2').first();
  const before = (await h2.textContent()).trim();
  assert(before === 'ロック解除', `unlock heading before switch: ${before}`);
  await page.selectOption('#lang-sel', 'en');
  await page.waitForFunction(
    () => document.querySelector('#view h2')?.textContent?.trim() === 'Unlock',
    null,
    { timeout: 10000 },
  );
  await page.selectOption('#lang-sel', 'ja');
  await page.waitForFunction(
    () => document.querySelector('#view h2')?.textContent?.trim() === 'ロック解除',
    null,
    { timeout: 10000 },
  );
  return 'heading ロック解除 → Unlock → ロック解除';
}, { dependsOn: ['h'] });

// --------------------------------------------------------------- step k
await step('k', 'Reset flow wipes vault and returns to create screen', async () => {
  await page.locator('#unlock-pw').waitFor({ state: 'visible' });
  await page.click('button[data-act="reset-open"]');
  await page.locator('button[data-act="reset-confirm"]').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(SHOTS, 'k-reset-confirm.png') });
  await page.click('button[data-act="reset-confirm"]');
  await page.locator('#create-pw').waitFor({ state: 'visible', timeout: 30000 });
  const vaultVal = await page.evaluate(() => localStorage.getItem('zeronyth-vault-v1'));
  assert(vaultVal === null, `zeronyth-vault-v1 still present after wipe: ${String(vaultVal).slice(0, 40)}`);
  return 'create screen shown; zeronyth-vault-v1 removed from localStorage';
}, { dependsOn: ['h'] });

await browser.close();
const fails = results.filter((r) => r.status !== 'PASS');
console.log('\n===== PHASE 4 BROWSER E2E SUMMARY =====');
for (const r of results) console.log(`${r.status.padEnd(7)} ${r.id}. ${r.title} — ${r.detail ?? ''}`);
console.log(`\n${results.filter((r) => r.status === 'PASS').length}/${results.length} steps passed`);
process.exit(fails.length ? 1 : 0);
