// Learned memory: versioned Q&A store grown by learner.mjs from opted-in, 👍-rated, filtered conversations (and
// operator-approved answers to review-queue items). The chat retrieves from it next to kb/.
//   <data>/learned/versions/vNNNN.json  immutable snapshots {version, created, parent, items[], eval, embedModel}
//   <data>/learned/current.json         pointer {version, promoted, history[]}  (rollback = move the pointer)
// Retrieval: BM25 (always) + cosine over multilingual-e5-small embeddings via Ollama (when available).
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { makeBm25 } from '../retrieval.mjs';
export const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
export const EMBED_MODEL = process.env.ZERONYTH_AI_EMBED_MODEL || 'znyt-embed';
export async function embed(texts, timeoutMs = 4000) {
  const r = await fetch(`${OLLAMA}/api/embed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ model: EMBED_MODEL, input: texts.map((t) => `query: ${String(t).slice(0, 800)}`), keep_alive: '24h' }) });
  if (!r.ok) throw new Error(`embed ${r.status}`);
  const j = await r.json(); return j.embeddings.map((v) => { const n = Math.hypot(...v) || 1; return v.map((x) => Math.round((x / n) * 1e5) / 1e5); });
}
export const cosine = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
export function writeJsonAtomic(file, obj, mode = 0o600) { const tmp = `${file}.tmp${process.pid}`; writeFileSync(tmp, JSON.stringify(obj, null, 1), { mode }); renameSync(tmp, file); }
export function openStore(dataDir) {
  const dir = path.join(dataDir, 'learned'), vdir = path.join(dir, 'versions'), ptr = path.join(dir, 'current.json');
  mkdirSync(vdir, { recursive: true, mode: 0o700 });
  const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
  const store = {
    dir, vdir, ptr,
    versions: () => readdirSync(vdir).filter((f) => /^v\d{4}\.json$/.test(f)).map((f) => f.slice(0, 5)).sort(),
    load: (v) => readJson(path.join(vdir, `${v}.json`), null),
    pointer: () => readJson(ptr, { version: null, history: [] }),
    current() { const p = store.pointer(); return (p.version && store.load(p.version)) || { version: 'v0000', items: [], created: null }; },
    nextVersion() { const vs = store.versions(); return `v${String((vs.length ? Number(vs.at(-1).slice(1)) : 0) + 1).padStart(4, '0')}`; },
    save(snapshot) { writeJsonAtomic(path.join(vdir, `${snapshot.version}.json`), snapshot); },
    promote(version, why) { const p = store.pointer(); const history = [...(p.history || []), { from: p.version, to: version, at: new Date().toISOString(), why }].slice(-50);
      writeJsonAtomic(ptr, { version, promoted: new Date().toISOString(), history }); },
    mtime: () => { try { return statSync(ptr).mtimeMs; } catch { return 0; } },
    readJson, file: (n) => path.join(dir, n),
  };
  return store;
}
// Index over a snapshot's items for chat retrieval.
export function indexItems(items) {
  const docs = items.map((it) => ({ ...it, index: `${it.q} ${it.q} ${it.a}` }));
  const bm = makeBm25(docs);
  return {
    size: docs.length,
    search(q, qEmb, k = 2) {
      if (!docs.length) return [];
      const b = bm(q); const out = [];
      docs.forEach((d, i) => {
        const cos = qEmb && d.emb && d.emb.length === qEmb.length ? cosine(qEmb, d.emb) : null;
        // e5 has a high similarity floor (~0.75 for unrelated text): require a clear match.
        const ok = cos != null ? (cos >= 0.9 || (cos >= 0.85 && b[i] >= 3)) : b[i] >= 6;
        if (ok) out.push({ id: d.id, q: d.q, a: d.a, from: d.from, score: Math.round(((cos ?? 0) * 10 + b[i]) * 100) / 100, cos, bm25: Math.round(b[i] * 100) / 100 });
      });
      return out.sort((x, y) => y.score - x.score).slice(0, k);
    },
  };
}
