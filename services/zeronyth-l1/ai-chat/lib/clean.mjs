// Output cleaner for the guide AI (applied to streamed deltas and to the stored answer).
// The small model sometimes copies retrieval markers from the system prompt ("【参考資料】", "[1]", "[M1]",
// "参考資料[2]") or stutters "24時間間". Markers are at most ~12 chars, so we hold back a 16-char tail
// while streaming; anything that could still become a marker is never emitted before it is cleaned.
const RULES = [
  // Site policy: points are described only by how to earn them and the rules; no talk of airdrops / future distribution.
  [/[^。！？!?\n]*(?:エアドロ|air\s*drop)[^。！？!?\n]*[。！？!?]?/gi, ''],
  [/[^。！？!?\n]*将来[^。！？!?\n]*(?:交換|配布)[^。！？!?\n]*[。！？!?]?/g, ''],
  [/[（(]\s*(?:参考資料|学習メモリ|出典|資料)\s*[:：]?\s*(?:\[\s*M?\d+\s*\](?:\s*[、,]\s*\[\s*M?\d+\s*\])*)?\s*[）)]/g, ''],
  [/【\s*(?:参考資料|学習メモリ)\s*】\s*/g, ''],
  [/(?:参考資料|学習メモリ)\s*\[\s*M?\d+\s*\]/g, ''],
  [/(?<![A-Za-z0-9_\])])\[\s*M?\d{1,2}\s*\](?!\()/g, ''],
  [/時間間(?!隔)/g, '時間'],
  [/[ \t]{2,}/g, ' '],
];
export const ASKS_AIRDROP = /エアドロ|air\s*drop|(ポイント|points?)[^。？?\n]{0,24}(将来|あとで|後で|いずれ|交換|換金|トークンに|配布|何に(なる|なります|変わる)|どうなる|価値が出)/i;
export const POINTS_ONLY_ANSWER = 'ポイントはテスト用で、お金としての価値はありません（売買・換金・譲渡はできません）。ノード稼働・バリデーター運用・テストネットでのスワップなどでたまり、ボットや自動化による不正は BAN されてポイントが無効になります。ため方とルールは points-rules.html を見てください。';
export function cleanText(s) { let out = String(s); for (const [re, to] of RULES) out = out.replace(re, to); return out; }
export function createStreamCleaner(emit, hold = 24, maxWait = 120) {
  // Emit up to the last sentence boundary (。！？ or newline) that leaves `hold` chars behind; markers never span a
  // sentence end. If a sentence runs very long, fall back to cutting `hold` chars from the end.
  let pending = '';
  const out = (t) => { const c = cleanText(t); if (c) emit(c); };
  return {
    push(t) {
      pending += t;
      const limit = pending.length - hold;
      if (limit <= 0) return;
      let cut = -1;
      for (let i = limit - 1; i >= 0; i--) if ('。！？!?\n'.includes(pending[i])) { cut = i + 1; break; }
      if (cut < 0 && pending.length > maxWait) cut = limit;
      if (cut > 0) { out(pending.slice(0, cut)); pending = pending.slice(cut); }
    },
    flush() { const rest = pending; pending = ''; const c = cleanText(rest).replace(/\s+$/, ''); if (c) emit(c); },
  };
}
