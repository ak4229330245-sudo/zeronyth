// ZERONYTH testnet bridge UI (ZNYT <-> wZNYT). No secrets; only the user's own wallet signs.
const $ = (id) => document.getElementById(id);
const HOME = { chainId: 9127, hex: '0x23a7', name: 'ZERONYTH Testnet', rpc: location.origin + '/rpc', symbol: 'ZNYT' };
const SEL = { lock: '0x496a36f2', burn: '0xfcd3533c', balanceOf: '0x70a08231' };
const STATUS_JA = { live: '稼働中', 'waiting-for-gas': 'ガス待ち', planned: '予定' };
const state = { status: null, wallets: [], provider: null, account: null, chainId: null, pollTimer: null };

function msg(text, kind = 'info') { const el = $('br-msg'); el.textContent = text; el.dataset.kind = kind; }
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v); }
  for (const k of kids) n.append(k);
  return n;
}
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
const hex64 = (v) => BigInt(v).toString(16).padStart(64, '0');

function parseAmount(s) { // decimal string -> wei bigint (18 decimals)
  const t = String(s || '').trim();
  if (!/^\d+(\.\d{1,18})?$/.test(t)) return null;
  const [i, f = ''] = t.split('.');
  return BigInt(i) * 10n ** 18n + BigInt((f + '0'.repeat(18)).slice(0, 18));
}
function fmt(wei) {
  const w = BigInt(wei); const i = w / 10n ** 18n; let f = (w % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return f ? `${i}.${f.slice(0, 6)}` : `${i}`;
}

function remotes() { return (state.status?.remotes || []).filter((r) => !r.standIn && r.status !== 'retired-stand-in'); }
function liveRemotes() { return remotes().filter((r) => r.status === 'live' && r.vaultEnabled); }
function remoteById(chainId) { return remotes().find((r) => r.chainId === Number(chainId)); }
function txLink(chainId, hash) {
  if (!hash) return document.createTextNode('—');
  if (Number(chainId) === HOME.chainId) return el('span', { class: 'br-mono', text: `${short(hash)} (ZERONYTH)`, title: hash });
  const r = remoteById(chainId);
  if (!r?.explorer) return el('span', { class: 'br-mono', text: short(hash), title: hash });
  return el('a', { href: `${r.explorer}/tx/${hash}`, target: '_blank', rel: 'noopener', text: short(hash), title: hash });
}

async function loadStatus() {
  try {
    const res = await fetch('/api/bridge/status', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.status = await res.json();
    renderStatus();
  } catch (e) { $('br-health').textContent = `ブリッジ API に接続できません (${e.message})`; }
}

function renderStatus() {
  const s = state.status;
  const live = liveRemotes();
  $('br-health').textContent = `${live.length ? `${live.length} チェーン稼働中` : '現在、稼働中の相手チェーンはありません（ガス待ち）'} · 署名 ${s.threshold}-of-${s.relayers.length}${s.vaultPaused ? ' · 一時停止中' : ''}`;
  $('br-caps').textContent = `1 回: ${s.caps.minZnyt} 〜 ${s.caps.maxPerTxZnyt} ZNYT · 1 日あたり（チェーン毎）: ${s.caps.dailyPerChainZnyt} ZNYT`;
  const box = $('br-chains'); box.replaceChildren();
  const list = [...remotes(), { name: 'Solana Devnet', chainId: 'devnet', status: 'planned' }];
  for (const r of list) {
    const st = r.status === 'live' && r.vaultEnabled ? 'live' : r.status === 'planned' ? 'planned' : 'waiting-for-gas';
    const card = el('div', { class: 'br-chain', role: 'listitem' },
      el('strong', { text: r.name }),
      el('span', { class: `eco-status ${st === 'live' ? 'live' : st === 'planned' ? 'unsupported' : 'pending'}`, text: STATUS_JA[st] }),
      el('code', { text: `chain ${r.chainId}` }));
    if (r.token) card.append(el('code', { text: `wZNYT ${r.token}` }));
    if (st === 'planned') card.append(el('span', { class: 'small muted', text: 'SPL トークン + 2-of-3 検証プログラムを設計中（未実装）' }));
    box.append(card);
  }
  const sel = $('br-chain'); const prev = sel.value; sel.replaceChildren();
  const isOk = (r) => r.status === 'live' && r.vaultEnabled;
  const opts = [...remotes()].sort((a, b) => Number(isOk(b)) - Number(isOk(a)));
  if (!opts.some(isOk)) sel.append(el('option', { value: '', text: '稼働中のチェーンはまだありません' }));
  for (const r of opts) {
    const ok = isOk(r);
    const o = el('option', { value: String(r.chainId), text: `${r.name}${ok ? '' : '（ガス待ち・選択不可）'}` });
    if (!ok) o.disabled = true;
    sel.append(o);
  }
  if (prev && [...sel.options].some((o) => o.value === prev && !o.disabled)) sel.value = prev;
  else { const first = [...sel.options].find((o) => !o.disabled); sel.value = first ? first.value : ''; }
  $('br-contracts').replaceChildren(el('span', { text: 'コントラクト: ' }),
    el('code', { class: 'br-mono', text: `Vault (9127) ${s.home.vault} · BridgeMinter ${s.minter} · wZNYT ${s.token}` }), el('span', { text: '（全チェーン同一アドレス, CREATE2）' }));
  updateButtons();
}

// ---------- wallets ----------
function discoverWallets() {
  const found = [];
  window.addEventListener('eip6963:announceProvider', (ev) => {
    const { info, provider } = ev.detail || {};
    if (provider && !found.some((w) => w.provider === provider)) { found.push({ name: info?.name || 'Wallet', provider }); renderWallets(found); }
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  setTimeout(() => {
    if (window.okxwallet && !found.some((w) => w.provider === window.okxwallet)) found.push({ name: 'OKX Wallet', provider: window.okxwallet });
    if (window.ethereum && !found.some((w) => w.provider === window.ethereum)) found.push({ name: window.ethereum.isMetaMask ? 'MetaMask' : 'ブラウザウォレット', provider: window.ethereum });
    renderWallets(found);
  }, 400);
  state.wallets = found;
}
function renderWallets(found) {
  const sel = $('br-wallet'); const prev = sel.value; sel.replaceChildren();
  if (!found.length) sel.append(el('option', { value: '', text: 'ウォレットが見つかりません（OKX Wallet / MetaMask をインストール）' }));
  found.forEach((w, i) => sel.append(el('option', { value: String(i), text: w.name })));
  if (prev && sel.querySelector(`option[value="${prev}"]`)) sel.value = prev;
  updateButtons();
}
async function connect() {
  const w = state.wallets[Number($('br-wallet').value)];
  if (!w) { msg('ウォレットが見つかりません。OKX Wallet か MetaMask をインストールしてください。', 'error'); return; }
  try {
    const accounts = await w.provider.request({ method: 'eth_requestAccounts' });
    state.provider = w.provider; state.account = accounts[0];
    state.chainId = Number(await w.provider.request({ method: 'eth_chainId' }));
    w.provider.on?.('accountsChanged', (a) => { state.account = a[0] || null; updateButtons(); loadHistory(); });
    w.provider.on?.('chainChanged', (c) => { state.chainId = Number(c); updateButtons(); });
    $('br-wallet-state').textContent = `接続済み ${short(state.account)}`; $('br-wallet-state').className = 'eco-status documented';
    msg('接続しました。秘密鍵やシードフレーズは絶対に入力しないでください。', 'ok');
    updateButtons(); loadHistory();
  } catch (e) { msg(`接続できませんでした: ${e.message || e}`, 'error'); }
}
async function ensureChain(chain) {
  const want = '0x' + Number(chain.chainId).toString(16);
  try { await state.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] }); }
  catch (e) {
    if (e?.code !== 4902 && !/unrecognized|not added|unknown chain/i.test(e?.message || '')) throw e;
    await state.provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: want, chainName: chain.name, rpcUrls: [chain.rpc], nativeCurrency: { name: chain.symbol, symbol: chain.symbol, decimals: 18 }, blockExplorerUrls: chain.explorer ? [chain.explorer] : undefined }] });
  }
  state.chainId = Number(await state.provider.request({ method: 'eth_chainId' }));
  if (state.chainId !== Number(chain.chainId)) throw new Error('ウォレットのネットワークを切り替えてください');
}
const GAS_SYMBOL = { 97: 'tBNB', 10143: 'MON' };
const remoteChainParams = (r) => ({ chainId: r.chainId, name: r.name, rpc: r.rpc, symbol: GAS_SYMBOL[r.chainId] || 'ETH', explorer: r.explorer });

function updateButtons() {
  const connected = Boolean(state.account);
  $('br-connect').disabled = connected || !state.wallets.length;
  const live = liveRemotes().length > 0 && !state.status?.vaultPaused;
  $('br-submit').disabled = !connected || !live;
  $('br-add-token').disabled = !connected || !$('br-chain').value;
  if (connected && !live) msg('現在、送金できる相手チェーンがありません（各テストネットのガス待ち）。', 'info');
  refreshBalance();
}
async function refreshBalance() {
  const out = $('br-balance'); out.textContent = '';
  if (!state.account || !state.provider) return;
  try {
    if ($('br-direction').value === 'out' && state.chainId === HOME.chainId) {
      const b = await state.provider.request({ method: 'eth_getBalance', params: [state.account, 'latest'] });
      out.textContent = `残高: ${fmt(b)} ZNYT`;
    } else if ($('br-direction').value === 'in' && state.chainId === Number($('br-chain').value)) {
      const r = remoteById(state.chainId);
      const b = await state.provider.request({ method: 'eth_call', params: [{ to: r.token, data: SEL.balanceOf + hex64(state.account) }, 'latest'] });
      out.textContent = `残高: ${fmt(b)} wZNYT`;
    }
  } catch { /* balance is informational only */ }
}

// ---------- transfer ----------
function setStep(n, cls, detail) {
  const li = $('br-steps').querySelector(`[data-step="${n}"]`);
  li.className = cls || ''; const d = li.querySelector('[data-detail]'); d.replaceChildren();
  if (detail instanceof Node) d.append(detail); else d.textContent = detail ?? '—';
}
function resetSteps() { setStep(1, '', '未開始'); setStep(2, '', '—'); setStep(3, '', '—'); }

async function waitReceipt(hash) {
  for (let i = 0; i < 180; i++) {
    const r = await state.provider.request({ method: 'eth_getTransactionReceipt', params: [hash] });
    if (r) return r;
    await new Promise((ok) => setTimeout(ok, 2000));
  }
  throw new Error('受領確認がタイムアウトしました');
}
function nonceFromReceipt(receipt, emitter) {
  const log = (receipt.logs || []).find((l) => l.address?.toLowerCase() === emitter.toLowerCase() && l.topics?.length >= 2);
  return log ? BigInt(log.topics[1]).toString() : null;
}

async function submit(ev) {
  ev.preventDefault();
  const s = state.status; const amount = parseAmount($('br-amount').value);
  const r = remoteById($('br-chain').value);
  if (!r || r.status !== 'live' || !r.vaultEnabled) return msg('このチェーンはまだ稼働していません。', 'error');
  if (amount === null) return msg('数量を正しく入力してください（例: 1.5）。', 'error');
  if (amount < parseAmount(s.caps.minZnyt) || amount > parseAmount(s.caps.maxPerTxZnyt)) return msg(`1 回の数量は ${s.caps.minZnyt} 〜 ${s.caps.maxPerTxZnyt} です。`, 'error');
  resetSteps(); $('br-submit').disabled = true;
  try {
    let srcChain, hash, emitter;
    if ($('br-direction').value === 'out') {
      await ensureChain(HOME); srcChain = HOME.chainId; emitter = s.home.vault;
      msg('ウォレットで「ロック」取引を承認してください…');
      hash = await state.provider.request({ method: 'eth_sendTransaction', params: [{ from: state.account, to: s.home.vault, value: '0x' + amount.toString(16), data: SEL.lock + hex64(r.chainId) + hex64(state.account) }] });
    } else {
      await ensureChain(remoteChainParams(r)); srcChain = r.chainId; emitter = s.minter;
      msg('ウォレットで「バーン」取引を承認してください…');
      hash = await state.provider.request({ method: 'eth_sendTransaction', params: [{ from: state.account, to: s.minter, data: SEL.burn + hex64(amount) + hex64(state.account) }] });
    }
    setStep(1, 'active', txLink(srcChain, hash)); msg('送信しました。ブロック取り込みを待っています…');
    const receipt = await waitReceipt(hash);
    if (receipt.status !== '0x1') throw new Error('取引が失敗しました（上限・一時停止・残高を確認してください）');
    const nonce = nonceFromReceipt(receipt, emitter);
    setStep(1, 'done', txLink(srcChain, hash));
    if (nonce === null) throw new Error('イベントが見つかりません');
    track(`${srcChain}-${nonce}`);
  } catch (e) { setStep(1, 'fail', e.message || String(e)); msg(`エラー: ${e.message || e}`, 'error'); }
  finally { updateButtons(); }
}

function track(id) {
  clearInterval(state.pollTimer);
  setStep(2, 'active', '確定（finalized）とリレイヤー署名を待っています…'); msg(`追跡中: ${id}`);
  const tick = async () => {
    try {
      const res = await fetch(`/api/bridge/transfer?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!res.ok) return; // not seen yet (waiting for finality)
      const t = await res.json();
      if (t.signatures) setStep(2, 'done', el('a', { href: `/api/bridge/attestations?id=${encodeURIComponent(id)}`, target: '_blank', rel: 'noopener', text: `${t.signatures} 署名（ECDSA + ML-DSA-65 ログ）` }));
      if (t.status === 'attested') setStep(3, 'active', t.submitTx ? txLink(t.dstChainId, t.submitTx) : '送信待ち…');
      if (t.status === 'minted' || t.status === 'released') {
        setStep(3, 'done', txLink(t.dstChainId, t.dstTx));
        msg(t.status === 'minted' ? '完了: wZNYT がミントされました。「wZNYT をウォレットに追加」で表示できます。' : '完了: ZNYT が返却されました。', 'ok');
        clearInterval(state.pollTimer); loadHistory();
      }
    } catch { /* keep polling */ }
  };
  tick(); state.pollTimer = setInterval(tick, 5000);
}

async function loadHistory() {
  const box = $('br-history');
  if (!state.account) return;
  try {
    const res = await fetch(`/api/bridge/transfers?address=${encodeURIComponent(state.account)}`, { cache: 'no-store' });
    const { transfers = [] } = await res.json();
    const rows = transfers.filter((t) => !String(t.srcChainId).startsWith('31337') && !String(t.dstChainId).startsWith('31337'));
    if (!rows.length) { box.replaceChildren(el('p', { class: 'small muted', text: 'まだ送金はありません。' })); return; }
    const table = el('table', {}, el('thead', {}, el('tr', {}, ...['ID', '方向', '数量', '状態', '送金元 tx', '着金 tx'].map((h) => el('th', { text: h })))));
    const tb = el('tbody');
    const ja = { locked: 'ロック済み', burned: 'バーン済み', attested: '署名済み', minted: 'ミント完了', released: '返却完了' };
    for (const t of rows) {
      const btn = el('button', { type: 'button', class: 'btn ghost', text: t.id }); btn.addEventListener('click', () => track(t.id));
      tb.append(el('tr', {}, el('td', {}, btn), el('td', { text: `${t.srcChainId} → ${t.dstChainId}` }), el('td', { text: fmt(t.amount) }), el('td', { text: ja[t.status] || t.status }), el('td', {}, txLink(t.srcChainId, t.srcTx)), el('td', {}, txLink(t.dstChainId, t.dstTx))));
    }
    table.append(tb); box.replaceChildren(table);
  } catch { box.replaceChildren(el('p', { class: 'small muted', text: '履歴を読み込めませんでした。' })); }
}

async function addToken() {
  const r = remoteById($('br-chain').value);
  if (!r || !state.provider) return;
  try {
    await ensureChain(remoteChainParams(r));
    await state.provider.request({ method: 'wallet_watchAsset', params: { type: 'ERC20', options: { address: r.token, symbol: 'wZNYT', decimals: 18 } } });
    msg(`wZNYT (${r.name}) をウォレットに追加しました。`, 'ok');
  } catch (e) { msg(`追加できませんでした: ${e.message || e}`, 'error'); }
}
async function addHome() {
  if (!state.provider) { await connect(); if (!state.provider) return; }
  try { await ensureChain(HOME); msg('ZERONYTH Testnet (9127) に切り替えました。', 'ok'); updateButtons(); }
  catch (e) { msg(`追加できませんでした: ${e.message || e}`, 'error'); }
}

$('br-connect').addEventListener('click', connect);
$('br-add-home').addEventListener('click', addHome);
$('br-add-token').addEventListener('click', addToken);
$('br-form').addEventListener('submit', submit);
$('br-direction').addEventListener('change', refreshBalance);
$('br-chain').addEventListener('change', updateButtons);
discoverWallets(); loadStatus(); setInterval(loadStatus, 30000);

// ---- Relayer set / timelock panel (reads /api/bridge/relayers; read-only) ----
const MACHINE_JA = { box: 'box（メインサーバー）', vps: 'ABLENET VPS' };
function fmtDelay(sec) { const s = Number(sec); if (!s) return '0'; return s % 3600 === 0 ? `${s / 3600} 時間` : `${s} 秒`; }
async function loadRelayers() {
  let d;
  try {
    let res = await fetch('/api/bridge/relayers', { cache: 'no-store' });
    if (res.ok) d = await res.json();
    else { res = await fetch('/api/bridge/status', { cache: 'no-store' }); if (!res.ok) throw new Error(res.status); d = (await res.json()).relayerSet; }
    if (!d || !d.relayers) throw new Error('not loaded');
  }
  catch (e) { $('br-rel-state').textContent = '取得できません'; return; }
  const t = `${d.threshold}-of-${d.total}`;
  $('br-step-threshold').textContent = t;
  $('br-trust-threshold').textContent = `${d.total} 人中 ${d.threshold} 人`;
  const st = $('br-rel-state');
  st.textContent = d.noSingleMachineCanSign ? '1 台では署名不可' : '1 台で署名可能（未分散）';
  st.className = `eco-status ${d.noSingleMachineCanSign ? 'ok' : 'pending'}`;
  const machines = Object.entries(d.byMachine || {}).map(([m, n]) => `${MACHINE_JA[m] || m}: ${n} 鍵`).join(' / ');
  const ops = Object.entries(d.byOperator || {}).map(([o, n]) => `${o}: ${n} 鍵`).join(' / ');
  $('br-rel-summary').textContent = `しきい値 ${t}。マシン別 — ${machines}。運営者別 — ${ops}。${d.noSingleOperatorCanSign ? '1 運営者では署名不可。' : '現在は 1 運営者がしきい値を満たせます（外部オペレーター待ち）。'}`;
  const tb = el('tbody');
  for (const r of d.relayers || []) {
    tb.append(el('tr', {}, el('td', { text: r.label || '—' }), el('td', { text: MACHINE_JA[r.machine] || r.machine || '—' }),
      el('td', { title: r.address, text: short(r.address) }), el('td', { title: r.mldsaPkSha256 || '', text: r.mldsaPkSha256 ? short(r.mldsaPkSha256) : '未登録' }),
      el('td', {}, r.registeredTx ? txLink(HOME.chainId, r.registeredTx) : document.createTextNode('—'))));
  }
  const table = el('table', {}, el('thead', {}, el('tr', {}, ...['名前', 'マシン', 'アドレス', 'ML-DSA 公開鍵 (sha256)', '掲示板登録 tx'].map((h) => el('th', { text: h })))), tb);
  $('br-rel-table').replaceChildren(table);
  const cb = el('tbody');
  for (const c of d.perChain || []) {
    cb.append(el('tr', {}, el('td', { text: c.name || c.chainId }), el('td', { text: `${c.threshold}-of-${(c.relayers || []).length}` }),
      el('td', { title: c.owner || '', text: c.ownerIsTimelock ? `タイムロック ${short(c.owner)}` : `管理者 ${short(c.owner)}` })));
  }
  $('br-rel-chains').replaceChildren(el('table', {}, el('thead', {}, el('tr', {}, ...['チェーン', 'しきい値', 'オーナー'].map((h) => el('th', { text: h })))), cb));
  const tl = d.timelock;
  $('br-rel-timelock').textContent = tl
    ? `タイムロック: リレイヤー変更・停止解除・上限変更はすべて ${fmtDelay(tl.minDelaySeconds)} の遅延付き。提案者 ${short(tl.proposer)}、キャンセル可能 ${(tl.cancellers || []).map(short).join(', ')}。予約中の操作は公開され、実行前に誰でも確認できます。`
    : 'タイムロック: 未設定（現在は管理者鍵が即時に変更可能）';
  $('br-rel-pause').textContent = `緊急停止: ${d.pauseIsInstant || '—'}`;
  $('br-rel-rule').textContent = `しきい値ルール: ${d.thresholdRule || '—'}`;
}
loadRelayers(); setInterval(loadRelayers, 60000);
