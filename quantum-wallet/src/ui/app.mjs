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
    // Recovery flows (see session phrase/backup APIs). phraseWords is
    // held ONLY in this in-memory UI state while a create or reveal is
    // on screen — never persisted, never logged.
    flow: null, // null | 'phrase-show' | 'phrase-confirm' | 'phrase-password'
    //           | 'restore-phrase' | 'import-backup' | 'reveal' | 'backup'
    phraseWords: null, // string[24] during phrase create
    confirmPositions: [], // 3 word indices to re-enter during create
    revealedWords: null, // string[24] while the reveal panel is open
    backupText: '', // exported encrypted backup JSON awaiting save
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
      <p>${esc(t('phraseIntro'))}</p>
      <button class="primary" data-act="phrase-begin" ${ui.busy ? 'disabled' : ''}>${esc(t('create'))}</button>
      <p class="muted">${esc(t('local'))}</p>
      ${statusLines()}
    </section>
    <section class="panel">
      <h3>${esc(t('restorePhrase'))}</h3>
      <div class="row">
        <button data-act="open-restore-phrase">${esc(t('restorePhrase'))}</button>
        <button data-act="open-import-backup">${esc(t('restore'))}</button>
      </div>
    </section>`;
  }

  function phraseGrid(words) {
    return `<div class="words">${words
      .map((w, i) => `<span class="word"><i>${i + 1}</i>${esc(w)}</span>`)
      .join('')}</div>`;
  }

  function phraseShowScreen() {
    return `<section class="panel">
      <h2>${esc(t('phraseTitle'))}</h2>
      <p class="warn-banner">${esc(t('phraseWarn'))}</p>
      ${phraseGrid(ui.phraseWords ?? [])}
      <div class="row">
        <button class="primary" data-act="phrase-written">${esc(t('phraseWritten'))}</button>
        <button data-act="flow-cancel">${esc(t('cancel'))}</button>
      </div>
      ${statusLines()}
    </section>`;
  }

  function phraseConfirmScreen() {
    return `<section class="panel">
      <h2>${esc(t('phraseConfirmTitle'))}</h2>
      ${ui.confirmPositions
        .map(
          (pos) => `<label>${esc(t('phraseWordN', { n: pos + 1 }))}<br>
        <input id="confirm-word-${pos}" type="text" size="20" spellcheck="false" autocomplete="off"></label><br>`,
        )
        .join('')}
      <div class="row">
        <button class="primary" data-act="phrase-confirm-check">${esc(t('next'))}</button>
        <button data-act="flow-cancel">${esc(t('cancel'))}</button>
      </div>
      ${statusLines()}
    </section>`;
  }

  function phrasePasswordScreen() {
    return `<section class="panel">
      <h2>${esc(t('create'))}</h2>
      <label>${esc(t('password'))}<br>
        <input id="create-pw" type="password" autocomplete="new-password" size="32"></label><br>
      <label>${esc(t('confirmPassword'))}<br>
        <input id="create-pw2" type="password" autocomplete="new-password" size="32"></label>
      <div class="row">
        <button class="primary" data-act="phrase-create" ${ui.busy ? 'disabled' : ''}>${esc(t('create'))}</button>
        <button data-act="flow-cancel">${esc(t('cancel'))}</button>
      </div>
      ${statusLines()}
    </section>`;
  }

  function restorePhraseScreen() {
    return `<section class="panel">
      <h2>${esc(t('restorePhrase'))}</h2>
      <p>${esc(t('restorePhraseIntro'))}</p>
      <label>${esc(t('phraseInputLabel'))}<br>
        <textarea id="restore-words" rows="4" spellcheck="false" autocomplete="off"></textarea></label><br>
      <label>${esc(t('password'))}<br>
        <input id="restore-pw" type="password" autocomplete="new-password" size="32"></label><br>
      <label>${esc(t('confirmPassword'))}<br>
        <input id="restore-pw2" type="password" autocomplete="new-password" size="32"></label>
      <div class="row">
        <button class="primary" data-act="restore-phrase-submit" ${ui.busy ? 'disabled' : ''}>${esc(t('restorePhrase'))}</button>
        <button data-act="flow-cancel">${esc(t('cancel'))}</button>
      </div>
      ${statusLines()}
    </section>`;
  }

  function importBackupScreen() {
    return `<section class="panel">
      <h2>${esc(t('restore'))}</h2>
      <p>${esc(t('importIntro'))}</p>
      <label>${esc(t('backupTitle'))}<br>
        <textarea id="import-text" rows="5" spellcheck="false" autocomplete="off"></textarea></label><br>
      <input id="import-file" type="file" accept=".json,application/json"><br>
      <label>${esc(t('backupPassword'))}<br>
        <input id="import-backup-pw" type="password" autocomplete="off" size="32"></label><br>
      <label>${esc(t('password'))}<br>
        <input id="import-pw" type="password" autocomplete="new-password" size="32"></label><br>
      <label>${esc(t('confirmPassword'))}<br>
        <input id="import-pw2" type="password" autocomplete="new-password" size="32"></label>
      <div class="row">
        <button class="primary" data-act="import-backup-submit" ${ui.busy ? 'disabled' : ''}>${esc(t('restore'))}</button>
        <button data-act="flow-cancel">${esc(t('cancel'))}</button>
      </div>
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
    </section>
    <section class="panel">
      <h3>${esc(t('phraseTitle'))}</h3>
      ${st.hasPhrase ? `
      <p class="muted">${esc(t('revealIntro'))}</p>
      ${ui.revealedWords ? `
      <p class="warn-banner">${esc(t('phraseWarn'))}</p>
      ${phraseGrid(ui.revealedWords)}
      <button data-act="reveal-hide">${esc(t('hidePhrase'))}</button>` : `
      <label>${esc(t('password'))}<br>
        <input id="reveal-pw" type="password" autocomplete="current-password" size="32"></label><br>
      <button data-act="reveal-submit" ${ui.busy ? 'disabled' : ''}>${esc(t('showPhrase'))}</button>`}` : `
      <p class="muted">${esc(t('noPhrase'))}</p>`}
    </section>
    <section class="panel">
      <h3>${esc(t('backupTitle'))}</h3>
      <p class="muted">${esc(t('backupIntro'))}</p>
      <label>${esc(t('backupPassword'))}<br>
        <input id="backup-pw" type="password" autocomplete="new-password" size="32"></label><br>
      <label>${esc(t('confirmPassword'))}<br>
        <input id="backup-pw2" type="password" autocomplete="new-password" size="32"></label>
      <div class="row">
        <button data-act="export-backup" ${ui.busy ? 'disabled' : ''}>${esc(t('backup'))}</button>
      </div>
      ${ui.backupText ? `
      <p class="ok">${esc(t('backupReady'))}</p>
      <textarea id="backup-text" rows="5" readonly spellcheck="false">${esc(ui.backupText)}</textarea>
      <div class="row">
        <button data-act="download-backup">${esc(t('downloadBackup'))}</button>
        <button data-act="copy-backup">${esc(t('copy'))}</button>
      </div>` : ''}
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
    if (st.status === 'no-vault') {
      if (ui.flow === 'phrase-show') view.innerHTML = phraseShowScreen();
      else if (ui.flow === 'phrase-confirm') view.innerHTML = phraseConfirmScreen();
      else if (ui.flow === 'phrase-password') view.innerHTML = phrasePasswordScreen();
      else if (ui.flow === 'restore-phrase') view.innerHTML = restorePhraseScreen();
      else if (ui.flow === 'import-backup') view.innerHTML = importBackupScreen();
      else view.innerHTML = createScreen();
    }
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

  function pickConfirmPositions() {
    const set = new Set();
    while (set.size < 3) set.add(crypto.getRandomValues(new Uint8Array(1))[0] % 24);
    return [...set].sort((a, b) => a - b);
  }

  function clearFlow() {
    ui.flow = null;
    ui.phraseWords = null;
    ui.confirmPositions = [];
    ui.revealedWords = null;
  }

  const actions = {
    // ---------------------------------------------------- phrase create
    async 'phrase-begin'() {
      await guard(async () => {
        ui.phraseWords = session.beginPhraseCreate();
        ui.flow = 'phrase-show';
        render();
      });
    },

    'phrase-written'() {
      ui.confirmPositions = pickConfirmPositions();
      ui.flow = 'phrase-confirm';
      render();
    },

    'phrase-confirm-check'() {
      const ok = ui.confirmPositions.every(
        (pos) => ($(`confirm-word-${pos}`)?.value ?? '').trim().toLowerCase() === ui.phraseWords?.[pos],
      );
      if (!ok) {
        ui.error = t('phraseMismatch');
        return render();
      }
      ui.error = '';
      ui.flow = 'phrase-password';
      render();
    },

    async 'phrase-create'() {
      const pw = $('create-pw').value;
      if (pw !== $('create-pw2').value) {
        ui.error = t('confirm');
        return render();
      }
      busy('creating');
      await paint();
      await guard(async () => {
        await session.createFromPhrase(pw);
        clearFlow();
        await enterWallet();
      });
    },

    // ---------------------------------------------------- restore/import
    'open-restore-phrase'() {
      ui.flow = 'restore-phrase';
      ui.error = '';
      render();
    },

    async 'restore-phrase-submit'() {
      const pw = $('restore-pw').value;
      if (pw !== $('restore-pw2').value) {
        ui.error = t('confirm');
        return render();
      }
      const words = $('restore-words').value;
      busy('restoring');
      await paint();
      try {
        const { probed } = await session.restoreFromPhrase(words, pw);
        clearFlow();
        await enterWallet();
        ui.notice = probed ? t('restoreDoneProbed') : t('restoreDoneOffline');
        render();
      } catch (e) {
        idle();
        ui.error = /Recovery phrase|Unknown word/.test(e.message) ? t('phraseInvalid') : e.message;
        render();
      }
    },

    'open-import-backup'() {
      ui.flow = 'import-backup';
      ui.error = '';
      render();
    },

    async 'import-backup-submit'() {
      const pw = $('import-pw').value;
      if (pw !== $('import-pw2').value) {
        ui.error = t('confirm');
        return render();
      }
      const text = $('import-text').value;
      const backupPw = $('import-backup-pw').value;
      busy('restoring');
      await paint();
      try {
        await session.importBackup(text, backupPw, pw);
        clearFlow();
        await enterWallet();
      } catch (e) {
        idle();
        ui.error = /Invalid password/.test(e.message)
          ? t('wrongPassword')
          : /Invalid backup/.test(e.message)
            ? t('backupInvalid')
            : e.message;
        render();
      }
    },

    'flow-cancel'() {
      session.cancelPhraseCreate();
      clearFlow();
      ui.error = '';
      render();
    },

    // ---------------------------------------------------- settings: phrase
    async 'reveal-submit'() {
      const pw = $('reveal-pw').value;
      busy('unlocking');
      await paint();
      await guard(async () => {
        ui.revealedWords = await session.revealPhrase(pw);
        idle();
        render();
      });
    },

    'reveal-hide'() {
      ui.revealedWords = null;
      render();
    },

    // ---------------------------------------------------- settings: backup
    async 'export-backup'() {
      const pw = $('backup-pw').value;
      if (pw !== $('backup-pw2').value) {
        ui.error = t('confirm');
        return render();
      }
      busy('exporting');
      await paint();
      await guard(async () => {
        ui.backupText = await session.exportBackup(pw);
        idle();
        render();
      });
    },

    'download-backup'() {
      const blob = new Blob([ui.backupText], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = 'zeronyth-wallet-backup.json';
      doc.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    },

    async 'copy-backup'(el) {
      try {
        await navigator.clipboard.writeText(ui.backupText);
      } catch {
        $('backup-text')?.select();
        doc.execCommand('copy');
      }
      const old = el.textContent;
      el.textContent = t('copied');
      setTimeout(() => {
        el.textContent = old;
      }, 1500);
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
      clearFlow();
      ui.backupText = '';
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
    if (ev.target.id === 'import-file') {
      const file = ev.target.files?.[0];
      if (file) {
        file.text().then((text) => {
          const ta = $('import-text');
          if (ta) ta.value = text;
        });
      }
    }
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
    if (ev.target.id === 'create-pw2') actions['phrase-create']();
    if (ev.target.id === 'reveal-pw') actions['reveal-submit']();
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
