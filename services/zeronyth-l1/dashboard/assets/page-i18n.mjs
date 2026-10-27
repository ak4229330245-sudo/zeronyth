// Site-wide page localizer (CSP-safe: no inline code, textContent/attributes only, never innerHTML).
// Pages render their own (mostly Japanese) text; this module translates visible text nodes, placeholders,
// titles and aria-labels into the chosen language from per-locale dictionaries, follows DOM updates made by
// page scripts, adds the language selector where a page has none, and carries the choice to ZERONYTH Scan.
const KEY = 'zeronyth.language.v1';
const LOCALES = ['ja', 'en', 'zh-CN', 'ko'];
const NAMES = { ja: '日本語', en: 'English', 'zh-CN': '简体中文', ko: '한국어' };
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'content'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'CODE', 'PRE', 'TEXTAREA']);
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const normLocale = (v) => { const s = String(v || '').toLowerCase(); return s.startsWith('ja') ? 'ja' : s.startsWith('en') ? 'en' : s.startsWith('ko') ? 'ko' : s.startsWith('zh') ? 'zh-CN' : null; };

let locale = 'ja';
try {
  const q = normLocale(new URLSearchParams(location.search).get('lang'));
  if (q) localStorage.setItem(KEY, q);
  locale = normLocale(localStorage.getItem(KEY)) || 'ja';
} catch { /* storage blocked: stay Japanese */ }

const cache = new Map(); // locale -> { exact: Map, tpl: [{re, out}] }
let dict = null;
const textState = new WeakMap(); // Text -> { orig, set }
const attrState = new WeakMap(); // Element -> Map(attr -> { orig, set })
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uff01-\uff60]/;

async function load(loc) {
  if (cache.has(loc)) return cache.get(loc);
  let d = { exact: new Map(), tpl: [] };
  try {
    const mod = await import(`./i18n-pages-${loc}.mjs`);
    d.exact = new Map(Object.entries(mod.EXACT || {}));
    d.tpl = (mod.TEMPLATES || []).map(([src, out]) => {
      const names = [];
      const re = new RegExp('^' + src.split(/(\{\d+\})/).map((part) => {
        const m = /^\{(\d+)\}$/.exec(part); if (m) { names.push(Number(m[1])); return '(.+?)'; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('') + '$', 's');
      return { re, names, out };
    });
  } catch { /* missing dictionary: leave text as is */ }
  cache.set(loc, d);
  return d;
}

function translate(text, depth = 0) {
  if (!dict || !text) return null;
  const key = norm(text);
  if (!key) return null;
  const hit = dict.exact.get(key);
  if (hit != null) return hit;
  if (depth > 10) return null;
  for (const { re, names, out } of dict.tpl) {
    const m = re.exec(key);
    if (!m) continue;
    return out.replace(/\{(\d+)\}/g, (_, n) => {
      const v = m[names.indexOf(Number(n)) + 1] ?? '';
      return translate(v, depth + 1) ?? v;
    });
  }
  return null;
}

// Multi-line text (pre-wrap blocks built with "\n"): translate line by line so line breaks survive.
function translateBlock(text) {
  const whole = translate(text);
  if (whole != null || !text.includes('\n')) return whole;
  let hit = false;
  const out = text.split(/(\n+)/).map((part) => {
    if (!part.trim() || part.startsWith('\n')) return part;
    const t = translate(part); if (t == null) return part;
    hit = true; return /^\s*/.exec(part)[0] + t + /\s*$/.exec(part)[0];
  }).join('');
  return hit ? out : null;
}

// Text right next to a node, stepping out of one inline wrapper (<b>x</b>y).
function adjText(node, dir) {
  if (node[dir]) return node[dir].textContent || '';
  const pe = node.parentElement;
  if (pe && /^(B|STRONG|EM|I|SPAN|A|SMALL)$/.test(pe.tagName) && pe[dir]) return pe[dir].textContent || '';
  return '';
}

function doText(node) {
  const st = textState.get(node);
  let base = node.data;
  if (st && node.data === st.set) base = st.orig; // our own earlier output: re-derive from the original
  const out = locale === 'ja' && !dict?.exact.size ? null : translateBlock(base);
  if (out == null) { if (st && node.data === st.set) node.data = st.orig; if (st) textState.delete(node); return; }
  let lead = /^\s*/.exec(base)[0], trail = /\s*$/.exec(base)[0];
  // Japanese runs text into neighbouring inline elements with no space; space-separated languages need one.
  if (locale === 'en' || locale === 'ko') {
    if (!trail && /[.:!?,;)]$/.test(out) && /^[\w"'(\u3131-\uD7A3]/.test(adjText(node, 'nextSibling'))) trail = ' ';
    if (!lead && /^[\w(\u3131-\uD7A3]/.test(out) && /[\w.:!?,;)\u3131-\uD7A3]$/.test(adjText(node, 'previousSibling'))) lead = ' ';
  }
  const next = lead + out + trail;
  textState.set(node, { orig: base, set: next });
  if (node.data !== next) node.data = next;
}

function doAttr(el, attr) {
  if (attr === 'content' && !(el.tagName === 'META' && /^(description|og:description|og:title|twitter:)/.test(el.getAttribute('name') || el.getAttribute('property') || ''))) return;
  let m = attrState.get(el); const st = m?.get(attr);
  const cur = el.getAttribute(attr); if (cur == null) return;
  const base = st && cur === st.set ? st.orig : cur;
  const out = translate(base);
  if (out == null) { if (st && cur === st.set) el.setAttribute(attr, st.orig); m?.delete(attr); return; }
  if (!m) { m = new Map(); attrState.set(el, m); }
  m.set(attr, { orig: base, set: out });
  if (cur !== out) el.setAttribute(attr, out);
}

function skipped(el) { for (let e = el; e; e = e.parentElement) { if (SKIP.has(e.tagName) || e.hasAttribute?.('data-no-i18n')) return true; } return false; }

function walk(root) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) { if (!skipped(root.parentElement)) doText(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  if (skipped(root)) return;
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE ? (SKIP.has(n.tagName) || n.hasAttribute('data-no-i18n') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) : NodeFilter.FILTER_ACCEPT),
  });
  for (const a of ATTRS) { if (root.hasAttribute(a)) doAttr(root, a); }
  let n; while ((n = tw.nextNode())) doText(n);
  for (const el of root.querySelectorAll('[placeholder],[title],[aria-label],[alt],meta[content]')) for (const a of ATTRS) if (el.hasAttribute(a)) doAttr(el, a);
}

function applyTitle() {
  const t = document.querySelector('title'); if (t && t.firstChild) doText(t.firstChild);
}

let observer = null; let busy = false;
function observe() {
  observer = new MutationObserver((list) => {
    if (busy) return; busy = true;
    try {
      for (const m of list) {
        if (m.type === 'characterData') { if (!skipped(m.target.parentElement)) doText(m.target); }
        else if (m.type === 'attributes') { if (!skipped(m.target)) doAttr(m.target, m.attributeName); }
        else for (const n of m.addedNodes) walk(n);
      }
    } finally { observer.takeRecords(); busy = false; }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

async function applyAll() {
  dict = await load(locale);
  document.documentElement.lang = locale;
  busy = true;
  try { walk(document.head); walk(document.body); applyTitle(); } finally { observer?.takeRecords(); busy = false; }
  syncSelects();
  rewriteScanLinks();
}

const SELECT_IDS = ['languageSelect', 'ecoLanguage', 'tkLang', 'jLang', 'zlLang'];
function syncSelects() {
  for (const id of SELECT_IDS) {
    const sel = document.getElementById(id); if (!sel) continue;
    const have = new Set([...sel.options].map((o) => o.value));
    for (const loc of LOCALES) if (!have.has(loc)) { const o = document.createElement('option'); o.value = loc; o.lang = loc; o.textContent = NAMES[loc]; sel.appendChild(o); }
    for (const o of sel.options) { o.setAttribute('data-no-i18n', ''); }
    if (sel.value !== locale) sel.value = locale;
    if (!sel.dataset.zlBound) {
      sel.dataset.zlBound = '1';
      sel.addEventListener('change', () => setLocale(sel.value));
    }
  }
}

function injectSelector() {
  if (SELECT_IDS.some((id) => document.getElementById(id))) return;
  const host = document.querySelector('header.tk-top, header .controls, header.topbar, header');
  if (!host) return;
  const sel = document.createElement('select');
  sel.id = 'zlLang'; sel.className = 'zl-lang'; sel.setAttribute('aria-label', 'Language'); sel.setAttribute('data-no-i18n', '');
  for (const loc of LOCALES) { const o = document.createElement('option'); o.value = loc; o.lang = loc; o.textContent = NAMES[loc]; sel.appendChild(o); }
  host.appendChild(sel);
}

function rewriteScanLinks() {
  for (const a of document.querySelectorAll('a[href*="scan.zeronyth.dpdns.org"]')) {
    try { const u = new URL(a.href); u.searchParams.set('lang', locale); a.href = u.toString(); } catch { /* ignore */ }
  }
}

export function getLocale() { return locale; }
export async function setLocale(next) {
  const loc = normLocale(next); if (!loc) return;
  locale = loc;
  try { localStorage.setItem(KEY, loc); } catch { /* ignore */ }
  await applyAll();
  window.dispatchEvent(new CustomEvent('zl-locale', { detail: loc }));
}

/** Translate a message for the current language (falls back to the text itself). */
export function t(text) { const s = String(text ?? ''); return translateBlock(s) ?? s; }
// alert()/confirm() boxes are not DOM text, so translate their messages on the way out.
for (const name of ['alert', 'confirm']) {
  const orig = window[name]?.bind(window);
  if (orig) window[name] = (msg, ...rest) => orig(msg == null ? msg : t(msg), ...rest);
}

injectSelector();
observe();
applyAll();
// Other tabs / page scripts that write the shared key directly.
window.addEventListener('storage', (e) => { if (e.key === KEY) { const loc = normLocale(e.newValue); if (loc && loc !== locale) setLocale(loc); } });
