// Quantum Wallet v2 — browser UI.
//
// A thin renderer over the session controller (src/app/session.mjs) and
// the i18n runtime (src/i18n.mjs). All copy goes through the dictionary;
// all state transitions go through the session. Rendering is
// string-based with a single delegated click handler; form values are
// read from the DOM at action time (uncontrolled inputs), and dynamic
// bits (balances, receipt status, connection) are patched in place so
// typing is never interrupted by a re-render.

import { browserStorage } from '../core/storage.mjs';
import { SCHEMES } from '../core/crypto.mjs';
import { parseZnyt, formatZnyt, isAddress, isHexData } from '../core/amount.mjs';
import { createI18n } from '../i18n.mjs';
import { createSession, explorerTxUrl } from '../app/session.mjs';

const LANG_LABELS = { ja: '日本語', en: 'English', 'zh-CN': '简体中文', ko: '한국어' };
const SCHEME_ORDER = ['ecdsa', 'falcon', 'mldsa'];
const SCHEME_NOTE_KEY = { ecdsa: 'noteEcdsa', falcon: 'noteFalcon', mldsa: 'noteMldsa' };

export function startApp(doc = document) {
  const storage = browserStorage();
  const i18n = createI18n(storage);
  const session = createSession({ storage });
  const t = (key, vars) => i18n.t(key, vars);

  const ui = {
    screen: 'accounts', // accounts | send | receive
    accountId: null,
    review: null,
    result: null, // { hash, state }
    busy: '', // i18n key of the in-progress label
    error: '',
    notice: '',
    showReset: false,
    conn: null, // { ok, chainId, wrongChain } | null
    bannerDismissed: false,
  };

  const view = doc.getElementById('view');
  const $ = (id) => doc.getElementById(id);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[c]);
  const busy = (key) => {
    ui.busy = key;
    render();
  };
  const idle = () => {
    ui.busy = '';
  };
  // Let the browser paint the busy state before a synchronous ~1 s
  // Falcon keygen blocks the main thread.
  const paint = () => new Promise((r) => setTimeout(r, 30));

  // ------------------------------------------------------------ header

  function renderHeader() {
    const st = session.state;
    const lockBtn = $('lock-btn');
    lockBtn.hidden = st.status !== 'unlocked';
    lockBtn.textContent = t('lock');
    $('lang-sel').value = i18n.lang;
    $('lang-sel').setAttribute('aria-label', t('language'));
    const conn = $('conn');
    if (!ui.conn) {
      conn.textContent = '…';
      conn.className = 'muted';
    } else if (ui.conn.ok) {
      conn.textContent = '● ' + t('connected');
      conn.className = 'ok';
    } else if (ui.conn.wrongChain) {
      conn.textContent = '● ' + t('wrongChain');
      conn.className = 'err';
    } else {
      conn.textContent = '● ' + t('offline');
      conn.className = 'err';
    }
  }

  async function refreshConnection() {
    const res = await session.checkConnection();
    ui.conn = res.ok
      ? { ok: true }
      : res.chainId != null
        ? { ok: false, wrongChain: true }
        : { ok: false };
    renderHeader();
  }

  // ------------------------------------------------------------ shared bits

  function schemePicker(name, selected = 'mldsa') {
    return `<div class="schemes" role="radiogroup">${SCHEME_ORDER.map(
      (s) => `
      <label class="scheme ${s === selected ? 'sel' : ''}">
        <input type="radio" name="${name}" value="${s}" ${s === selected ? 'checked' : ''}>
        <span class="badge ${s}">${esc(SCHEMES[s].name)}</span>
        ${s !== 'ecdsa' ? `<span class="qr">${esc(t('quantumResistant'))}</span>` : ''}
        <span class="note">${esc(t(SCHEME_NOTE_KEY[s]))}</span>
      </label>`,
    ).join('')}</div>`;
  }

  function pickedScheme(name) {
    const el = view.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : 'mldsa';
  }

  function statusLines() {
    return (
      (ui.busy ? `<p class="busy">⏳ ${esc(t(ui.busy))}</p>` : '') +
      (ui.error ? `<p class="err">${esc(ui.error)}</p>` : '') +
      (ui.notice ? `<p class="ok">${esc(ui.notice)}</p>` : '')
    );
  }

  function accountCard(a) {
    const bal = session.state.balances[a.id];
    return `<div class="acct">
      <div class="row">
        <span class="badge ${a.scheme}">${esc(a.schemeName)}</span>
        <span class="bal" data-balance-for="${a.id}">${bal == null ? '—' : esc(formatZnyt(bal))} ZNYT</span>
      </div>
      <div class="addr mono">${esc(a.address)}</div>
      <div class="row">
        <button data-act="send" data-id="${a.id}">${esc(t('send'))}</button>
        <button data-act="receive" data-id="${a.id}">${esc(t('receive'))}</button>
        <button data-act="faucet" data-id="${a.id}">＋ ${esc(t('faucet'))}</button>
        <button data-act="copy" data-copy="${esc(a.address)}">${esc(t('copy'))}</button>
      </div>
    </div>`;
  }

  // ------------------------------------------------------------ screens

  function createScreen() {
    return `<section class="panel">
      <h2>${esc(t('create'))}</h2>
      <p class="tagline">${esc(t('tagline'))}</p>
      <p class="warn-banner">${esc(t('warning'))}</p>
      <label>${esc(t('password'))}<br>
        <input id="create-pw" type="password" autocomplete="new-password" size="32"></label><br>
      <label>${esc(t('confirmPassword'))}<br>
        <input id="create-pw2" type="password" autocomplete="new-password" size="32"></label>
      <h3>${esc(t('firstAccount'))} — ${esc(t('selectScheme'))}</h3>
      ${schemePicker('create-scheme')}
      <button class="primary" data-act="create" ${ui.busy ? 'disabled' : ''}>${esc(t('create'))}</button>
      <p class="muted">${esc(t('local'))}</p>
      <p class="muted">${esc(t('backupNotice'))}</p>
      ${statusLines()}
    </section>`;
  }

  function unlockScreen() {
    return `<section class="panel">
      <h2>${esc(t('unlock'))}</h2>
      <p class="tagline">${esc(t('tagline'))}</p>
      <label>${esc(t('password'))}<br>
        <input id="unlock-pw" type="password" autocomplete="current-password" size="32"></label><br>
      <button class="primary" data-act="unlock" ${ui.busy ? 'disabled' : ''}>${esc(t('unlock'))}</button>
      <p class="muted">${esc(t('passwordNotStored'))}</p>
      <div class="reset-zone">
        <button class="reset-btn" data-act="reset-open">${esc(t('forgot'))}</button>
        ${ui.showReset ? `<div class="reset-panel">
          <p>${esc(t('resetWarn'))}</p>
          <div class="row">
            <button class="danger" data-act="reset-confirm">${esc(t('resetDelete'))}</button>
            <button data-act="reset-cancel">${esc(t('cancel'))}</button>
          </div>
        </div>` : ''}
      </div>
      ${statusLines()}
    </section>`;
  }

  function accountsScreen(st) {
    const known = st.accounts
      .map((a) => st.balances[a.id])
      .filter((b) => b != null);
    const total = known.reduce((n, b) => n + b, 0n);
    return `
    ${st.migratedFromV1 && !ui.bannerDismissed ? `<section class="panel banner">
      <h3>${esc(t('migratedTitle'))}</h3>
      <p>${esc(t('migratedBody'))}</p>
      <button data-act="dismiss-banner">${esc(t('dismiss'))}</button>
    </section>` : ''}
    <section class="panel">
      <div class="row between">
        <h2>${esc(t('accounts'))}</h2>
        <button data-act="refresh">↻ ${esc(t('refresh'))}</button>
      </div>
      <p class="muted">${esc(t('total'))}: <strong>${esc(formatZnyt(total))} ZNYT</strong></p>
      ${st.accounts.length ? st.accounts.map(accountCard).join('') : `<p class="muted">${esc(t('noAccounts'))}</p>`}
      <p class="muted">${esc(t('chainNote'))}</p>
      ${statusLines()}
    </section>
    <section class="panel">
      <h3>${esc(t('addAccount'))}</h3>
      ${schemePicker('add-scheme', 'mldsa')}
      <button data-act="add-account" ${ui.busy ? 'disabled' : ''}>${esc(t('addAccount'))}</button>
    </section>
    <section class="panel">
      <h3>${esc(t('settings'))}</h3>
      <label>${esc(t('rpc'))}<br>
        <input id="rpc-url" type="text" value="${esc(session.getRpcUrl())}" size="42" spellcheck="false"></label><br>
      <button data-act="save-rpc">${esc(t('save'))}</button>
      <p class="muted">${esc(t('note'))}</p>
    </section>`;
  }

  function sendScreen(st) {
    const account = st.accounts.find((a) => a.id === ui.accountId);
    if (!account) return accountsScreen(st);
    if (ui.result) {
      const r = ui.result;
      return `<section class="panel">
        <h2>${esc(t('send'))}</h2>
        <p class="ok">${esc(t('success'))}</p>
        <p>${esc(t('txHash'))}<br><span class="mono">${esc(r.hash)}</span></p>
        <p><a href="${esc(explorerTxUrl(r.hash))}" target="_blank" rel="noopener">${esc(t('viewExplorer'))}</a></p>
        <p>${esc(t('status'))}: <span id="receipt-status" class="${r.state === 'success' ? 'ok' : r.state === 'failed' ? 'err' : 'muted'}">${
          r.state === 'success' ? esc(t('receiptOk')) : r.state === 'failed' ? esc(t('receiptNg')) : esc(t('receiptPending'))
        }</span></p>
        <button data-act="back-accounts">${esc(t('back'))}</button>
        ${statusLines()}
      </section>`;
    }
    if (ui.review) {
      const p = ui.review;
      const tooPoor = p.balance != null && p.value + p.fee > p.balance;
      return `<section class="panel">
        <h2>${esc(t('review'))}</h2>
        <table class="kv">
          <tr><th>${esc(t('from'))}</th><td class="mono">${esc(p.from)}</td></tr>
          <tr><th>${esc(t('recipient'))}</th><td class="mono">${p.to ? esc(p.to) : esc(t('contractCreation'))}</td></tr>
          <tr><th>${esc(t('amount'))}</th><td>${esc(formatZnyt(p.value))} ZNYT</td></tr>
          ${p.data !== '0x' ? `<tr><th>${esc(t('data'))}</th><td class="mono">${esc(p.data.length > 66 ? p.data.slice(0, 66) + '…' : p.data)}</td></tr>` : ''}
          <tr><th>${esc(t('gasLimit'))}</th><td>${p.gasLimit.toString()}</td></tr>
          <tr><th>${esc(t('gasPrice'))}</th><td>${p.gasPrice.toString()}</td></tr>
          <tr><th>${esc(t('fee'))}</th><td>${esc(formatZnyt(p.fee))} ZNYT</td></tr>
          <tr><th>${esc(t('chain'))}</th><td>912701</td></tr>
        </table>
        ${tooPoor ? `<p class="err">${esc(t('insufficient'))}</p>` : ''}
        <div class="row">
          <button class="primary" data-act="approve" ${ui.busy || tooPoor ? 'disabled' : ''}>${esc(t('approve'))}</button>
          <button data-act="back-send">${esc(t('cancel'))}</button>
        </div>
        ${statusLines()}
      </section>`;
    }
    return `<section class="panel">
      <h2>${esc(t('send'))}</h2>
      <p><span class="badge ${account.scheme}">${esc(account.schemeName)}</span>
         <span class="mono">${esc(account.address)}</span></p>
      <label>${esc(t('recipient'))}<br>
        <input id="send-to" type="text" size="44" spellcheck="false" placeholder="0x…"></label><br>
      <label>${esc(t('amount'))} (ZNYT)<br>
        <input id="send-value" type="text" inputmode="decimal" size="24" placeholder="0.0"></label><br>
      <label class="check"><input id="send-advanced" type="checkbox"> ${esc(t('advanced'))}</label>
      <div id="send-data-row" hidden>
        <label>${esc(t('data'))}<br>
          <input id="send-data" type="text" size="44" spellcheck="false" placeholder="0x"></label>
        <p class="muted">${esc(t('contractCreation'))}: ${esc(t('recipient'))} —</p>
      </div>
      <div class="row">
        <button class="primary" data-act="review" ${ui.busy ? 'disabled' : ''}>${esc(t('review'))}</button>
        <button data-act="back-accounts">${esc(t('back'))}</button>
      </div>
      ${statusLines()}
    </section>`;
  }

  function receiveScreen(st) {
    const account = st.accounts.find((a) => a.id === ui.accountId);
    if (!account) return accountsScreen(st);
    return `<section class="panel">
      <h2>${esc(t('receive'))}</h2>
      <p><span class="badge ${account.scheme}">${esc(account.schemeName)}</span></p>
      <p>${esc(t('yourAddress'))}</p>
      <p class="addr-big mono">${esc(account.address)}</p>
      <div class="row">
        <button data-act="copy" data-copy="${esc(account.address)}">${esc(t('copy'))}</button>
        <button data-act="back-accounts">${esc(t('back'))}</button>
      </div>
      <p class="muted">${esc(t('receiveWarn'))}</p>
      ${statusLines()}
    </section>`;
  }

  function render() {
    globalThis.__qwBooted = true; // boot guard in index.html watches this
    renderHeader();
    const st = session.state;
    if (st.status === 'no-vault') view.innerHTML = createScreen();
    else if (st.status === 'locked') view.innerHTML = unlockScreen();
    else if (ui.screen === 'send') view.innerHTML = sendScreen(st);
    else if (ui.screen === 'receive') view.innerHTML = receiveScreen(st);
    else view.innerHTML = accountsScreen(st);
  }

  function patchBalances() {
    const st = session.state;
    for (const a of st.accounts) {
      const el = view.querySelector(`[data-balance-for="${a.id}"]`);
      if (el) {
        const bal = st.balances[a.id];
        el.textContent = `${bal == null ? '—' : formatZnyt(bal)} ZNYT`;
      }
    }
  }

  // ------------------------------------------------------------ actions

  async function guard(fn) {
    ui.error = '';
    try {
      await fn();
    } catch (e) {
      ui.error = /Invalid password/.test(e.message) ? t('wrongPassword') : e.message;
      idle();
      render();
    }
  }

  async function enterWallet() {
    ui.screen = 'accounts';
    ui.review = null;
    ui.result = null;
    idle();
    render();
    await Promise.all([session.refreshBalances(), refreshConnection()]);
    patchBalances();
  }

  const actions = {
    async create() {
      const pw = $('create-pw').value;
      if (pw !== $('create-pw2').value) {
        ui.error = t('confirm');
        return render();
      }
      const scheme = pickedScheme('create-scheme');
      busy('creating');
      await paint();
      await guard(async () => {
        await session.create(pw, scheme);
        await enterWallet();
      });
    },

    async unlock() {
      const pw = $('unlock-pw').value;
      busy('unlocking');
      await paint();
      await guard(async () => {
        await session.unlock(pw);
        await enterWallet();
      });
    },

    'reset-open'() {
      ui.showReset = true;
      render();
    },
    'reset-cancel'() {
      ui.showReset = false;
      render();
    },
    'reset-confirm'() {
      session.wipe();
      location.reload();
    },

    lock() {
      session.lock();
      ui.screen = 'accounts';
      ui.review = null;
      ui.result = null;
      render();
    },

    async 'add-account'() {
      const scheme = pickedScheme('add-scheme');
      busy('deriving');
      await paint();
      await guard(async () => {
        await session.addAccount(scheme);
        idle();
        render();
        await session.refreshBalances();
        patchBalances();
      });
    },

    async refresh() {
      await session.refreshBalances();
      patchBalances();
    },

    async faucet(el) {
      busy('broadcasting');
      await guard(async () => {
        await session.faucet(el.dataset.id);
        ui.notice = t('faucetDone');
        idle();
        render();
        setTimeout(async () => {
          await session.refreshBalances();
          patchBalances();
        }, 5000);
      });
    },

    async copy(el) {
      const text = el.dataset.copy;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = doc.createElement('textarea');
        ta.value = text;
        doc.body.appendChild(ta);
        ta.select();
        doc.execCommand('copy');
        ta.remove();
      }
      const old = el.textContent;
      el.textContent = t('copied');
      setTimeout(() => {
        el.textContent = old;
      }, 1500);
    },

    send(el) {
      ui.accountId = el.dataset.id;
      ui.screen = 'send';
      ui.review = null;
      ui.result = null;
      ui.error = '';
      ui.notice = '';
      render();
    },

    receive(el) {
      ui.accountId = el.dataset.id;
      ui.screen = 'receive';
      ui.error = '';
      ui.notice = '';
      render();
    },

    'back-accounts'() {
      ui.screen = 'accounts';
      ui.review = null;
      ui.result = null;
      render();
      patchBalances();
    },

    'back-send'() {
      ui.review = null;
      render();
    },

    'dismiss-banner'() {
      // Session-local dismissal; the session flag itself stays set so
      // the fact of migration remains inspectable.
      ui.bannerDismissed = true;
      render();
    },

    async review() {
      const toRaw = $('send-to').value.trim();
      const dataEl = $('send-data');
      const advanced = $('send-advanced').checked;
      const data = advanced && dataEl ? dataEl.value.trim() || '0x' : '0x';
      let value;
      try {
        value = parseZnyt($('send-value').value);
      } catch {
        ui.error = t('invalidAmount');
        return render();
      }
      const to = toRaw === '' ? null : toRaw;
      if (to !== null && !isAddress(to)) {
        ui.error = t('invalidAddress');
        return render();
      }
      if (!isHexData(data)) {
        ui.error = t('invalidData');
        return render();
      }
      if (to === null && data === '0x') {
        ui.error = t('invalidAddress');
        return render();
      }
      busy('deriving');
      await paint();
      await guard(async () => {
        ui.review = await session.prepareSend(ui.accountId, { to, value, data });
        idle();
        render();
      });
    },

    async approve() {
      const prepared = ui.review;
      if (!prepared) return;
      busy('signing');
      render();
      await paint();
      await guard(async () => {
        const { hash } = await session.executeSend(prepared);
        ui.review = null;
        ui.result = { hash, state: 'pending' };
        ui.busy = '';
        render();
        const done = await session.pollReceipt(hash, {
          onUpdate: ({ state }) => {
            const el = $('receipt-status');
            if (el) {
              el.textContent =
                state === 'success' ? t('receiptOk') : state === 'failed' ? t('receiptNg') : t('receiptPending');
              el.className = state === 'success' ? 'ok' : state === 'failed' ? 'err' : 'muted';
            }
            if (ui.result) ui.result.state = state;
          },
        });
        if (done.state !== 'pending') {
          await session.refreshBalances();
        }
      });
    },

    async 'save-rpc'() {
      await guard(async () => {
        session.setRpcUrl($('rpc-url').value);
        await refreshConnection();
        await session.refreshBalances();
        patchBalances();
        render();
      });
    },
  };

  view.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (actions[act]) actions[act](el, ev);
  });
  doc.getElementById('lock-btn').addEventListener('click', () => actions.lock());
  doc.getElementById('lang-sel').addEventListener('change', (ev) => {
    i18n.setLang(ev.target.value);
    render();
  });
  view.addEventListener('change', (ev) => {
    if (ev.target.id === 'send-advanced') {
      $('send-data-row').hidden = !ev.target.checked;
    }
    if (ev.target.name === 'create-scheme' || ev.target.name === 'add-scheme') {
      // refresh the .sel highlight on scheme cards
      view.querySelectorAll(`input[name="${ev.target.name}"]`).forEach((input) => {
        input.closest('.scheme').classList.toggle('sel', input.checked);
      });
    }
  });
  // Enter key submits the visible password form.
  view.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    if (ev.target.id === 'unlock-pw') actions.unlock();
    if (ev.target.id === 'create-pw2') actions.create();
  });

  let lastStatus = session.state.status;
  session.subscribe((s) => {
    // Only structural transitions re-render from the subscription;
    // balance-only emits are patched in place by the actions.
    if (s.status !== lastStatus) {
      lastStatus = s.status;
      render();
    }
  });

  // ------------------------------------------------------------ boot
  render();
  (async () => {
    // Memory-only sessions: startup never unlocks. start() scrubs any
    // legacy remembered-password key left by a pre-fix build.
    await session.start();
    render();
    refreshConnection();
  })();

  try {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  } catch {
    /* service workers are progressive enhancement only */
  }

  return { session, i18n, ui };
}
