// Rules page: renders live weights/caps from /api/points/rules (points/points.config.json on the server).
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r = await fetch('/api/points/rules').then((x) => x.json()).catch(() => null);
if (!r || r.error) { $('order').textContent = '読み込めませんでした'; } else {
  const o = r.ordering;
  $('order').innerHTML = `<span>バリデーター 最大 ${o.validator}/日</span>＞<span class="pt-top">ノード稼働 最大 ${o.node}/日</span>＞<span>その他すべての合計 最大 ${o.othersCombined}/日</span>`;
  const how = (k, c) => ({ validator: `1時間ごと ${c.pointsPerHourProposing} 点`, node: `認定された5分エポックごと ${c.pointsPerCreditedEpoch} 点`, swap: `1回 ${c.pointsPerSwap} 点（${c.fullRateSwaps}回まで、以降 ${c.pointsPerSwapAfter} 点）＋ 出来高ボーナス`,
    lp: `1時間ごと ${c.pointsPerSqrtZnytHour}×√評価額`, tx: `1件 ${c.pointsPerTx} 点`, plan: `1 ZNYT ごと ${c.pointsPerZnyt} 点（生涯上限 ${c.lifetimeCap}）`, planUse: `AIチャット 1回 ${c.pointsPerAiChat} 点／VPS起動 ${c.pointsPerVpsStart} 点`,
    aiFeedback: `採用 1件 ${c.pointsPerAccepted} 点`, checkin: `1日 ${c.points} 点`, admin: '運営が理由を記録して付与' }[k] || '');
  $('cats').innerHTML = '<tr><th>項目</th><th>もらえる量</th><th>1日の上限</th></tr>' + Object.entries(r.categories).map(([k, c]) =>
    `<tr><td><b>${esc(c.label)}</b>${c.note ? `<br><span class="p-small">${esc(c.note)}</span>` : ''}</td><td>${esc(how(k, c))}</td><td>${c.dailyCap == null ? '個別' : esc(c.dailyCap)}</td></tr>`).join('');
  $('sha').textContent = (r.configSha256 || '').slice(0, 16);
  const a = r.antiSybil;
  $('sybil').innerHTML = [`同じ回線（IP）から 1 日に新しく参加できるウォレットは ${a.maxNewWalletsPerIpPerDay} 個まで。それを超えると確認待ち（保留）になります。`,
    `蛇口で受け取っただけの新しいウォレットは、最初の ${a.faucetOnlyUntilDays} 日間はポイントが ${a.faucetOnlyFactor} 倍になります（ノード稼働などの実績があれば通常に戻ります）。`,
    'ノードのハートビートは耐量子署名で本人確認され、コーディネーターが検証したものだけが数えられます。',
    '自分宛ての送金、同じ回線・端末グループ間の送金、短時間の往復売買はポイントになりません。',
    '極端に多い数値は自動でチェック対象になり、運営が理由を記録したうえで停止・没収することがあります。'].map((t) => `<li>${esc(t)}</li>`).join('');
  const b = r.antiBot;
  if (b?.enabled) { const h = (s) => s >= 3600 ? `${s / 3600} 時間` : s >= 60 ? `${s / 60} 分` : `${s} 秒`;
    $('antibot').innerHTML = [`直近 ${h(b.windowSec)} の動きを点数化し、合計 <b>${b.suspendScore} 点以上で自動的に BAN（審査中）</b>、${b.flagScore} 点以上で運営の確認対象になります。`,
      `取引の回数が多すぎる：1 時間に ${b.frequency.perHour} 件以上で ${b.frequency.pts} 点（${b.frequency.perHourHigh} 件以上は ${b.frequency.ptsHigh} 点）、1 日 ${b.frequency.perDay} 件以上で ${b.frequency.ptsDay} 点`,
      `間隔が機械的に一定：続けて ${b.regular.lastN} 件の間隔のばらつきが ${Math.round(b.regular.maxCv * 100)}% 以下で ${b.regular.pts} 点`,
      `小さく同じ額のくり返し：直近 ${b.sameSize.lastN} 件の ${Math.round(b.sameSize.share * 100)}% 以上がほぼ同じ額（±${b.sameSize.tolerance * 100}%、${b.sameSize.maxMedianZnyt} ZNYT 以下）で ${b.sameSize.pts} 点`,
      `往復スワップ：${b.pingPong.count} 回以上で ${b.pingPong.pts} 点（${b.pingPong.high} 回以上は ${b.pingPong.ptsHigh} 点）`,
      `流動性の追加→引き出しのくり返し：${b.lpCycle.cycles} 回以上で ${b.lpCycle.pts} 点`,
      `ウォレットのまとまり：同じ送金元・同じ回線のウォレットが ${b.cluster.minSize} 個以上で ${b.cluster.pts} 点、つながったウォレットが BAN 中なら ${b.cluster.suspendedMemberPts} 点（まとまりの点数だけでは BAN になりません）`,
      'まとまり（同じ送金元・同じ回線）のほかのウォレットは、運営が確認して確定したときだけ一緒に BAN されます。運営・チームのアドレスは対象外です。'].map((t) => `<li>${t}</li>`).join(''); }
  else $('antibot').innerHTML = '<li>自動チェックは現在停止中です。</li>';
}
