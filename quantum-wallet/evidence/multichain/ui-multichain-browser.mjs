// Multi-chain browser E2E (v12 step 7) — drives the REAL wallet UI in
// headless Chromium against the local harness:
//   UI http://127.0.0.1:18080/ (dist/), chain A http://127.0.0.1:18545
//   (chainId 912701 + local AMM), chain B http://127.0.0.1:18546
//   (fake Base Sepolia, chainId 84532).
// Covers: phrase create → ML-DSA send (exact gas) → AMM swap buy (ECDSA)
// and sell (ML-DSA, approve+swap) → network switch to Base Sepolia
// (PQ card greyed, RPC override via Settings, ECDSA send) → switch back.
// Plus a CSP boot test against the :18081 instance (production wallet
// CSP with the extended connect-src).
// Writes ui-multichain-output.json. Test-only keys/amounts throughout.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signTransaction } from '../../src/core/tx.mjs';
import { createRpcClient } from '../../src/core/rpc.mjs';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(root, '.pw-browsers');
const { chromium } = await import('playwright-core');

const run = promisify(execFile);
const UI = 'http://127.0.0.1:18080/';
const UI_CSP = 'http://127.0.0.1:18081/';
const RPC_A = 'http://127.0.0.1:18545';
const RPC_B = 'http://127.0.0.1:18546';
const PASSWORD = 'multichain-e2e-pass-01';
const FUND_SH = path.join(root, 'evidence/phase4/fund.sh');
const FUND_B_SH = path.join(root, 'evidence/multichain/fund84532.sh');
const SHOTS = path.join(root, 'evidence/multichain/shots');
mkdirSync(SHOTS, { recursive: true });

const results = [];
const state = { addrs: {}, ids: {} };
function step(id, ok, detail = {}) {
  results.push({ id, ok, ...detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}`, JSON.stringify(detail).slice(0, 220));
}
async function rpc(url, method, params = []) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}
const balanceOf = (url, token, addr) =>
  rpc(url, 'eth_call', [{ to: token, data: '0x70a08231' + addr.replace(/^0x/, '').padStart(64, '0') }, 'latest']).then(
    (h) => BigInt(h),
  );
const nativeBal = (url, addr) => rpc(url, 'eth_getBalance', [addr, 'latest']).then((h) => BigInt(h));
/** Extract 0x{64} hashes from element texts (mono blocks may append link text). */
const hashesIn = (texts) =>
  texts.map((x) => (String(x).match(/0x[0-9a-f]{64}/) ?? [])[0]).filter(Boolean);
async function waitReceipt(url, hash, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const r = await rpc(url, 'eth_getTransactionReceipt', [hash]);
    if (r) return r;
    await new Promise((r2) => setTimeout(r2, 750));
  }
  throw Error(`no receipt for ${hash}`);
}

const deployment = JSON.parse(readFileSync(path.join(root, 'evidence/multichain/amm-deployment.json'), 'utf8'));
let page = null;
process.on('uncaughtException', async (e) => {
  try {
    if (page) {
      await page.screenshot({ path: path.join(SHOTS, 'failure.png') });
      const text = await page.textContent('#view').catch(() => '');
      console.log('FAILURE VIEW:', String(text).slice(0, 800));
    }
  } catch {}
  console.error('DRIVER ERROR', String(e).slice(0, 300));
  process.exit(1);
});
const browser = await chromium.launch();
const context = await browser.newContext();
await context.addInitScript(() => {
  // Point the wallet's home-network RPC at the local harness chain
  // before first paint (never production from this test profile).
  localStorage.setItem('zeronyth.qwallet.rpc', 'http://127.0.0.1:18545');
});
page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));

// ---------------------------------------------------------------- boot+create
await page.goto(UI, { waitUntil: 'load' });
await page.waitForFunction(() => window.__qwBooted === true, null, { timeout: 15000 });
step('boot', true);
await page.click('[data-act="phrase-begin"]');
await page.waitForSelector('.word');
const words = await page.$$eval('.word', (els) => els.map((e) => e.textContent.replace(/^\d+/, '').trim()));
step('phrase-shown', words.length === 24, { count: words.length });
await page.click('[data-act="phrase-written"]');
const confirmIds = await page.$$eval('input[id^="confirm-word-"]', (els) => els.map((e) => e.id));
for (const id of confirmIds) {
  const pos = Number(id.split('-').pop());
  await page.fill(`#${id}`, words[pos]);
}
await page.click('[data-act="phrase-confirm-check"]');
await page.fill('#create-pw', PASSWORD);
await page.fill('#create-pw2', PASSWORD);
await page.click('[data-act="phrase-create"]');
await page.waitForSelector('.acct', { timeout: 30000 });
const cards = await page.$$eval('.acct', (els) =>
  els.map((c) => ({
    scheme: (c.querySelector('.badge')?.className.match(/badge (\w+)/) ?? [])[1],
    addr: c.querySelector('.addr')?.textContent,
    id: c.querySelector('[data-act="send"]')?.dataset.id,
    disabled: c.classList.contains('disabled'),
  })),
);
for (const c of cards) {
  state.addrs[c.scheme] = c.addr;
  state.ids[c.scheme] = c.id;
}
step('wallet-created', cards.length === 3 && !!state.addrs.mldsa && !!state.addrs.ecdsa, { cards });

// ---------------------------------------------------------------- funding
await run(FUND_SH, [state.addrs.ecdsa, '100']);
await run(FUND_SH, [state.addrs.mldsa, '100']);
await page.click('[data-act="refresh"]');
await page.waitForFunction(
  () => document.body.textContent.includes('100'),
  null,
  { timeout: 20000 },
);
step('funded', true);

// ------------------------------------------------------- ML-DSA send (gas)
await page.click(`[data-act="send"][data-id="${state.ids.mldsa}"]`);
await page.fill('#send-to', state.addrs.ecdsa);
await page.fill('#send-value', '0.25');
await page.click('[data-act="review"]');
await page.waitForSelector('#first-ack', { timeout: 15000 });
const reviewText = await page.textContent('#view');
step('review-mldsa', reviewText.includes('147176') && reviewText.includes('ZERONYTH'), {
  gasShown: reviewText.includes('147176'),
});
await page.check('#first-ack');
await page.click('[data-act="approve"]');
await page.waitForSelector('#receipt-status', { timeout: 30000 });
const sendHash = (await page.$$eval('#view .mono', (els) => els.map((e) => e.textContent))).find((x) =>
  /^0x[0-9a-f]{64}$/.test(x),
);
const mldsaReceipt = await waitReceipt(RPC_A, sendHash);
step('mldsa-send', mldsaReceipt.status === '0x1' && BigInt(mldsaReceipt.gasUsed) === 147176n, {
  hash: sendHash,
  gasUsed: BigInt(mldsaReceipt.gasUsed).toString(),
});

// ------------------------------------------------------------- swap: ECDSA buy
await page.click('[data-act="back-accounts"]');
await page.click('[data-act="open-swap"]');
await page.waitForSelector('#swap-pool', { timeout: 15000 });
await page.selectOption('#swap-account', state.ids.ecdsa);
await page.selectOption('#swap-dir', 'buy');
await page.fill('#swap-amount', '1');
await page.click('[data-act="swap-quote"]');
await page.waitForSelector('[data-act="swap-execute"]', { timeout: 15000 });
const zBefore = await balanceOf(RPC_A, deployment.zusdt, state.addrs.ecdsa);
await page.click('[data-act="swap-execute"]');
await page.waitForFunction(
  () => [...document.querySelectorAll('#view .mono')].some((e) => /0x[0-9a-f]{64}/.test(e.textContent)),
  null,
  { timeout: 60000 },
);
const buyHashes = hashesIn(await page.$$eval('#view .mono', (els) => els.map((e) => e.textContent)));
const buyReceipt = buyHashes.length ? await waitReceipt(RPC_A, buyHashes[buyHashes.length - 1]) : null;
const zAfter = await balanceOf(RPC_A, deployment.zusdt, state.addrs.ecdsa);
step('swap-buy-ecdsa', !!buyReceipt && buyReceipt.status === '0x1' && zAfter > zBefore, {
  hashes: buyHashes,
  zusdtDelta: (zAfter - zBefore).toString(),
});

// ------------------------------------------- seed ML-DSA with zUSDT (setup)
{
  const keyText = readFileSync(process.env.HOME + '/workspace/besu-2611-recon/e2e/ecdsa-account.txt', 'utf8').trim();
  const secret = Uint8Array.from(Buffer.from(keyText.replace(/^0x/, ''), 'hex'));
  const client = createRpcClient(RPC_A);
  const from = deployment.deployer;
  const nonce = Number(await client.getTransactionCount(from));
  const data =
    '0xa9059cbb' +
    state.addrs.mldsa.replace(/^0x/, '').padStart(64, '0') +
    (100n * 10n ** 18n).toString(16).padStart(64, '0');
  const signed = signTransaction({
    scheme: 'ecdsa', secret, nonce, gasPrice: 1000000000n, gasLimit: 100000n,
    to: deployment.zusdt, value: 0n, data, chainId: 912701n,
  });
  const h = await client.sendRawTransaction(signed.rawTx);
  const r = await waitReceipt(RPC_A, h);
  step('seed-mldsa-zusdt', r.status === '0x1', { hash: h });
}

// ------------------------------------------------------------ swap: ML-DSA sell
const mldsaNativeBefore = await nativeBal(RPC_A, state.addrs.mldsa);
await page.click('[data-act="back-accounts"]');
await page.click('[data-act="open-swap"]');
await page.waitForSelector('#swap-pool', { timeout: 15000 });
await page.selectOption('#swap-account', state.ids.mldsa);
await page.selectOption('#swap-dir', 'sell');
await page.fill('#swap-amount', '10');
await page.click('[data-act="swap-quote"]');
await page.waitForSelector('[data-act="swap-execute"]', { timeout: 15000 });
await page.click('[data-act="swap-execute"]');
await page.waitForFunction(
  () =>
    [...document.querySelectorAll('#view .mono')].filter((e) => /0x[0-9a-f]{64}/.test(e.textContent))
      .length >= 2,
  null,
  { timeout: 60000 },
);
const sellHashes = hashesIn(await page.$$eval('#view .mono', (els) => els.map((e) => e.textContent)));
let sellOk = sellHashes.length >= 2;
for (const h of sellHashes) {
  const r = await waitReceipt(RPC_A, h);
  if (r.status !== '0x1') sellOk = false;
}
const mldsaNativeAfter = await nativeBal(RPC_A, state.addrs.mldsa);
step('swap-sell-mldsa', sellOk && mldsaNativeAfter > mldsaNativeBefore, {
  hashes: sellHashes,
  nativeDelta: (mldsaNativeAfter - mldsaNativeBefore).toString(),
});
await page.screenshot({ path: path.join(SHOTS, 'swap-done.png') });

// --------------------------------------------- network switch: Base Sepolia
await page.click('[data-act="back-accounts"]');
await page.selectOption('#net-sel', 'base-sepolia');
await page.waitForFunction(
  () => document.querySelector('.acct.disabled .badge.mldsa') != null,
  null,
  { timeout: 20000 },
);
step('base-pq-greyed', true);
// settings: RPC override for this network -> local fake Base chain
await page.fill('#rpc-url', RPC_B);
await page.click('[data-act="save-rpc"]');
await page.waitForFunction(() => document.querySelector('#conn')?.className === 'ok', null, {
  timeout: 20000,
});
step('base-rpc-override', true);
await run(FUND_B_SH, [state.addrs.ecdsa, '50']);
await page.click('[data-act="refresh"]');
await new Promise((r) => setTimeout(r, 3000));
const ecdsaBalB = await nativeBal(RPC_B, state.addrs.ecdsa);
step('base-funded', ecdsaBalB === 50n * 10n ** 18n, { balance: ecdsaBalB.toString() });

const RECIP_B = '0x2222222222222222222222222222222222222222';
await page.click(`[data-act="send"][data-id="${state.ids.ecdsa}"]`);
await page.fill('#send-to', RECIP_B);
await page.fill('#send-value', '0.5');
await page.click('[data-act="review"]');
await page.waitForSelector('#first-ack', { timeout: 15000 });
const baseReview = await page.textContent('#view');
step('base-review', baseReview.includes('84532') && baseReview.includes('Base Sepolia'), {});
await page.check('#first-ack');
await page.click('[data-act="approve"]');
await page.waitForFunction(
  () => [...document.querySelectorAll('#view .mono')].some((e) => /0x[0-9a-f]{64}/.test(e.textContent)),
  null,
  { timeout: 30000 },
);
const baseHash = hashesIn(await page.$$eval('#view .mono', (els) => els.map((e) => e.textContent)))[0];
const baseReceipt = await waitReceipt(RPC_B, baseHash);
const recipBal = await nativeBal(RPC_B, RECIP_B);
step('base-send', baseReceipt.status === '0x1' && recipBal === 5n * 10n ** 17n, {
  hash: baseHash,
  gasUsed: BigInt(baseReceipt.gasUsed).toString(),
});
await page.screenshot({ path: path.join(SHOTS, 'base-send.png') });

// ------------------------------------------------------------- switch back
await page.click('[data-act="back-accounts"]');
await page.selectOption('#net-sel', 'zeronyth');
await page.waitForFunction(
  () => document.querySelector('.acct.disabled .badge.mldsa') == null,
  null,
  { timeout: 20000 },
);
step('back-to-zeronyth', true);
await browser.close();

// ------------------------------------------------------------- CSP boot test
const browser2 = await chromium.launch();
const ctx2 = await browser2.newContext();
await ctx2.addInitScript(() => {
  window.__violations = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__violations.push({ directive: e.violatedDirective, blockedURI: e.blockedURI });
  });
  localStorage.setItem('zeronyth.qwallet.rpc', 'http://127.0.0.1:18545');
});
const page2 = await ctx2.newPage();
await page2.goto(UI_CSP, { waitUntil: 'load' });
const cspBooted = await page2
  .waitForFunction(() => window.__qwBooted === true, null, { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
await new Promise((r) => setTimeout(r, 3000));
const violations = await page2.evaluate(() => window.__violations ?? []);
const badViolations = violations.filter(
  (v) => !/connect-src/.test(v.directive) || !/127\.0\.0\.1|localhost/.test(v.blockedURI),
);
step('csp-boot', cspBooted && badViolations.length === 0, {
  booted: cspBooted,
  violations,
  badViolations,
});
await browser2.close();

const out = {
  generatedAt: new Date().toISOString(),
  steps: results,
  addresses: state.addrs,
  ok: results.every((r) => r.ok),
};
writeFileSync(path.join(root, 'evidence/multichain/ui-multichain-output.json'), JSON.stringify(out, null, 1));
console.log('OVERALL', out.ok ? 'PASS' : 'FAIL', `${results.filter((r) => r.ok).length}/${results.length}`);
process.exit(out.ok ? 0 : 1);
