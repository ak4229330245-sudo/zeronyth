// learning.html: read-only AI learning status (moved out of inline script for CSP).
const $ = (id) => document.getElementById(id);
const jst = (t) => (t ? new Date(t).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) + '（日本時間）' : 'まだなし');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function load() {
  try {
    const s = await (await fetch('api/ai/status', { cache: 'no-store' })).json(); const L = s.learning || {};
    const ft = L.fineTune || {};
    const cards = [['学習メモリの版', L.memoryVersion], ['覚えた内容', `${L.learnedItems ?? 0} 件`], ['最後に学習した時刻', jst(L.lastLearned)], ['最後に学習を確認した時刻', jst(L.lastRun)],
      ['テスト（評価セット）', L.eval?.gate ? `${L.eval.gate} 合格` : '—'], ['はじいた件数（累計）', `${L.rejectedTotal ?? 0} 件`], ['見直し待ち', `${L.reviewQueue ?? 0} 件`],
      ['使っているモデル', s.model], ['モデルの版', L.modelVersion === 'base' ? '基本モデル' : L.modelVersion], ['モデル追加学習（最後）', ft.at ? `${jst(ft.at)}・${ft.result || ''}` : 'まだなし'],
      ['意味検索', L.embedding], ['会話を保存した数（起動後）', `${s.consented ?? 0} 件`]];
    $('cards').innerHTML = cards.map(([k, v]) => `<div class="lg-card"><small>${esc(k)}</small><b>${esc(v ?? '—')}</b></div>`).join('');
    $('updated').textContent = `更新: ${jst(new Date().toISOString())}・スケジュール: ${L.schedule ? `${L.schedule.learner} / ${L.schedule.fineTune}` : '—'}`;
  } catch { $('cards').innerHTML = '<div class="lg-card"><small>AI サーバーに接続できません</small></div>'; }
}
load(); setInterval(load, 60000);
