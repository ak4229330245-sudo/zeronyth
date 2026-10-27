// Testnet points page. Login = the access service's EIP-191 signature login (never asks for keys).
const $ = (id) => document.getElementById(id);
const CHAIN = { chainId: '0x23a7', chainName: 'ZERONYTH Testnet', nativeCurrency: { name: 'ZNYT', symbol: 'ZNYT', decimals: 18 }, rpcUrls: [location.origin + '/rpc'], blockExplorerUrls: ['https://scan.zeronyth.dpdns.org'] };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let token = sessionStorage.getItem('znyt-access-token'), addr = null, rules = null;
const get = (base, p, o = {}) => fetch(base + p, { ...o, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } })
  .then(async (r) => { const j = await r.json().catch(() => ({ error: 'HTTP ' + r.status })); if (!r.ok && !j.error) j.error = 'HTTP ' + r.status; j._status = r.status; return j; });
const pts = (p, o) => get('/api/points', p, o), acc = (p, o) => get('/api/access', p, o);
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('ja-JP');
const STATUS = { eligible: '対象', team: 'チーム（対象外）', system: '運営アドレス', banned: 'BAN（確定・ポイント没収）', suspended: 'BAN（審査中）', held: '確認待ち（保留）' };

async function loadRules() {
  rules = await pts('/rules'); if (rules.error) { $('order').textContent = '読み込めませんでした'; return; }
  const o = rules.ordering;
  $('order').innerHTML = `<span>バリデーター 最大 ${o.validator}/日</span>＞<span class="pt-top">ノード稼働 最大 ${o.node}/日</span>＞<span>その他すべての合計 最大 ${o.othersCombined}/日</span>`;
}
async function loadBoard() {
  const b = await pts('/leaderboard?n=50'); if (b.error) { $('leaderboard').innerHTML = `<tr><td>${esc(b.error)}</td></tr>`; return; }
  $('lbnote').textContent = `参加者 ${b.participants} 人（${b.note}）`;
  $('leaderboard').innerHTML = '<tr><th>順位</th><th>アドレス</th><th>ポイント</th></tr>' + (b.top.length ? b.top.map((r) => `<tr><td>${r.rank}</td><td><code>${esc(r.address)}</code></td><td>${fmt(r.points)}</td></tr>`).join('') : '<tr><td colspan="3">まだいません</td></tr>');
}
async function loadSnaps() {
  const s = await pts('/snapshots'); if (s.error) return;
  $('snaps').innerHTML = '<tr><th>日付</th><th>人数</th><th>Merkle ルート</th><th>チェーン上の記録</th></tr>' + (s.snapshots.length ? s.snapshots.slice(0, 14).map((x) =>
    `<tr><td><a href="/api/points/snapshot?day=${esc(x.name)}">${esc(x.day)}${x.partial ? '（途中）' : ''}</a></td><td>${x.eligibleCount}</td><td><code>${esc(x.merkleRoot.slice(0, 18))}…</code></td><td>${x.tx ? `<code>${esc(x.tx.slice(0, 14))}…</code>` : esc(x.publishError || '未送信')}</td></tr>`).join('') : '<tr><td colspan="4">最初の記録は日本時間 0 時すぎに作られます</td></tr>');
}
async function connect() {
  if (!window.ethereum) return alert('ウォレット（MetaMask、OKX など）が見つかりません');
  [addr] = await ethereum.request({ method: 'eth_requestAccounts' });
  try { await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.chainId }] }); } catch { await ethereum.request({ method: 'wallet_addEthereumChain', params: [CHAIN] }); }
  $('addr').textContent = addr; $('login').disabled = false;
  if (token) { const ok = await showMe(true); if (ok) return; }
}
async function login() {
  const ch = await acc('/auth/challenge?address=' + addr); if (ch.error) return alert(ch.error);
  const signature = await ethereum.request({ method: 'personal_sign', params: [ch.message, addr] });
  const v = await acc('/auth/verify', { method: 'POST', body: JSON.stringify({ nonce: ch.nonce, signature }) });
  if (!v.token) return alert(v.error); token = v.token; sessionStorage.setItem('znyt-access-token', token); await showMe();
}
function render(m) {
  $('mine').hidden = false; $('total').textContent = fmt(m.total); $('rank').textContent = m.rank ? `${m.rank} 位 / ${m.participants} 人` : '-';
  $('status').textContent = STATUS[m.status] || m.status; $('status').className = m.status === 'eligible' ? 'pt-ok' : 'pt-bad';
  $('checkin').disabled = m.checkedInToday; $('checkin').textContent = m.checkedInToday ? '済み ✅' : 'チェックイン（+1）';
  $('factor').textContent = (m.factor < 1 ? `新しいウォレット（蛇口の ZNYT だけ）のため、最初の ${rules?.antiSybil?.faucetOnlyUntilDays ?? 3} 日間はポイントが ${m.factor} 倍になります。` : '') + (m.reason ? ` 理由: ${m.reason}` : '');
  const bn = $('ban-notice'), ban = m.ban;
  bn.hidden = !ban;
  if (ban) bn.innerHTML = `<h3>${esc(STATUS[m.status] || m.status)}</h3><p>${ban.underReview
      ? 'ボットや自動スクリプトのような取引の動きが自動チェックの基準を超えたため、ポイントの加算を止めています（ランキングにも表示されません）。運営が確認して、BAN の確定（ポイント没収）か解除を決めます。'
      : 'このウォレットは BAN が確定しています。ポイントは没収され、ランキングと毎日の記録の対象外です。'}</p>` +
    (ban.evidence?.length ? `<p class="p-small">自動チェックの根拠：</p><ul class="p-small">${ban.evidence.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '') +
    '<p class="p-small">ボットや自動スクリプトで取引を繰り返してポイントを稼ぐ行為は BAN 対象です。ポイントは没収します。誤りだと思う場合は、ウォレットのアドレスを添えて管理者へ異議を伝えてください。<a href="points-rules.html#bot-ban">ルール</a></p>';
  const cats = rules?.categories || {};
  $('breakdown').innerHTML = '<tr><th>項目</th><th>合計</th><th>今日 / 上限</th></tr>' + Object.entries(cats).map(([k, c]) => {
    const t = m.today[k] || { earned: 0, cap: c.dailyCap }; const pct = t.cap ? Math.min(100, (t.earned / t.cap) * 100) : 0;
    return `<tr><td>${esc(c.label)}</td><td>${fmt(m.breakdown[k] || 0)}</td><td>${fmt(t.earned)} / ${t.cap ?? '上限なし'}${t.cap ? `<div class="pt-bar"><i data-pct="${pct}"></i></div>` : ''}</td></tr>`; }).join('');
  for (const i of $('breakdown').querySelectorAll('[data-pct]')) i.style.width = i.dataset.pct + '%';
}
async function showMe(silent) {
  const m = await pts('/me'); if (m.error) { if (m._status === 401) { token = null; sessionStorage.removeItem('znyt-access-token'); } if (!silent) alert(m.error); return false; }
  render(m); return true;
}
async function checkin() { const r = await pts('/checkin', { method: 'POST', body: '{}' }); if (r.error) return alert(r.error); render(r.me); }
$('connect').onclick = () => connect().catch((e) => alert(e.message || e));
$('login').onclick = () => login().catch((e) => alert(e.message || e));
$('checkin').onclick = () => checkin().catch((e) => alert(e.message || e));
await loadRules(); loadBoard(); loadSnaps();
