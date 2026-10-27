// Tokenomics explorer (ja-first). Design values mirror launch/public/public-genesis.config.json; the live section reads
// /api/econ/status (economy coordinator) when this gateway has one, and says so honestly when it does not.
const ALLOC = [
  ['rewardPool', 30_000_000], ['grants', 20_000_000], ['treasury', 14_999_000], ['devVesting', 13_000_000],
  ['liquidity', 10_000_000], ['early', 9_900_000], ['devUnlocked', 2_000_000], ['faucet', 100_000], ['ops', 1_000],
];
const TOTAL = 100_000_000, POOL = 30_000_000, RATE = 0.15, SPLIT = [0.4, 0.3, 0.3];
const T = {
  ja: { 'a.rewardPool': '報酬プール（EmissionPool）', 'a.grants': '助成・エコシステム', 'a.treasury': 'トレジャリー', 'a.devVesting': '開発者（ロック＋段階解放）',
    'a.liquidity': '流動性', 'a.early': '初期参加者', 'a.devUnlocked': '開発者（即時）', 'a.faucet': 'フォーセット（無料配布）', 'a.ops': '運用（コントラクト展開用）',
    'n.rewardPool': '毎年残高の15%を放出。L1 40 / AI 30 / VPS 30。', 'n.devVesting': '1年ロック → 3年で線形解放', 'n.ops': 'ZnytEconomy の展開ガス用',
    perDay: '/日', live: { ok: 'ライブ値: {net} チェーンの経済コーディネーター（{ver}）から取得。', fast: '※このチェーンはテスト用の高速設定です（1年 = {sec} 秒、プール {pool} ZNYT）。本番の数字とは異なります。',
      none: 'このサーバーでは経済サービス（/api/econ）が動いていないため、ライブ値はありません。上の数字はローンチ予定の設計値です。' },
    l: { remaining: 'プール残高', year: '現在の年', yearAllow: '今年の放出枠', released: '累計放出', paid: '仕事への支払い累計', returned: 'プールへ戻った分',
      epoch: '最新エポック', providers: '参加者（オンライン / 登録）', burned: '焼却された手数料（焼却は未実装・予定）', toPool: 'プールへ入った手数料', vest: '開発者ロック 解放済み / 総額', supply: '現在の総供給量', block: 'ブロック' } },
  en: { h1: 'Tokenomics', lead: 'Total supply is fixed at 100M ZNYT with no further minting. Rewards are released slowly from the reward pool and paid only for verified work.',
    'nav.console': 'Console', 'nav.node': 'Join as a node', 'nav.tok': 'Tokenomics', 'k.supply': 'Total supply', 'k.pool': 'Reward pool', 'k.y1': 'Year-1 rewards', 'k.y1s': '≈ 12,329 ZNYT/day',
    'k.fee': 'Gas fees', 'k.fees': 'to the reward pool (20% burn: planned, not implemented yet)', s1: '1. Allocation at genesis', s1n: 'Planned launch values (launch/public/public-genesis.config.json). Addresses are fixed at launch.',
    s2: '2. Emission: 15% of what remains, every year', s2p: 'Each year the pool releases 15% of its remaining balance, so emission shrinks every year and never quite reaches zero. Daily = yearly ÷ 365.',
    'th.year': 'Year', 'th.start': 'Pool at start', 'th.rel': 'Released', 'th.day': 'Per day', 'th.cum': 'Cumulative',
    s3: '3. How each day is split', 'sp.l1': 'L1 verification (blocks, transactions, light nodes)', 'sp.ai': 'AI (inference and evaluation jobs)', 'sp.vps': 'VPS / container rental',
    'sp.cap': 'One participant can take at most 25% of a bucket per epoch (anti-monopoly); the rest returns to the pool.', 'sp.work': 'Payouts are proportional to verified work. Phones and PCs earn for verification done while the page is open.',
    'sp.empty': 'A bucket nobody worked for is not spent; it returns to the pool.', s4: '4. Where the money goes', 'f.gas': 'Gas fees: planned 80% to the reward pool and 20% burned, but this is not implemented yet. On the current testnet, fees go to the proposing validator (gas price 1 gwei, baseFee 0).',
    'f.plan': '10-day plans (AI / VPS usage): the payment is held in escrow and settled to providers who were online after 10 days; unused time is refunded. No platform cut.', 'f.dev': 'Developer: 2M usable from day one; 13M locked 1 year, then released linearly over 3 years (DevVesting contract).',
    s5: '5. Live state', foot: 'This is a testnet in trial operation. ZNYT currently has no monetary value. This is not an investment offer.',
    'a.rewardPool': 'Reward pool (EmissionPool)', 'a.grants': 'Grants / ecosystem', 'a.treasury': 'Treasury', 'a.devVesting': 'Developer (locked + vesting)', 'a.liquidity': 'Liquidity',
    'a.early': 'Early participants', 'a.devUnlocked': 'Developer (unlocked)', 'a.faucet': 'Faucet', 'a.ops': 'Ops (contract deployment)',
    'n.rewardPool': '15% of remaining per year. L1 40 / AI 30 / VPS 30.', 'n.devVesting': '1-year cliff, then 3-year linear', 'n.ops': 'gas for deploying ZnytEconomy',
    perDay: '/day', live: { ok: 'Live values from the {net} chain economy coordinator ({ver}).', fast: 'Note: this chain uses a fast TEST setting (1 year = {sec} s, pool {pool} ZNYT); numbers differ from production.',
      none: 'No economy service (/api/econ) on this server, so there are no live values. The numbers above are the planned launch design.' },
    l: { remaining: 'Pool remaining', year: 'Current year', yearAllow: 'This year\'s allowance', released: 'Released (total)', paid: 'Paid for work (total)', returned: 'Returned to pool',
      epoch: 'Latest epoch', providers: 'Participants (online / registered)', burned: 'Fees burned (burn not implemented yet)', toPool: 'Fees to pool', vest: 'Dev vesting released / total', supply: 'Current total supply', block: 'Block' } },
};
const $ = (id) => document.getElementById(id);
let lang = (() => { try { const q = new URLSearchParams(location.search).get('lang'); const v = q || localStorage.getItem('zeronyth.language.v1'); return v === 'en' ? 'en' : 'ja'; } catch { return 'ja'; } })();
const L = () => T[lang]; const fmt = (n, d = 0) => Number(n).toLocaleString(lang === 'ja' ? 'ja-JP' : 'en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const znyt = (wei, d = 2) => fmt(Number(BigInt(wei || 0) / 10n ** 12n) / 1e6, d);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const original = new Map();

function renderStatic() {
  document.documentElement.lang = lang;
  for (const e of document.querySelectorAll('[data-t]')) { const k = e.dataset.t; if (!original.has(e)) original.set(e, e.textContent); e.textContent = lang === 'ja' ? original.get(e) : (T.en[k] ?? original.get(e)); }
  const a = $('tkAlloc'); a.replaceChildren();
  for (const [k, amt] of ALLOC) {
    const row = el('div', 'row'); row.append(el('span', null, L()['a.' + k]));
    const bar = el('div', 'bar'), fill = el('i'); fill.style.width = `${(amt / TOTAL) * 100}%`; bar.append(fill);
    row.append(bar, el('span', 'amt', `${fmt(amt)} (${fmt((amt / TOTAL) * 100, 3).replace(/\.?0+$/, '')}%)`));
    if (L()['n.' + k]) row.append(el('span', 'note', L()['n.' + k]));
    a.append(row);
  }
  const tb = $('tkSched'); tb.replaceChildren(); let rem = POOL, cum = 0;
  for (let y = 1; y <= 10; y++) { const r = rem * RATE; cum += r; const tr = el('tr'); for (const v of [y, fmt(rem), fmt(r), fmt(r / 365, 2), fmt(cum)]) tr.append(el('td', null, String(v))); tb.append(tr); rem -= r; }
  const day = (POOL * RATE) / 365; SPLIT.forEach((s, i) => { $('tkD' + i).textContent = `${lang === 'ja' ? '1年目' : 'Year 1'}: ${fmt(day * s, 2)} ZNYT${L().perDay}`; });
}

async function renderLive() {
  const box = $('tkLive'), note = $('tkLiveNote');
  let d; try { const r = await fetch('api/econ/status', { cache: 'no-store' }); if (!r.ok) throw 0; d = await r.json(); if (!d.emission) throw 0; } catch { box.replaceChildren(); note.textContent = L().live.none; return; }
  const e = d.emission, l = L().l, rows = [];
  note.textContent = L().live.ok.replace('{net}', d.network).replace('{ver}', `${d.contract} ${d.version || ''}`.trim())
    + (Number(e.yearSeconds) !== 31536000 ? ' ' + L().live.fast.replace('{sec}', fmt(e.yearSeconds)).replace('{pool}', znyt(e.yearStartRemainingWei, 0)) : '');
  rows.push([l.remaining, znyt(e.remainingWei)], [l.year, e.year], [l.yearAllow, znyt(e.yearAllowanceWei)], [l.released, znyt(e.totalReleasedWei)], [l.paid, znyt(e.totalPaidWei)], [l.returned, znyt(e.totalReturnedWei)]);
  if (d.economy) rows.push([l.epoch, d.economy.lastEpoch]);
  if (d.providers) rows.push([l.providers, `${d.providers.filter((p) => p.online).length} / ${d.providers.length}`]);
  if (d.fee) rows.push([l.burned, znyt(d.fee.totalBurnedWei, 4)], [l.toPool, znyt(d.fee.totalToPoolWei, 4)]);
  if (d.vesting) rows.push([l.vest, `${znyt(d.vesting.releasedWei, 0)} / ${znyt(d.vesting.totalWei, 0)}`]);
  if (d.supply?.supplyWei) rows.push([l.supply, znyt(d.supply.supplyWei, 4)], [l.block, d.supply.block]);
  box.replaceChildren(...rows.map(([k, v]) => { const w = el('div'); w.append(el('dt', null, k), el('dd', null, String(v))); return w; }));
}

try { $('tkLang').value = localStorage.getItem('zeronyth.language.v1') || lang; } catch { $('tkLang').value = lang; }
$('tkLang').addEventListener('change', (ev) => { const v = ev.target.value; lang = v === 'en' ? 'en' : 'ja'; try { localStorage.setItem('zeronyth.language.v1', v); } catch {} renderStatic(); renderLive(); });
renderStatic(); renderLive(); setInterval(renderLive, 15000);
