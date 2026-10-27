// ZERONYTH testnet AMM page (chain 9127). Token/pool list comes from /api/points/rules (deployments/main-amm.json <- points/amm/tokens.json).
// Reads go to /rpc; every write is signed by the user's own wallet. Test tokens only, no monetary value.
const $ = (id) => document.getElementById(id);
const CHAIN = { chainId: '0x23a7', chainName: 'ZERONYTH Testnet', nativeCurrency: { name: 'ZNYT', symbol: 'ZNYT', decimals: 18 }, rpcUrls: [location.origin + '/rpc'], blockExplorerUrls: ['https://scan.zeronyth.dpdns.org'] };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SEL = { balanceOf: '0x70a08231', allowance: '0xdd62ed3e', approve: '0x095ea7b3', claim: '0x4e71d92d', nextClaimAt: '0x11a163e9', getReserves: '0x0902f1ac', totalSupply: '0x18160ddd',
  addLiq: '0xaebf3e41', remLiq: '0xf88bf15a', znytForToken: '0x61e5c3d8', tokenForZnyt: '0xd4fe6995', swapExactInput: '0x11e15911' };
const MAX = (1n << 256n) - 1n;
const w = (x) => (typeof x === 'string' ? x.toLowerCase().replace(/^0x/, '').padStart(64, '0') : BigInt(x).toString(16).padStart(64, '0'));
const enc = (sel, ...a) => sel + a.map(w).join('');
const words = (hex) => (hex || '0x').slice(2).match(/.{64}/g)?.map((x) => BigInt('0x' + x)) || [];
let id = 0; const rpc = (method, params) => fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) }).then((r) => r.json()).then((j) => { if (j.error) throw new Error(j.error.message); return j.result; });
const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']).then(words);
function parseU(s, d) { s = String(s).trim(); if (!/^\d*\.?\d*$/.test(s) || !s || s === '.') return null; const [i, f = ''] = s.split('.'); return BigInt(i || '0') * 10n ** BigInt(d) + BigInt((f + '0'.repeat(d)).slice(0, d) || '0'); }
function fmtU(v, d, max = 6) { const neg = v < 0n; if (neg) v = -v; const s = v.toString().padStart(d + 1, '0'); const i = s.slice(0, s.length - d), f = s.slice(s.length - d).slice(0, max).replace(/0+$/, ''); return (neg ? '-' : '') + Number(i).toLocaleString('ja-JP') + (f ? '.' + f : ''); }
let A = null, me = null, bal = {};
const T = (s) => (s === 'ZNYT' ? { symbol: 'ZNYT', decimals: 18, address: A.wznyt, native: true } : A.tokens[s]);
const msg = (t, bad) => { $('msg').textContent = t; $('msg').className = 'p-small ' + (bad ? 'pt-bad' : 'pt-ok'); };

async function send(to, data, value = 0n, label = '') {
  msg(`${label}：ウォレットで確認してください…`);
  const hash = await ethereum.request({ method: 'eth_sendTransaction', params: [{ from: me, to, data, ...(value ? { value: '0x' + value.toString(16) } : {}) }] });
  msg(`${label}：送信しました（${hash.slice(0, 14)}…）。確認待ち…`);
  for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 2000)); const r = await rpc('eth_getTransactionReceipt', [hash]); if (r) { if (r.status !== '0x1') throw new Error('取引が失敗しました'); msg(`${label}：完了しました ✓`); return hash; } }
  throw new Error('確認がタイムアウトしました');
}
async function ensureAllowance(token, spender, amount, sym) {
  const [a] = await call(token, enc(SEL.allowance, me, spender)); if (a >= amount) return;
  await send(token, enc(SEL.approve, spender, MAX), 0n, `${sym} の使用を許可`);
}
async function balances() {
  if (!me) return; bal.ZNYT = BigInt(await rpc('eth_getBalance', [me, 'latest']));
  await Promise.all(Object.values(A.tokens).map(async (t) => { [bal[t.symbol]] = await call(t.address, enc(SEL.balanceOf, me)); }));
}
async function reserves(pool) { const [r0, r1] = await call(pool.pair, SEL.getReserves); const aIs0 = T(pool.a).address.toLowerCase() === pool.token0.toLowerCase(); return { rA: aIs0 ? r0 : r1, rB: aIs0 ? r1 : r0 }; }

async function renderFaucet() {
  const rows = await Promise.all(Object.values(A.tokens).map(async (t) => {
    const next = me ? Number((await call(t.address, enc(SEL.nextClaimAt, me)))[0]) : 0, wait = next * 1000 - Date.now();
    const tracked = t.priceSource ? `<span class="pt-tag">${t.priceSource.fixedUsd ? `${t.priceSource.fixedUsd} ドルに固定` : `${esc(t.symbol.replace(/^z/, ''))} 価格に連動`}</span>` : '';
    return `<tr><td><b>${esc(t.symbol)}</b>${tracked}<br><span class="p-small">${esc(t.name)}（テスト用・価値なし）</span></td><td>1日 ${esc(t.claimPerDay)}</td><td>${me ? fmtU(bal[t.symbol] || 0n, t.decimals) : '-'}</td>
      <td><button type="button" data-claim="${esc(t.symbol)}" ${!me || wait > 0 ? 'disabled' : ''}>${wait > 0 ? `あと ${Math.ceil(wait / 3600000)} 時間` : '受け取る'}</button> <button type="button" class="pt-sub" data-watch="${esc(t.symbol)}">ウォレットに追加</button></td></tr>`;
  }));
  $('faucet').innerHTML = '<tr><th>トークン</th><th>受け取れる量</th><th>残高</th><th></th></tr>' + rows.join('');
}
async function renderPools() {
  const rows = await Promise.all(A.pools.map(async (p) => { const { rA, rB } = await reserves(p); const a = T(p.a), b = T(p.b);
    const price = Number(rB) / 10 ** b.decimals / (Number(rA) / 10 ** a.decimals); const ref = A.prices?.[p.b]?.znyt && p.a === 'ZNYT' ? ` / 目標 ${A.prices[p.b].znyt.toPrecision(5)} ZNYT` : (A.prices?.[p.a] && p.b === 'zUSDC' ? ` / 目標 ${Number(A.prices[p.a].usd).toPrecision(5)}` : '');
    return `<tr><td>${esc(p.id)}</td><td>${fmtU(rA, a.decimals, 4)} ${esc(p.a)} ＋ ${fmtU(rB, b.decimals, 4)} ${esc(p.b)}</td><td>1 ${esc(p.a)} ≈ ${price.toPrecision(5)} ${esc(p.b)}${p.a === 'ZNYT' ? '' : ''}<br><span class="p-small">${p.a === 'ZNYT' ? `1 ${esc(p.b)} ≈ ${(1 / price).toPrecision(5)} ZNYT${ref}` : esc(ref)}</span></td></tr>`; }));
  $('pools').innerHTML = '<tr><th>プール</th><th>中身</th><th>いまの価格</th></tr>' + rows.join('');
  const P = A.prices || {}, live = Object.entries(P).filter(([, v]) => v && v.source !== 'peg'), peg = Object.entries(P).filter(([, v]) => v && v.source === 'peg');
  $('src').textContent = live.length ? `目標価格（本物の米ドル価格、10 分ごとに自動調整）：${live.map(([s, v]) => `${s} = ${Number(v.usd) < 1 ? Number(v.usd).toPrecision(4) : Number(v.usd).toLocaleString('en-US', { maximumFractionDigits: 2 })} ドル（${v.source}）`).join('、')}。${peg.length ? peg.map(([s]) => s).join(' / ') + ' = 1 ドル固定。' : ''}ZNYT = ${A.znytUsdTest || 10} テストドル（= ${A.znytUsdTest || 10} zUSDC、固定のテスト用レート）。` : `目標価格を読み込めませんでした（1 ZNYT = ${A.znytUsdTest || 10} テストドルの固定テスト用レート）。`;
}
// ---------- swap ----------
const symbols = () => ['ZNYT', ...Object.keys(A.tokens)];
const findPool = (x, y) => A.pools.find((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));
let quote = null;
async function updateQuote() {
  quote = null; $('sGo').disabled = true; const x = $('sFrom').value, y = $('sTo').value, p = findPool(x, y);
  if (x === y) return ($('sQuote').textContent = '別のトークンを選んでください');
  if (!p) return ($('sQuote').textContent = `${x} と ${y} の直接のプールはありません（ZNYT か zUSDC を経由してください）`);
  const amt = parseU($('sAmt').value, T(x).decimals); if (!amt) return ($('sQuote').textContent = '量を入れてください');
  const { rA, rB } = await reserves(p), [rIn, rOut] = p.a === x ? [rA, rB] : [rB, rA];
  const out = (amt * 997n * rOut) / (rIn * 1000n + amt * 997n); const min = (out * 99n) / 100n;
  quote = { p, x, y, amt, min };
  $('sQuote').textContent = `受け取り見込み：約 ${fmtU(out, T(y).decimals)} ${y}（最低 ${fmtU(min, T(y).decimals)}、手数料 0.3%）` + (me && (bal[x] ?? 0n) < amt ? ' ⚠️ 残高が足りません' : '');
  $('sGo').disabled = !me || !(out > 0n) || (bal[x] ?? 0n) < amt;
}
async function doSwap() {
  const { p, x, amt, min } = quote, dl = Math.floor(Date.now() / 1000) + 600;
  if (p.kind === 'native') {
    if (x === 'ZNYT') await send(p.router, enc(SEL.znytForToken, min, dl), amt, 'スワップ');
    else { await ensureAllowance(T(x).address, p.router, amt, x); await send(p.router, enc(SEL.tokenForZnyt, amt, min, dl), 0n, 'スワップ'); }
  } else { await ensureAllowance(T(x).address, p.router, amt, x); await send(p.router, enc(SEL.swapExactInput, T(x).address, amt, min, me, dl), 0n, 'スワップ'); }
  await refresh();
}
// ---------- liquidity ----------
const curPool = () => A.pools.find((p) => p.id === $('lPool').value);
async function autoB() {
  const p = curPool(), a = parseU($('lA').value, T(p.a).decimals); $('lAdd').disabled = true; if (!a) { $('lB').value = ''; return; }
  const { rA, rB } = await reserves(p); const b = rA ? (a * rB) / rA : 0n; $('lB').value = fmtU(b, T(p.b).decimals, T(p.b).decimals).replace(/,/g, '');
  $('lAdd').disabled = !me || (bal[p.a] ?? 0n) < a || (bal[p.b] ?? 0n) < b;
}
async function lpMine() {
  const p = curPool(); $('lAs').textContent = p.a; $('lBs').textContent = p.b; if (!me) return;
  const [[lp], [sup]] = await Promise.all([call(p.pair, enc(SEL.balanceOf, me)), call(p.pair, SEL.totalSupply)]); const { rA, rB } = await reserves(p);
  $('lMine').textContent = lp ? `あなたの持ち分：${(Number((lp * 1000000n) / sup) / 10000).toFixed(4)}%（約 ${fmtU((rA * lp) / sup, T(p.a).decimals, 4)} ${p.a} ＋ ${fmtU((rB * lp) / sup, T(p.b).decimals, 4)} ${p.b}）` : 'このプールにはまだ流動性を入れていません';
  $('lRem').disabled = !lp; $('lRem').dataset.lp = lp.toString();
}
async function addLiq() {
  const p = curPool(), a = parseU($('lA').value, T(p.a).decimals), b = parseU($('lB').value, T(p.b).decimals), dl = Math.floor(Date.now() / 1000) + 600;
  if (p.kind === 'native') { await ensureAllowance(T(p.b).address, p.router, b, p.b); await send(p.router, enc(SEL.addLiq, b, (b * 99n) / 100n, (a * 99n) / 100n, dl), a, '流動性を入れる'); }
  else { await ensureAllowance(T(p.a).address, p.router, a, p.a); await ensureAllowance(T(p.b).address, p.router, b, p.b); await send(p.router, enc(SEL.addLiq, a, b, 0n, dl), 0n, '流動性を入れる'); }
  await refresh();
}
async function remLiq() {
  const p = curPool(), lp = BigInt($('lRem').dataset.lp || '0'), dl = Math.floor(Date.now() / 1000) + 600; if (!lp) return;
  await ensureAllowance(p.pair, p.router, lp, 'LP'); await send(p.router, enc(SEL.remLiq, lp, 0n, 0n, dl), 0n, '流動性を出す'); await refresh();
}
// ---------- wiring ----------
async function connect() {
  if (!window.ethereum) return msg('ウォレット（MetaMask、OKX など）が見つかりません', true);
  [me] = await ethereum.request({ method: 'eth_requestAccounts' });
  try { await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.chainId }] }); } catch { await ethereum.request({ method: 'wallet_addEthereumChain', params: [CHAIN] }); }
  $('addr').textContent = me; await refresh();
}
async function refresh() { await balances(); await Promise.all([renderFaucet(), renderPools(), updateQuote(), lpMine()]); }
const safe = (f) => async (...a) => { try { await f(...a); } catch (e) { msg(e?.message || String(e), true); } };
async function init() {
  const r = await fetch('/api/points/rules').then((x) => x.json()); A = r.amm; if (!A) { $('pools').innerHTML = '<tr><td>読み込めませんでした</td></tr>'; return; }
  const opts = (sel, v) => symbols().map((s) => `<option${s === v ? ' selected' : ''}>${esc(s)}</option>`).join('');
  $('sFrom').innerHTML = opts('sFrom', 'ZNYT'); $('sTo').innerHTML = opts('sTo', 'zUSDC');
  $('lPool').innerHTML = A.pools.map((p) => `<option value="${esc(p.id)}">${esc(p.id)}</option>`).join('');
  for (const e of ['sFrom', 'sTo']) $(e).addEventListener('change', safe(updateQuote)); $('sAmt').addEventListener('input', safe(updateQuote));
  $('sMax').addEventListener('click', safe(async () => { const x = $('sFrom').value; let v = bal[x] ?? 0n; if (x === 'ZNYT') v = v > 10n ** 16n ? v - 10n ** 16n : 0n; $('sAmt').value = fmtU(v, T(x).decimals, T(x).decimals).replace(/,/g, ''); await updateQuote(); }));
  $('sGo').addEventListener('click', safe(doSwap)); $('lA').addEventListener('input', safe(autoB)); $('lPool').addEventListener('change', safe(async () => { await lpMine(); await autoB(); }));
  $('lAdd').addEventListener('click', safe(addLiq)); $('lRem').addEventListener('click', safe(remLiq)); $('connect').addEventListener('click', safe(connect));
  $('faucet').addEventListener('click', safe(async (ev) => { const c = ev.target.dataset?.claim, wt = ev.target.dataset?.watch;
    if (c) { await send(A.tokens[c].address, SEL.claim, 0n, `${c} を受け取る`); await refresh(); }
    if (wt) { if (!window.ethereum) return msg('ウォレットが見つかりません', true); const t = A.tokens[wt]; await ethereum.request({ method: 'wallet_watchAsset', params: { type: 'ERC20', options: { address: t.address, symbol: t.symbol, decimals: t.decimals } } }); } }));
  await Promise.all([renderFaucet(), renderPools(), lpMine()]);
}
safe(init)();
