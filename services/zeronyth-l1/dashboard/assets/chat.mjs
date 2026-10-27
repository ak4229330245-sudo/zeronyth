// ZERONYTH chat page. Talks to /api/ai/* (gateway -> loopback chat service -> Ollama). History lives only in this tab.
const $ = (id) => document.getElementById(id);
const log = $('log'), input = $('input'), send = $('send'), status = $('status'), consent = $('consent');
let history = []; let busy = false;
consent.checked = localStorage.getItem('znyt-ai-consent') === '1';
consent.addEventListener('change', () => localStorage.setItem('znyt-ai-consent', consent.checked ? '1' : '0'));
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const scroll = () => window.scrollTo({ top: document.body.scrollHeight });
const jst = (t) => (t ? new Date(t).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '（日本時間）' : 'まだなし');
async function refreshStatus() {
  try { const s = await (await fetch('api/ai/status')).json(); $('modelName').textContent = s.model || 'Qwen3 4B';
    status.textContent = `${s.busy ? '回答中' : '待機中'}${s.waiting ? `・順番待ち ${s.waiting}` : ''}${s.avgTokS ? `・約 ${s.avgTokS} トークン/秒` : ''}`;
    const L = s.learning; if (L && typeof L === 'object') $('learn').textContent = `学習メモリ ${L.memoryVersion}・覚えた内容 ${L.learnedItems} 件・最後に学習: ${jst(L.lastLearned)}・モデル: ${L.modelVersion === 'base' ? '基本モデル' : L.modelVersion}`; }
  catch { status.textContent = 'AI サーバーに接続できません'; }
}
function feedbackRow(id) {
  const row = el('div', 'c-fb'); row.append(el('span', '', 'この回答は？'));
  for (const [v, label] of [[1, '👍'], [-1, '👎']]) {
    const b = el('button', '', label); b.type = 'button'; b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', v > 0 ? '良い' : '良くない');
    b.addEventListener('click', async () => {
      row.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true');
      try { const r = await (await fetch('api/ai/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, rating: v }) })).json();
        note.textContent = r.stored ? 'ありがとうございます（保存しました）' : '保存されませんでした'; } catch { note.textContent = '送信できませんでした'; }
    });
    row.append(b);
  }
  const note = el('span'); row.append(note); return row;
}
async function ask(text) {
  if (busy || !text.trim()) return; busy = true; send.disabled = true; $('suggest').hidden = true;
  history.push({ role: 'user', content: text.trim() }); history = history.slice(-12);
  log.append(el('div', 'c-msg user', text.trim()));
  const box = el('div', 'c-msg ai'); const body = el('span', 'c-dots', '考え中'); box.append(body); log.append(box); scroll();
  let answer = '', meta = null, started = false;
  try {
    const r = await fetch('api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history, consent: consent.checked }) });
    if (r.status === 429) throw new Error('回数の上限に達しました。1 分ほど待ってからどうぞ。');
    if (!r.ok || !r.body) throw new Error('AI サーバーに接続できませんでした。');
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; const d = JSON.parse(line);
        if (d.type === 'meta') meta = d;
        else if (d.type === 'queue') body.textContent = `順番待ち（${d.position} 番目）`;
        else if (d.type === 'delta') { if (!started) { started = true; body.className = ''; body.textContent = ''; } answer += d.t; body.textContent = answer; scroll(); }
        else if (d.type === 'error') throw new Error(d.message || 'エラー');
      }
    }
    if (!answer) throw new Error('回答が空でした。');
    history.push({ role: 'assistant', content: answer });
    const kbSrc = (meta?.sources || []).filter((s) => !String(s.file).startsWith('learned:')), memN = (meta?.sources || []).length - kbSrc.length;
    if (meta?.sources?.length) box.append(el('div', 'c-meta', `参考にした資料: ${[...kbSrc.map((s) => s.title), ...(memN ? [`学習メモリ（${memN} 件）`] : [])].join(' / ')}`));
    else box.append(el('div', 'c-meta', '資料に該当なし（一般知識での回答。間違いに注意）'));
    if (meta?.consent) box.append(feedbackRow(meta.id));
  } catch (e) { box.className = 'c-msg err'; body.className = ''; body.textContent = e.message; history.pop(); }
  busy = false; send.disabled = false; input.focus(); refreshStatus();
}
$('form').addEventListener('submit', (e) => { e.preventDefault(); const t = input.value; input.value = ''; ask(t); });
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('form').requestSubmit(); } });
document.querySelectorAll('.c-chip').forEach((b) => b.addEventListener('click', () => ask(b.textContent)));
$('reset').addEventListener('click', () => { history = []; log.textContent = ''; $('suggest').hidden = false; });
refreshStatus(); setInterval(refreshStatus, 15000);
