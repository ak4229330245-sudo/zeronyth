// Tiny retrieval memory over kb/*.md (Japanese). Chunks = "# heading" sections. Scoring = BM25 over character
// bigrams (Japanese has no spaces) + lowercase ASCII words. No embeddings model needed; fast and deterministic.
// makeBm25() is also used for the learned-memory store (lib/memory.mjs).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
const norm = (s) => s.normalize('NFKC').toLowerCase();
export function terms(s) {
  const t = norm(s); const out = [];
  for (const w of t.match(/[a-z0-9.\-]{2,}/g) || []) out.push(w);
  const cjk = t.replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu, ' ');
  for (const seg of cjk.split(' ')) for (let i = 0; i + 1 < seg.length; i++) out.push(seg.slice(i, i + 2));
  return out;
}
// docs: [{text for indexing in .index, ...anything}] -> scorer
export function makeBm25(docs) {
  const df = new Map(); let total = 0; const tfs = [];
  for (const d of docs) { const ts = terms(d.index); total += ts.length; const tf = new Map(); for (const x of ts) tf.set(x, (tf.get(x) || 0) + 1); for (const x of tf.keys()) df.set(x, (df.get(x) || 0) + 1); tfs.push({ tf, len: ts.length }); }
  const avg = total / Math.max(1, docs.length), N = docs.length;
  return (q) => { const qs = [...new Set(terms(q))]; return tfs.map(({ tf, len }) => { let s = 0;
    for (const x of qs) { const f = tf.get(x); if (!f) continue; const idf = Math.log(1 + (N - df.get(x) + 0.5) / (df.get(x) + 0.5)); s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * len / avg)); }
    return s; }); };
}
export function loadKb(dir) {
  const chunks = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
    const text = readFileSync(path.join(dir, f), 'utf8');
    for (const part of text.split(/^(?=# )/m)) {
      const title = (part.match(/^# (.+)$/m) || [, f])[1].trim(); const body = part.replace(/^# .+$/m, '').trim();
      if (body) chunks.push({ id: `${f}#${chunks.length}`, file: f, title, text: body, index: title + ' ' + title + ' ' + body });
    }
  }
  const score = makeBm25(chunks);
  return {
    size: chunks.length, chunks,
    search(q, k = 3, minScore = 4.5) {
      const s = score(q); const scored = chunks.map((c, i) => ({ c, s: s[i] })).filter((x) => x.s >= minScore).sort((a, b) => b.s - a.s);
      const top = scored[0]?.s || 0;
      return scored.filter((x) => x.s >= top * 0.3).slice(0, k).map(({ c, s: sc }) => { const { index, ...rest } = c; return { ...rest, score: sc }; });
    },
  };
}
