// Join page: one-tap browser light node, PWA install, PC kit download, validator application link. ja-first.
const EN = { 'nav.join': 'Join', 'nav.tok': 'Tokenomics', 'nav.console': 'Console', h1: 'Join ZERONYTH',
  lead: 'Help verify the network and earn test ZNYT for the work you do. No setup needed.',
  'c1.tag': 'Easiest', 'c1.h': 'Join from your phone or PC browser', 'c1.p': 'Just tap. While this page is open, your device verifies block seals and the post-quantum (ML-DSA) finality proof locally.',
  'c1.btn': 'Join with one tap', 'c1.install': 'Add to home screen', 'c1.ios': 'iPhone: Share → "Add to Home Screen". Next time, tapping the icon joins directly.',
  'c2.tag': 'Always-on PC', 'c2.h': 'Participant app (Windows / Mac)', 'c2.s1': 'Download the ZIP below and extract it', 'c2.s2': 'Double-click START.bat (Windows) or START.command (Mac)',
  'c2.s3': 'Done when a status page opens in your browser. Close the window to stop.', 'c2.btn': 'Download the participant app',
  'c2.p': 'Uses at most 50% CPU at lowest priority and rests on battery, heat or a busy PC. If Node.js is missing, the official build is fetched into the app folder only.',
  'c3.tag': 'Advanced', 'c3.h': 'Apply to be a validator', 'c3.p': 'Validators run a 24/7 server that produces blocks. Run a full node first, then send the application; existing validators vote you in.',
  'c3.btn': 'Open the application form', 'safe.h': 'Safety', 'safe.1': 'Your keys are created only on your device. The operators will never ask for a password or private key.',
  'safe.2': 'This is a testnet. Test ZNYT has no monetary value.', 'safe.3': 'The reward split is public on the Tokenomics page (L1 40% / AI 30% / VPS 30%).' };
const KEY = 'zeronyth.language.v1', orig = new Map();
let lang = (() => { try { return (new URLSearchParams(location.search).get('lang') || localStorage.getItem(KEY)) === 'en' ? 'en' : 'ja'; } catch { return 'ja'; } })();
function apply() { document.documentElement.lang = lang; for (const e of document.querySelectorAll('[data-t]')) { if (!orig.has(e)) orig.set(e, e.textContent); e.textContent = lang === 'en' ? (EN[e.dataset.t] ?? orig.get(e)) : orig.get(e); } }
const sel = document.getElementById('jLang'); sel.value = lang;
sel.addEventListener('change', () => { lang = sel.value === 'en' ? 'en' : 'ja'; try { localStorage.setItem(KEY, sel.value); } catch {} apply(); });
document.getElementById('jStart').addEventListener('click', () => { try { localStorage.setItem('znyt-light-autostart', '1'); } catch {} location.href = 'node.html?light=1'; });
let deferred = null; const inst = document.getElementById('jInstall');
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; inst.hidden = false; });
inst.addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; inst.hidden = true; });
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
apply();
