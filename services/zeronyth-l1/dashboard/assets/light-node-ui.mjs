// Real ZERONYTH light node (browser). Follows the chain head over the read-only gateway RPC,
// verifies every header (hash, parent link, QBFT ECDSA committed seals vs. the tracked validator set),
// verifies ML-DSA-65 PQ finality certificates, and can relay verified headers over WebRTC rooms.
import { verifyHeader, decodeExtra, validatorSetHash } from './light-client.mjs';
import { verifyRegistry, verifyCertificate } from './pq-finality-core.mjs';
import { client as p2p } from './p2p-ui.mjs';

const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries(['lnStatus', 'lnVerified', 'lnHead', 'lnPq', 'lnPeers', 'lnVals', 'lnVsetHash', 'lnPqSet', 'lnMs', 'lnPqMs', 'lnRelay', 'lnRelayIn', 'lnLog', 'lnStart', 'lnStop', 'lnRelayToggle', 'lnAnchor', 'lnReset', 'lnInstall'].map((k) => [k, $(k)]));
const RPC = 'rpc';
// PQ certificate polling interval in blocks (bandwidth): every header is still ECDSA/QBFT-verified each block; the ML-DSA
// certificate for block h covers h and (via the verified hash chain) all its ancestors, so polling every N blocks only delays
// PQ finality by <= N blocks (~N s). Override: ?pqEvery=1..100 or localStorage znyt-pq-every. Default 10 (~10x less traffic).
const PQ_EVERY = Math.min(100, Math.max(1, Number(new URLSearchParams(location.search).get('pqEvery') || localStorage.getItem('znyt-pq-every') || 10) || 10));
const S = { running: false, validators: null, parent: null, verified: -1, head: -1, pqFinal: -1, hashes: new Map(), reg: null, relayOut: 0, relayIn: 0, busy: false, timer: null, lastCert: -1 };
const log = (msg, cls = '') => { const li = document.createElement('li'); li.className = cls; li.textContent = `${new Date().toLocaleTimeString()} ${msg}`; ui.lnLog.prepend(li); while (ui.lnLog.children.length > 40) ui.lnLog.lastChild.remove(); };

async function rpcBatch(calls) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8000),
    body: JSON.stringify(calls.map(([method, params = []], id) => ({ jsonrpc: '2.0', method, params, id }))) });
  const j = await r.json(); if (!Array.isArray(j)) throw new Error(j?.error || 'RPC error');
  const m = new Map(j.map((x) => [x.id, x]));
  return calls.map((_, i) => { const x = m.get(i); if (!x || x.error) throw new Error(x?.error?.message || 'RPC error'); return x.result; });
}
const getJson = async (u) => { const r = await fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); };
const hex = (n) => '0x' + n.toString(16);

function render() {
  ui.lnStatus.textContent = S.running ? (S.error ? `⚠ ${S.error}` : 'running / 稼働中') : 'stopped / 停止';
  ui.lnStatus.className = 'v ' + (S.running && !S.error ? 'ok' : S.error ? 'bad' : '');
  ui.lnVerified.textContent = S.verified >= 0 ? String(S.verified) : '—';
  ui.lnHead.textContent = S.head >= 0 ? String(S.head) : '—';
  ui.lnPq.textContent = S.pqFinal >= 0 ? String(S.pqFinal) : '—';
  ui.lnVals.textContent = S.validators ? String(S.validators.length) : '—';
  ui.lnVsetHash.textContent = S.validators ? validatorSetHash(S.validators).slice(0, 18) + '…' : '—';
  ui.lnPqSet.textContent = S.reg ? `${S.reg.validators.length} × ML-DSA-65, quorum ${S.reg.quorum} (${S.reg.setHash.slice(0, 14)}…)` : '—';
  const snap = p2p.snapshot();
  ui.lnRelay.textContent = `${snap.connected.length} WebRTC / out ${S.relayOut}`;
  ui.lnRelayIn.textContent = String(S.relayIn);
  ui.lnStart.disabled = S.running; ui.lnStop.disabled = !S.running;
}

// Trust anchor: the PQ registry (pinned on first use, warns on change) + a PQ-final checkpoint header.
async function bootstrap() {
  const reg = await getJson('api/pq/validators');
  const key = `znyt-pq-pin-${reg.chainId}`;
  const pinned = localStorage.getItem(key);
  if (pinned && pinned !== reg.setHash) throw new Error('PQ validator set changed since pinned! (clear pin only if you trust the operator)');
  const cert = await getJson('api/pq/finality/latest');
  const [anchor] = await rpcBatch([['eth_getBlockByNumber', [hex(cert.height), false]]]);
  if (anchor.hash.toLowerCase() !== cert.blockHash) throw new Error('anchor header does not match PQ certificate');
  const anchorVals = decodeExtra(anchor.extraData).validators;
  verifyRegistry(reg, anchorVals); // each PQ key bound to an ECDSA validator of the anchor block
  let t = performance.now(); verifyCertificate(cert, reg); const pqMs = performance.now() - t;
  // Anchor header must itself carry a valid ECDSA quorum from the validator set it declares.
  verifyHeader(anchor, anchorVals);
  if (!pinned) { localStorage.setItem(key, reg.setHash); log(`pinned PQ set ${reg.setHash.slice(0, 18)}… (TOFU)`); }
  S.reg = reg; S.validators = anchorVals; S.parent = anchor; S.verified = cert.height; S.pqFinal = cert.height; S.lastCert = cert.height;
  S.hashes.set(cert.height, anchor.hash.toLowerCase());
  ui.lnAnchor.textContent = `#${cert.height} ${anchor.hash.slice(0, 18)}…`;
  ui.lnPqMs.textContent = `${pqMs.toFixed(1)} ms / ${cert.signatures.length} sig`;
  log(`anchored at PQ-final #${cert.height} (${cert.signatures.length} ML-DSA-65 sigs verified)`, 'ok');
}

function accept(block, source) {
  const n = parseInt(block.number, 16);
  if (n !== S.verified + 1) return false;
  const t = performance.now();
  const r = verifyHeader(block, S.validators, S.parent);
  ui.lnMs.textContent = `${(performance.now() - t).toFixed(1)} ms`;
  const before = validatorSetHash(S.validators), after = validatorSetHash(r.nextValidators);
  if (before !== after) log(`validator set changed at #${n}: ${S.validators.length} → ${r.nextValidators.length}`, 'warn');
  if (r.vote) log(`#${n} vote: ${r.vote.add ? 'ADD' : 'REMOVE'} ${r.vote.address.slice(0, 10)}…`);
  S.validators = r.nextValidators; S.parent = block; S.verified = n;
  S.hashes.set(n, block.hash.toLowerCase()); if (S.hashes.size > 900) S.hashes.delete(S.hashes.keys().next().value);
  if (source === 'p2p') S.relayIn++;
  if (ui.lnRelayToggle.checked && source !== 'p2p') S.relayOut += p2p.broadcastHeader(block) ? 1 : 0;
  return true;
}

p2p.onHeader = (_peer, block) => {
  if (!S.running || !block || typeof block.number !== 'string') return;
  try { if (accept(block, 'p2p')) render(); } catch (e) { log(`rejected relayed header: ${e.message}`, 'bad'); }
};

async function tick() {
  if (S.busy || !S.running || document.hidden) return;
  S.busy = true;
  try {
    const [top, peers] = await rpcBatch([['eth_blockNumber'], ['net_peerCount']]);
    S.head = parseInt(top, 16); ui.lnPeers.textContent = `${parseInt(peers, 16)} (RPC node)`;
    const from = S.verified + 1, to = Math.min(S.head, S.verified + 50);
    if (to >= from) {
      const calls = []; for (let n = from; n <= to; n++) calls.push(['eth_getBlockByNumber', [hex(n), false]]);
      for (const b of await rpcBatch(calls)) if (parseInt(b.number, 16) === S.verified + 1) accept(b, 'rpc');
    }
    if (S.verified - S.lastCert >= PQ_EVERY) {
      const cert = await getJson('api/pq/finality/latest');
      if (cert.height > S.pqFinal && S.hashes.get(cert.height) === cert.blockHash) {
        const t = performance.now(); verifyCertificate(cert, S.reg);
        ui.lnPqMs.textContent = `${(performance.now() - t).toFixed(1)} ms / ${cert.signatures.length} sig`;
        S.pqFinal = cert.height;
      } else if (cert.height <= S.verified && S.hashes.has(cert.height) && S.hashes.get(cert.height) !== cert.blockHash) {
        throw new Error(`PQ certificate conflicts with verified header #${cert.height}`);
      }
      S.lastCert = S.verified;
    }
    S.error = '';
  } catch (e) { S.error = String(e.message || e).slice(0, 120); log(S.error, 'bad'); }
  finally { S.busy = false; render(); }
}

async function start() {
  S.running = true; S.error = ''; render();
  try { await bootstrap(); } catch (e) { S.error = e.message; S.running = false; log(e.message, 'bad'); render(); return; }
  S.timer = setInterval(tick, 1000); void tick();
}
function stop() { S.running = false; clearInterval(S.timer); render(); }
ui.lnStart.addEventListener('click', start);
ui.lnStop.addEventListener('click', stop);
ui.lnReset.addEventListener('click', () => { for (const k of Object.keys(localStorage)) if (k.startsWith('znyt-pq-pin-')) localStorage.removeItem(k); log('PQ pin cleared'); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.running) void tick(); });

// PWA: service worker (needs a secure context: HTTPS or localhost) + install prompt.
let deferred = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; ui.lnInstall.hidden = false; });
ui.lnInstall.addEventListener('click', async () => { if (deferred) { deferred.prompt(); deferred = null; ui.lnInstall.hidden = true; } });
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
else log('Service worker needs HTTPS (or localhost); light node still works, offline install limited.');
render();
if (new URLSearchParams(location.search).get('light') === '1' || localStorage.getItem('znyt-light-autostart') === '1') void start();
