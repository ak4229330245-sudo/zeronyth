// Public testnet (chain 9127) z-token reference prices for swap.html, from the points service (/api/points/rules -> amm.prices, written by the AMM price keeper).
const el = document.getElementById('ref-prices');
fetch('/api/points/rules').then((r) => r.json()).then((r) => {
  const P = r?.amm?.prices || {}, f = (v) => (Number(v.usd) < 1 ? Number(v.usd).toPrecision(4) : Number(v.usd).toLocaleString('en-US', { maximumFractionDigits: 2 }));
  const live = Object.entries(P).filter(([, v]) => v && v.source !== 'peg'); if (!el || !live.length) return;
  el.textContent = `公開テストネットの z トークンの目標価格（本物の米ドル価格に自動調整）：${live.map(([s, v]) => `1 ${s} = ${f(v)} ドル`).join('、')}。${Object.entries(P).filter(([, v]) => v?.source === 'peg').map(([s]) => s).join('・')} = 1 ドル固定。ZNYT = ${r.amm.znytUsdTest || 10} テストドル（= ${r.amm.znytUsdTest || 10} zUSDC、固定のテスト用レート）。すべてテスト用で価値はありません。`;
}).catch(() => {});
