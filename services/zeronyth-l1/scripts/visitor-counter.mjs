// Privacy-friendly visitor counter for the ZERONYTH gateway (site "main") and the scan explorer (site "scan").
// - No cookies, no JS beacon, no raw IPs stored or logged.
// - Unique visitor = sha256(dailyRandomSalt | ipBucket) kept in memory for the current JST day only; the salt is
//   regenerated at JST midnight and never written to disk, so hashes cannot be linked across days or reversed later.
//   (A process restart also draws a new salt, so a restart mid-day may count a returning visitor once more.)
// - IPv6 grouped by /64. Only HTML page views (GET, 2xx or 304, text/html or *.html / SPA path) are counted;
//   /rpc, /api/*, assets are not.
// - Bots / AI crawlers counted separately by User-Agent; ChatGPT-User / OAI-SearchBot / GPTBot get their own counters.
// - Own traffic excluded: requests not arriving via the local Cloudflare tunnel (no CF-Connecting-IP or non-loopback
//   peer) and ZERONYTH_OWN_IPS (VPS, box egress; IPv6 compared per /64).
// Persists only aggregate counts, one JSON file per site, every 30 s:
//   {day:{uniques,pageViews,hours[24],pages{},bots{},ai{}}}
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const DIR = process.env.ZERONYTH_VISITS_DIR || '/workspace/zeronyth-visits';
const OWN_DEFAULT = ''; // set ZERONYTH_OWN_IPS (comma-separated) to exclude operator IPs
const AI_UA = [['chatgpt-user', /ChatGPT-User/i], ['oai-searchbot', /OAI-SearchBot/i], ['gptbot', /GPTBot/i]];
const BOT_UA = /bot|crawl|spider|slurp|curl|wget|python|go-http|node-fetch|undici|axios|headless|playwright|puppeteer|uptime|monitor|preview|facebookexternalhit|embedly|discord|telegram|whatsapp|ClaudeBot|anthropic|Perplexity|Bytespider|Amazonbot|Applebot|bingpreview/i;
const SKIP_PATH = /^\/(rpc|api\/|ai-lab\/|health|status|metrics|favicon|.*\.(js|mjs|css|png|svg|ico|json|webmanifest|txt|xml|zip|md|wasm|woff2?|map)$)/i;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;
const MAX_PAGES = 300; // distinct page keys per day per site (rest folded into "(other)")

export const jstDay = (t = Date.now()) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
const jstHour = (t = Date.now()) => new Date(t + 9 * 3600e3).getUTCHours();
export function ipBucket(ip) {
  const v = String(ip).toLowerCase().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
  if (!v.includes(':')) return v;
  const [h, t = ''] = v.split('::'); const hs = h ? h.split(':') : [], ts = t ? t.split(':') : [];
  const full = v.includes('::') ? [...hs, ...Array(Math.max(0, 8 - hs.length - ts.length)).fill('0'), ...ts] : hs;
  return full.slice(0, 4).map((x) => (parseInt(x, 16) || 0).toString(16)).join(':') + '::/64';
}
const OWN = new Set((process.env.ZERONYTH_OWN_IPS || OWN_DEFAULT).split(',').map((s) => s.trim()).filter(Boolean).map(ipBucket));
export const statsFile = (site) => path.join(DIR, `stats-${site.replace(/[^a-z0-9-]/gi, '')}.json`);

export function createVisitorCounter({ site = 'main', isPage = null, pageKey = (x) => x } = {}) {
  const file = statsFile(site);
  mkdirSync(DIR, { recursive: true });
  let stats = {}; try { if (existsSync(file)) stats = JSON.parse(readFileSync(file, 'utf8')); } catch { stats = {}; }
  let day = jstDay(), salt = randomBytes(32), seen = new Set(), dirty = false;
  const bucket = () => {
    const d = jstDay(); if (d !== day) { day = d; salt = randomBytes(32); seen = new Set(); }
    return (stats[day] ||= { uniques: 0, pageViews: 0, hours: Array(24).fill(0), pages: {}, bots: {}, ai: {} });
  };
  const flush = () => { if (!dirty) return; dirty = false; try { writeFileSync(file + '.tmp', JSON.stringify(stats)); renameSync(file + '.tmp', file); } catch { dirty = true; } };
  setInterval(flush, 30_000).unref();
  function record(req, res) {
    try {
      if (req.method !== 'GET') return;
      const code = res.statusCode; if (!((code >= 200 && code < 300) || code === 304)) return;
      const p = (req.url || '/').split('?')[0];
      if (SKIP_PATH.test(p)) return;
      const html = String(res.getHeader('content-type') || '').startsWith('text/html') || p === '/' || p.endsWith('.html') || (isPage && isPage(p));
      if (!html) return;
      if (!LOOPBACK.has(req.socket?.remoteAddress)) return; // only traffic that came through the local tunnel
      const ip = req.headers['cf-connecting-ip']; if (typeof ip !== 'string' || !IP_RE.test(ip)) return; // internal
      const ipb = ipBucket(ip); if (OWN.has(ipb)) return; // own machines
      const ua = String(req.headers['user-agent'] || ''), b = bucket(); dirty = true;
      const ai = AI_UA.find(([, re]) => re.test(ua)); if (ai) { b.ai[ai[0]] = (b.ai[ai[0]] || 0) + 1; return; }
      if (!ua || BOT_UA.test(ua)) { b.bots.other = (b.bots.other || 0) + 1; return; }
      const h = createHash('sha256').update(salt).update(ipb).digest('base64url').slice(0, 22);
      if (!seen.has(h)) { seen.add(h); b.uniques++; }
      const pk = pageKey(p); const key = pk in b.pages || Object.keys(b.pages).length < MAX_PAGES ? pk : '(other)';
      b.pageViews++; b.hours[jstHour()]++; b.pages[key] = (b.pages[key] || 0) + 1;
    } catch { /* never break a request */ }
  }
  return { record, flush, stats: () => stats };
}

// Aggregates-only summary for /api/visitors: today + yesterday (JST), top pages, per-hour counts, bot / AI counters.
export function summarize(stats, now = Date.now()) {
  const shape = (d) => {
    const s = stats[d]; if (!s) return { day: d, uniques: 0, pageViews: 0, hours: Array(24).fill(0), topPages: [], bots: {}, ai: {} };
    const topPages = Object.entries(s.pages).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([page, views]) => ({ page, views }));
    return { day: d, uniques: s.uniques, pageViews: s.pageViews, hours: s.hours, topPages, bots: s.bots, ai: s.ai };
  };
  return { today: shape(jstDay(now)), yesterday: shape(jstDay(now - 86400e3)) };
}
export function readSiteStats(site) { try { return JSON.parse(readFileSync(statsFile(site), 'utf8')); } catch { return {}; } }
