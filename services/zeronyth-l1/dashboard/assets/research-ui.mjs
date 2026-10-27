// Read-only summary of assets/research-results.json. Values are shown as recorded, never recomputed.
import { i18n } from './i18n.mjs';

const stateEl = document.getElementById('evState');
const bodyEl = document.getElementById('evBody');
const retryEl = document.getElementById('evRetry');
let status = 'loading';
let data = null;

const own = (o, k) => (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function fmt(v) {
  if (isNum(v)) return String(v);
  if (typeof v === 'boolean') return i18n.t(v ? 'research.ev.yes' : 'research.ev.no');
  if (typeof v === 'string' && v.length < 64) return v;
  return i18n.t('research.ev.unknown');
}
function card(title, note) {
  const c = document.createElement('article'); c.className = 'ev-card';
  const h = document.createElement('h3'); h.textContent = title; c.appendChild(h);
  if (note) { const p = document.createElement('p'); p.textContent = note; c.appendChild(p); }
  return c;
}
function dl(rows) {
  const l = document.createElement('dl');
  for (const [k, v] of rows) {
    const d = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = i18n.t(k);
    const dd = document.createElement('dd'); dd.textContent = fmt(v);
    d.append(dt, dd); l.appendChild(d);
  }
  return l;
}
function render() {
  bodyEl.replaceChildren();
  retryEl.hidden = status !== 'error' && status !== 'invalid';
  if (status === 'loading') { stateEl.textContent = i18n.t('research.ev.loading'); return; }
  if (status !== 'ok') { stateEl.textContent = i18n.t(status === 'invalid' ? 'research.ev.invalid' : 'research.ev.error'); return; }
  stateEl.textContent = '';
  const h = own(data, 'historicalRecord');
  const hc = card(i18n.t('research.ev.hist'), i18n.t('research.ev.histnote'));
  hc.appendChild(dl([
    ['research.ev.captured', own(h, 'capturedUtc')], ['research.ev.tests', own(h, 'tests')],
    ['research.ev.passed', own(h, 'passed')], ['research.ev.failed', own(h, 'failed')],
    ['research.ev.skipped', own(h, 'skipped')], ['research.ev.trials', own(h, 'benchmarkTrials')],
    ['research.ev.unexpected', own(h, 'unexpectedBenchmarkOutcomes')], ['research.ev.rerun', own(h, 'rerunInCurrentWork')],
  ]));
  bodyEl.appendChild(hc);
  const f = own(data, 'freshRecord') ?? own(data, 'currentRun');
  const fc = card(i18n.t('research.ev.fresh'), i18n.t(f && typeof f === 'object' ? 'research.ev.freshfound' : 'research.ev.freshnone'));
  if (f && typeof f === 'object') fc.appendChild(dl([['research.ev.captured', own(f, 'capturedUtc')]]));
  bodyEl.appendChild(fc);
  const sc = own(data, 'scope');
  if (typeof sc === 'string') bodyEl.appendChild(card(i18n.t('research.ev.scope'), sc.slice(0, 400)));
  const lim = own(data, 'limits');
  if (Array.isArray(lim)) {
    const c = card(i18n.t('research.ev.limits'));
    const ul = document.createElement('ul');
    for (const x of lim.slice(0, 12)) if (typeof x === 'string') { const li = document.createElement('li'); li.textContent = x.slice(0, 300); ul.appendChild(li); }
    c.appendChild(ul); bodyEl.appendChild(c);
  }
}
async function load() {
  status = 'loading'; render();
  try {
    const r = await fetch('assets/research-results.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('http');
    const j = await r.json();
    if (!j || typeof j !== 'object' || Array.isArray(j) || !own(j, 'historicalRecord')) { status = 'invalid'; }
    else { data = j; status = 'ok'; }
  } catch { status = 'error'; }
  render();
}
retryEl.addEventListener('click', load);
i18n.subscribe(render);
load();
