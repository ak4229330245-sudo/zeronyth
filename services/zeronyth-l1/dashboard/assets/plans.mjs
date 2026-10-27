// 10-day ZNYT plans page (main testnet). Talks to the gateway's /api/access/* (loopback access service) and /rpc.
// Never asks for keys: buying is a subscribe(kind) tx from the user's own wallet, login is an EIP-191 signature.
const $ = (id) => document.getElementById(id);
const CHAIN = { chainId: '0x23a7', chainName: 'ZERONYTH Testnet', nativeCurrency: { name: 'ZNYT', symbol: 'ZNYT', decimals: 18 },
  rpcUrls: [location.origin + '/rpc'], blockExplorerUrls: ['https://scan.zeronyth.dpdns.org'] };
const SUBSCRIBE = '0x49c7e639';           // subscribe(uint8)
let token = null, addr = null, plan = null;
const api = (p, o = {}) => fetch('/api/access' + p, { ...o, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } })
  .then(async (r) => { const j = await r.json().catch(() => ({ error: 'HTTP ' + r.status })); if (!r.ok && !j.error) j.error = 'HTTP ' + r.status; return j; });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const weiHex = (z) => { const [i, f = ''] = String(z).split('.'); return '0x' + (BigInt(i) * 10n ** 18n + BigInt((f + '0'.repeat(18)).slice(0, 18))).toString(16); };
const when = (t) => new Date(t * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) + '（日本時間）';

async function loadPlans() {
  const d = await api('/plans');
  if (d.error) { $('plans').textContent = 'プラン情報を読めませんでした: ' + d.error; return; }
  plan = d.contracts.find((c) => c.contract === 'ZnytEconomy') || d.contracts[0];
  $('plans').innerHTML = `<h2>プラン（期間 ${plan.periodSeconds / 86400} 日）</h2>
    <table><tr><th>プラン</th><th>価格</th><th>内容</th></tr>${plan.plans.map((p) => `<tr><td>${p.kind.toUpperCase()}</td><td>${esc(p.priceZnyt)} ZNYT / 10日</td><td>${esc(p.includes)}</td></tr>`).join('')}</table>
    <p class="p-small">コントラクト <code>${esc(plan.address)}</code>（チェーン 9127）。支払いはエスクローに入り、10日後に提供者へ精算されます（提供者が動いていなかった時間の分は返金）。精算されないまま期限から猶予期間（${plan.graceSeconds / 86400}日）を過ぎた場合は、ご自分で返金を受け取れます。
    VPS: ${d.vps.backend === 'mock' ? '模擬（テスト用の仮の環境）' : '隔離された練習用 Linux 環境'}。</p>`;
}
async function loadAccounting() {
  const a = await api('/accounting');
  if (a.error) { $('acct').textContent = '貢献者の会計: まだデータがありません'; return; }
  const n = (x) => (+x).toFixed(3);
  $('acct').innerHTML = `<h2>貢献者の会計（40/30/30）</h2><p>排出 ${n(a.totals.emissionReleased)} ZNYT → 支払 ${n(a.totals.emissionPaid)}／プールへ戻り ${n(a.totals.returnedToPool)}。プラン支払 ${a.totals.planPayments} 件（提供者へ ${a.totals.planToProviders}、返金 ${a.totals.planRefunded}）。検算: ${a.allChecksPass ? '✅ すべて一致' : '⚠️ 不一致あり'}</p>
    <table><tr><th>貢献者</th><th>L1</th><th>AI</th><th>VPS</th><th>プラン収入</th><th>合計</th></tr>${a.ledger.map((x) => `<tr><td><code>${esc(x.address.slice(0, 10))}…</code></td><td>${n(x.l1Znyt)}</td><td>${n(x.aiZnyt)}</td><td>${n(x.vpsZnyt)}</td><td>${n(x.servicePlanZnyt)}</td><td>${n(x.earnedZnyt)}</td></tr>`).join('')}</table>`;
}
async function connect() {
  if (!window.ethereum) return alert('ウォレット（MetaMask、OKX など）が見つかりません');
  [addr] = await ethereum.request({ method: 'eth_requestAccounts' });
  try { await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.chainId }] }); }
  catch { await ethereum.request({ method: 'wallet_addEthereumChain', params: [CHAIN] }); }
  $('addr').textContent = addr; for (const b of ['buyAi', 'buyVps', 'login']) $(b).disabled = false;
}
async function buy(kind) {
  const p = plan.plans.find((x) => x.kind === kind);
  if (!confirm(`${kind.toUpperCase()} プラン（10日）を ${p.priceZnyt} ZNYT（テスト用・無価値）で買います。よろしいですか？`)) return;
  const out = $('buyOut'); out.hidden = false; out.textContent = 'ウォレットで確認してください…';
  try {
    const hash = await ethereum.request({ method: 'eth_sendTransaction', params: [{ from: addr, to: plan.address, value: weiHex(p.priceZnyt),
      data: SUBSCRIBE + p.kindId.toString(16).padStart(64, '0'), gas: '0x30d40', gasPrice: '0x3b9aca00' }] });
    out.textContent = `送信しました: ${hash}\n確認待ち…`;
    for (let i = 0; i < 60; i++) {
      await new Promise((s) => setTimeout(s, 2000));
      const r = await fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] }) }).then((x) => x.json());
      if (r.result) { out.textContent = `${r.result.status === '0x1' ? '✅ 購入できました' : '⚠️ 失敗しました'}: ${hash}（ブロック ${parseInt(r.result.blockNumber, 16)}）`; if (token) await me(); return; }
    }
  } catch (e) { out.textContent = 'キャンセルまたはエラー: ' + (e.message || e); }
}
async function login() {
  const ch = await api('/auth/challenge?address=' + addr); if (ch.error) return alert(ch.error);
  const signature = await ethereum.request({ method: 'personal_sign', params: [ch.message, addr] });
  const v = await api('/auth/verify', { method: 'POST', body: JSON.stringify({ nonce: ch.nonce, signature }) });
  if (!v.token) return alert(v.error); token = v.token; await me();
}
async function me() {
  const m = await api('/me'); if (m.error) return alert(m.error);
  $('me').hidden = false; $('me').textContent = `ログイン中: ${m.address}\nAI プラン: ${m.ai.active ? '有効 〜 ' + when(m.ai.expiry) : '無効'}\nVPS プラン: ${m.vps.active ? '有効 〜 ' + when(m.vps.expiry) : '無効'}`;
  $('aibox').hidden = !m.ai.active; $('vpsbox').hidden = !m.vps.active;
}
const history = [];
async function chat(e) {
  e.preventDefault(); const q = $('aiq').value.trim(); if (!q) return; history.push({ role: 'user', content: q }); $('aiq').value = '';
  const out = $('aiout'); out.textContent = '考えています…';
  const r = await fetch('/api/access/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ messages: history.slice(-8) }) });
  if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); out.textContent = 'エラー: ' + (j.error || r.status); return; }
  const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = '', ans = '', tier = '';
  for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; let d; try { d = JSON.parse(line); } catch { continue; }
      if (d.type === 'meta') tier = d.tier; else if (d.type === 'queue') out.textContent = `順番待ち（${d.position} 番目）`;
      else if (d.type === 'delta') { ans += d.t; out.textContent = ans; } else if (d.type === 'error') out.textContent = d.message || 'エラー'; } }
  history.push({ role: 'assistant', content: ans }); if (tier) out.textContent = ans + `\n\n（${tier === 'plan' ? 'プラン優先' : '無料枠'}で回答）`;
}
const vps = async (path, body) => { const r = await api('/vps/' + path, { method: path === 'status' ? 'GET' : 'POST', ...(path === 'status' ? {} : { body: JSON.stringify(body || {}) }) }); $('vout').textContent = r.out ?? JSON.stringify(r, null, 1); };
$('connect').onclick = () => connect().catch((e) => alert(e.message || e));
$('buyAi').onclick = () => buy('ai'); $('buyVps').onclick = () => buy('vps');
$('login').onclick = () => login().catch((e) => alert(e.message || e));
$('aiform').onsubmit = (e) => chat(e).catch((x) => { $('aiout').textContent = 'エラー: ' + x.message; });
$('vstart').onclick = () => { $('vout').textContent = '起動中…'; vps('start'); };
$('vstop').onclick = () => vps('stop'); $('vstatus').onclick = () => vps('status');
$('vform').onsubmit = (e) => { e.preventDefault(); $('vout').textContent = '実行中…'; vps('exec', { cmd: $('cmd').value }); };
loadPlans(); loadAccounting();
