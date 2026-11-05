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
import { parseZnyt, formatZnyt, parseAmount, formatAmount, isAddress, isHexData } from '../core/amount.mjs';
import { schemeAllowedOn, explorerTxUrlFor } from '../core/networks.mjs';
import { createI18n } from '../i18n.mjs';
import { createSession, explorerTxUrl } from '../app/session.mjs';
import { scheduleClipboardClear } from '../app/clipboard.mjs';
import {
  createIdleLockController,
  readAutoLockPrefs,
  writeAutoLockPrefs,
  AUTOLOCK_MINUTE_CHOICES,
} from '../app/idle.mjs';
import BUILD_INFO from '../build-info.mjs';

const LANG_LABELS = { ja: '日本語', en: 'English', 'zh-CN': '简体中文', ko: '한국어' };
const SCHEME_ORDER = ['ecdsa', 'falcon', 'mldsa'];
const SCHEME_NOTE_KEY = { ecdsa: 'noteEcdsa', falcon: 'noteFalcon', mldsa: 'noteMldsa' };
const FAMILY_ORDER = ['solana', 'bitcoin', 'xrp', 'sui', 'aptos'];
const FAMILY_NOTE_KEY = {
  solana: 'noteSolana',
  bitcoin: 'noteBitcoin',
  xrp: 'noteXrp',
  sui: 'noteSui',
  aptos: 'noteAptos',
};

export function startApp(doc = document) {
  const storage = browserStorage();
  const i18n = createI18n(storage);
  const session = createSession({ storage });
  const t = (key, vars) => i18n.t(key, vars);

  const ui = {
    screen: 'accounts', // accounts | send | receive | swap
    accountId: null,
    asset: 'native', // send-screen asset: 'native' | token address
    review: null,
    result: null, // { hash, state }
    swapPools: null, // native AMM pools from the manifest (ZERONYTH)
    swapPoolId: '',
    swapDir: 'buy',
    swapAccountId: '',
    swapQuote: null,
    swapResult: null, // { hashes }
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

  // ------------------------------------------------------------ networks

  const net = () => session.getNetwork();
  /** True when the account's scheme may operate on the selected network. */
  const operable = (a) => schemeAllowedOn(net(), a.scheme);
  /** The account's address as seen on the selected network. */
  const displayAddress = (a) =>
    net().kind === 'evm' ? a.address : session.familyAddress(a);
  const fmtAmt = (v, decimals) => formatAmount(v, decimals);
  const netLabel = (n) => n.name + (n.testnet ? t('testnetSuffix') : '');
  const netChainLabel = (n) =>
    n.kind === 'evm' ? `${netLabel(n)} · Chain ${n.chainId}` : netLabel(n);

  let netSelLang = null;
  function networkOptionsHtml() {
    const evm = session.networks.filter((n) => n.kind === 'evm');
    const fams = session.networks.filter((n) => n.kind !== 'evm');
    const opt = (n) => `<option value="${n.id}">${esc(netLabel(n))}</option>`;
    return `<optgroup label="EVM">${evm.map(opt).join('')}</optgroup>` +
      `<optgroup label="Non-EVM">${fams.map(opt).join('')}</optgroup>`;
  }

  // ------------------------------------------------------------ header

  function renderHeader() {
    const st = session.state;
    const lockBtn = $('lock-btn');
    lockBtn.hidden = st.status !== 'unlocked';
    lockBtn.textContent = t('lock');
    $('lang-sel').value = i18n.lang;
    $('lang-sel').setAttribute('aria-label', t('language'));
    const netSel = $('net-sel');
    if (netSel) {
      if (netSelLang !== i18n.lang) {
        netSel.innerHTML = networkOptionsHtml();
        netSelLang = i18n.lang;
      }
      netSel.value = st.networkId;
      netSel.setAttribute('aria-label', t('networkSelect'));
    }
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

  function schemePicker(name, selected = 'mldsa', order = SCHEME_ORDER, notes = SCHEME_NOTE_KEY) {
    return `<div class="schemes" role="radiogroup">${order.map(
      (s) => `
      <label class="scheme ${s === selected ? 'sel' : ''}">
        <input type="radio" name="${name}" value="${s}" ${s === selected ? 'checked' : ''}>
        <span class="badge ${s}">${esc(SCHEMES[s].name)}</span>
        ${s === 'falcon' || s === 'mldsa' ? `<span class="qr">${esc(t('quantumResistant'))}</span>` : ''}
        <span class="note">${esc(t(notes[s]))}</span>
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
    const n = net();
    const st = session.state;
    const addr = displayAddress(a);
    if (!operable(a)) {
      // Greyed out: the account exists but cannot act on this network.
      // PQ accounts say why (ZERONYTH only); chain accounts are simply
      // not available here.
      const note =
        a.scheme === 'falcon' || a.scheme === 'mldsa' ? t('zeronythOnly') : t('notAvailableOnNetwork');
      return `<div class="acct disabled">
      <div class="row">
        <span class="badge ${a.scheme}">${esc(a.schemeName)}</span>
        <span class="muted">${esc(note)}</span>
      </div>
      <div class="addr mono">${esc(addr)}</div>
      <div class="row">
        <button data-act="copy" data-copy="${esc(addr)}">${esc(t('copy'))}</button>
      </div>
    </div>`;
    }
    const bal = st.balances[a.id];
    const tokenLines = (n.tokens ?? [])
      .map((tok) => {
        const tb = st.tokenBalances[a.id]?.[tok.address.toLowerCase()];
        return `<div class="row"><span class="muted">${esc(tok.symbol)}</span>
        <span class="bal" data-token-balance-for="${a.id}:${tok.address.toLowerCase()}">${tb == null ? '—' : esc(fmtAmt(tb, tok.decimals))} ${esc(tok.symbol)}</span></div>`;
      })
      .join('');
    return `<div class="acct">
      <div class="row">
        <span class="badge ${a.scheme}">${esc(a.schemeName)}</span>
        <span class="bal" data-balance-for="${a.id}">${bal == null ? '—' : esc(fmtAmt(bal, n.native.decimals))} ${esc(n.native.symbol)}</span>
      </div>
      ${tokenLines}
      <div class="addr mono">${esc(addr)}</div>
      <div class="row">
        <button data-act="send" data-id="${a.id}">${esc(t('send'))}</button>
        <button data-act="receive" data-id="${a.id}">${esc(t('receive'))}</button>
        ${n.faucet ? `<button data-act="faucet" data-id="${a.id}">＋ ${esc(t('faucet'))}</button>` : ''}
        <button data-act="copy" data-copy="${esc(addr)}">${esc(t('copy'))}</button>
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
      <p class="muted">${esc(t('phraseRestoresAll'))}</p>
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
      <p class="muted">${esc(t('phraseRestoresAll'))}</p>
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
    const n = net();
    const known = st.accounts
      .filter((a) => operable(a))
      .map((a) => st.balances[a.id])
      .filter((b) => b != null);
    const total = known.reduce((sum, b) => sum + b, 0n);
    const prefs = readAutoLockPrefs(storage);
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
      <p class="muted">${esc(t('network'))}: <strong>${esc(netChainLabel(n))}</strong></p>
      ${n.id === 'zeronyth' ? `<p class="muted">${esc(t('total'))}: <strong>${esc(formatZnyt(total))} ZNYT</strong></p>` : ''}
      ${st.accounts.length ? st.accounts.map(accountCard).join('') : `<p class="muted">${esc(t('noAccounts'))}</p>`}
      ${n.id === 'zeronyth' ? `<p class="muted">${esc(t('chainNote'))}</p>` : ''}
      <div class="row">
        <button data-act="open-swap">${esc(t('swap'))}</button>
      </div>
      ${statusLines()}
    </section>
    <section class="panel">
      <h3>${esc(t('addAccount'))}</h3>
      ${schemePicker('add-scheme', 'mldsa')}
      <button data-act="add-account" ${ui.busy ? 'disabled' : ''}>${esc(t('addAccount'))}</button>
      <h3>${esc(t('addChainAccount'))}</h3>
      ${schemePicker('add-chain-scheme', 'solana', FAMILY_ORDER, FAMILY_NOTE_KEY)}
      <button data-act="add-chain-account" ${ui.busy ? 'disabled' : ''}>${esc(t('addChainAccount'))}</button>
    </section>
    <section class="panel">
      <h3>${esc(t('settings'))}</h3>
      <label>${esc(t('rpc'))} — ${esc(netLabel(n))}<br>
        <input id="rpc-url" type="text" value="${esc(session.getRpcUrl())}" size="42" spellcheck="false"></label><br>
      <button data-act="save-rpc">${esc(t('save'))}</button>
      ${st.customRpc ? `<p class="warn-banner">${esc(t('rpcCaution'))}</p>` : ''}
      <p class="muted">${esc(t('note'))}</p>
      <label>${esc(t('autoLock'))}<br>
        <select id="autolock-sel">
          <option value="off" ${!prefs.enabled ? 'selected' : ''}>${esc(t('autoLockOff'))}</option>
          ${AUTOLOCK_MINUTE_CHOICES.map((m) => `<option value="${m}" ${prefs.enabled && prefs.minutes === m ? 'selected' : ''}>${esc(t('autoLockMin', { n: m }))}</option>`).join('')}
        </select></label><br>
      <p class="muted">${esc(t('buildVersion'))}: Quantum Wallet ${esc(BUILD_INFO.version)} · build ${esc(BUILD_INFO.commit)}</p>
    </section>
    <section class="panel">
      <h3>${esc(t('phraseTitle'))}</h3>
      ${st.hasPhrase ? `
      <p class="muted">${esc(t('revealIntro'))}</p>
      <p class="muted">${esc(t('phraseRestoresAll'))}</p>
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
      <p class="muted">${esc(t('backupPwNote'))}</p>
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

  /** Selected send asset descriptor on the current network. */
  function sendAsset() {
    const n = net();
    if (ui.asset !== 'native') {
      const tok = (n.tokens ?? []).find((x) => x.address === ui.asset);
      if (tok) return { id: tok.address, symbol: tok.symbol, decimals: tok.decimals, token: tok };
    }
    return { id: 'native', symbol: n.native.symbol, decimals: n.native.decimals, token: null };
  }

  function sendScreen(st) {
    const account = st.accounts.find((a) => a.id === ui.accountId);
    if (!account) return accountsScreen(st);
    const n = net();
    if (!operable(account)) {
      return `<section class="panel">
        <h2>${esc(t('send'))}</h2>
        <p class="warn-banner">${esc(t('notAvailableOnNetwork'))}</p>
        <button data-act="back-accounts">${esc(t('back'))}</button>
        ${statusLines()}
      </section>`;
    }
    if (ui.result) {
      const r = ui.result;
      const txUrl = explorerTxUrlFor(n, r.hash);
      return `<section class="panel">
        <h2>${esc(t('send'))}</h2>
        <p class="ok">${esc(t('success'))}</p>
        <p>${esc(t('txHash'))}<br><span class="mono">${esc(r.hash)}</span></p>
        ${txUrl ? `<p><a href="${esc(txUrl)}" target="_blank" rel="noopener">${esc(t('viewExplorer'))}</a></p>` : ''}
        <p>${esc(t('status'))}: <span id="receipt-status" class="${r.state === 'success' ? 'ok' : r.state === 'failed' ? 'err' : 'muted'}">${
          r.state === 'success' ? esc(t('receiptOk')) : r.state === 'failed' ? esc(t('receiptNg')) : esc(t('receiptPending'))
        }</span></p>
        <button data-act="back-accounts">${esc(t('back'))}</button>
        ${statusLines()}
      </section>`;
    }
    if (ui.review) {
      const p = ui.review;
      const nativeBal = p.nativeBalance ?? p.balance;
      const tooPoor =
        p.kind === 'chain'
          ? p.balance != null && p.value + p.fee > p.balance
          : p.asset !== 'native'
            ? (p.balance != null && p.value > p.balance) || (nativeBal != null && p.fee > nativeBal)
            : nativeBal != null && p.value + p.fee > nativeBal;
      return `<section class="panel">
        <h2>${esc(t('review'))}</h2>
        <table class="kv">
          <tr><th>${esc(t('network'))}</th><td>${esc(netChainLabel(n))}</td></tr>
          <tr><th>${esc(t('from'))}</th><td class="mono">${esc(p.from)}</td></tr>
          <tr><th>${esc(t('recipient'))}</th><td class="mono">${p.to ? esc(p.to) : esc(t('contractCreation'))}</td></tr>
          <tr><th>${esc(t('amount'))}</th><td>${esc(fmtAmt(p.value, p.decimals))} ${esc(p.symbol)}</td></tr>
          ${p.destinationTag != null ? `<tr><th>${esc(t('destTag'))}</th><td>${p.destinationTag}</td></tr>` : ''}
          ${p.data !== '0x' ? `<tr><th>${esc(t('data'))}</th><td class="mono">${esc(p.data.length > 66 ? p.data.slice(0, 66) + '…' : p.data)}</td></tr>` : ''}
          ${p.kind === 'evm' ? `<tr><th>${esc(t('gasLimit'))}</th><td>${p.gasLimit.toString()}</td></tr>
          <tr><th>${esc(t('gasPrice'))}</th><td>${p.gasPrice.toString()}</td></tr>` : ''}
          <tr><th>${esc(t('feeEstimate'))}</th><td>${esc(fmtAmt(p.fee, n.native.decimals))} ${esc(n.native.symbol)}</td></tr>
          ${p.kind === 'evm' ? `<tr><th>${esc(t('chain'))}</th><td>${p.chainId.toString()}</td></tr>` : ''}
        </table>
        ${p.recipientIsContract ? `<p class="warn-banner">${esc(t('contractWarn'))}</p>` : ''}
        ${p.firstSend ? `<p class="warn-banner">${esc(t('firstSendWarn'))}</p>
        <label class="check"><input id="first-ack" type="checkbox"> ${esc(t('firstSendAck'))}</label>` : ''}
        ${tooPoor ? `<p class="err">${esc(t('insufficient'))}</p>` : ''}
        <div class="row">
          <button class="primary" data-act="approve" ${ui.busy || tooPoor ? 'disabled' : ''}>${esc(t('approve'))}</button>
          <button data-act="back-send">${esc(t('cancel'))}</button>
        </div>
        ${statusLines()}
      </section>`;
    }
    const asset = sendAsset();
    return `<section class="panel">
      <h2>${esc(t('send'))}</h2>
      <p class="muted">${esc(netChainLabel(n))}</p>
      <p><span class="badge ${account.scheme}">${esc(account.schemeName)}</span>
         <span class="mono">${esc(displayAddress(account))}</span></p>
      ${(n.tokens ?? []).length ? `<label>${esc(t('asset'))}<br>
        <select id="send-asset">
          <option value="native" ${ui.asset === 'native' ? 'selected' : ''}>${esc(n.native.symbol)}</option>
          ${n.tokens.map((tok) => `<option value="${esc(tok.address)}" ${ui.asset === tok.address ? 'selected' : ''}>${esc(tok.symbol)}</option>`).join('')}
        </select></label><br>` : ''}
      <label>${esc(t('recipient'))}<br>
        <input id="send-to" type="text" size="44" spellcheck="false" placeholder="${n.kind === 'evm' ? '0x…' : ''}"></label><br>
      <label>${esc(t('amount'))} (${esc(asset.symbol)})<br>
        <input id="send-value" type="text" inputmode="decimal" size="24" placeholder="0.0"></label><br>
      ${n.kind === 'xrp' ? `<label>${esc(t('destTag'))}<br>
        <input id="send-tag" type="text" inputmode="numeric" size="16" spellcheck="false"></label><br>` : ''}
      ${n.kind === 'evm' ? `<label class="check"><input id="send-advanced" type="checkbox"> ${esc(t('advanced'))}</label>
      <div id="send-data-row" hidden>
        <label>${esc(t('data'))}<br>
          <input id="send-data" type="text" size="44" spellcheck="false" placeholder="0x"></label>
        <p class="muted">${esc(t('contractCreation'))}: ${esc(t('recipient'))} —</p>
      </div>` : ''}
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
    const n = net();
    const addr = displayAddress(account);
    return `<section class="panel">
      <h2>${esc(t('receive'))}</h2>
      <p class="muted">${esc(netChainLabel(n))}</p>
      <p><span class="badge ${account.scheme}">${esc(account.schemeName)}</span></p>
      <p>${esc(t('yourAddress'))}</p>
      <p class="addr-big mono">${esc(addr)}</p>
      <div class="row">
        <button data-act="copy" data-copy="${esc(addr)}">${esc(t('copy'))}</button>
        <button data-act="back-accounts">${esc(t('back'))}</button>
      </div>
      ${n.kind === 'evm' ? `<p class="muted">${esc(t('receiveWarn'))}</p>` : ''}
      ${n.kind === 'xrp' ? `<p class="muted">${esc(t('noteXrp'))}</p>` : ''}
      ${statusLines()}
    </section>`;
  }

  function swapScreen(st) {
    const n = net();
    if (n.id !== 'zeronyth') {
      return `<section class="panel">
        <h2>${esc(t('swap'))}</h2>
        <p class="warn-banner">${esc(t('swapUnavailable'))}</p>
        <button data-act="back-accounts">${esc(t('back'))}</button>
        ${statusLines()}
      </section>`;
    }
    const pools = ui.swapPools ?? [];
    const pool = pools.find((p) => p.id === ui.swapPoolId) ?? pools[0];
    const q = ui.swapQuote;
    const accounts = st.accounts.filter((a) => operable(a));
    return `<section class="panel">
      <h2>${esc(t('swap'))}</h2>
      ${ui.swapResult ? `<p class="ok">${esc(t('swapDone'))}</p>
      ${ui.swapResult.hashes.map((h) => `<p class="mono">${esc(h)}<br><a href="${esc(explorerTxUrl(h))}" target="_blank" rel="noopener">${esc(t('viewExplorer'))}</a></p>`).join('')}` : ''}
      <label>${esc(t('pair'))}<br>
        <select id="swap-pool">
          ${pools.map((p) => `<option value="${esc(p.id)}" ${pool && p.id === pool.id ? 'selected' : ''}>ZNYT / ${esc(p.b)}</option>`).join('')}
        </select></label><br>
      <label>${esc(t('swapFrom'))}<br>
        <select id="swap-dir">
          <option value="buy" ${ui.swapDir === 'buy' ? 'selected' : ''}>ZNYT → ${esc(pool?.b ?? '')}</option>
          <option value="sell" ${ui.swapDir === 'sell' ? 'selected' : ''}>${esc(pool?.b ?? '')} → ZNYT</option>
        </select></label><br>
      <label>${esc(t('amount'))}<br>
        <input id="swap-amount" type="text" inputmode="decimal" size="24" placeholder="0.0"></label><br>
      <label>${esc(t('slippage'))}<br>
        <input id="swap-slippage" type="text" inputmode="decimal" size="8" value="1"></label><br>
      <label>${esc(t('from'))}<br>
        <select id="swap-account">
          ${accounts.map((a) => `<option value="${a.id}" ${a.id === ui.swapAccountId ? 'selected' : ''}>${esc(a.schemeName)} · ${esc(a.address)}</option>`).join('')}
        </select></label><br>
      <div class="row">
        <button data-act="swap-quote" ${ui.busy ? 'disabled' : ''}>${esc(t('review'))}</button>
        <button data-act="back-accounts">${esc(t('back'))}</button>
      </div>
      ${q ? `<table class="kv">
        <tr><th>${esc(t('swapFrom'))}</th><td>${esc(formatZnyt(q.amountIn))} ${esc(q.sellSymbol)}</td></tr>
        <tr><th>${esc(t('swapTo'))}</th><td>${esc(formatZnyt(q.amountOut))} ${esc(q.buySymbol)}</td></tr>
        <tr><th>${esc(t('minReceived'))}</th><td>${esc(formatZnyt(q.minOut))} ${esc(q.buySymbol)}</td></tr>
      </table>
      <div class="row">
        <button class="primary" data-act="swap-execute" ${ui.busy ? 'disabled' : ''}>${esc(t('swapExecute'))}</button>
      </div>` : ''}
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
    else if (ui.screen === 'swap') view.innerHTML = swapScreen(st);
    else view.innerHTML = accountsScreen(st);
  }

  function patchBalances() {
    const st = session.state;
    const n = net();
    for (const a of st.accounts) {
      const el = view.querySelector(`[data-balance-for="${a.id}"]`);
      if (el) {
        const bal = st.balances[a.id];
        el.textContent = `${bal == null ? '—' : fmtAmt(bal, n.native.decimals)} ${n.native.symbol}`;
      }
      for (const tok of n.tokens ?? []) {
        const tel = view.querySelector(
          `[data-token-balance-for="${a.id}:${tok.address.toLowerCase()}"]`,
        );
        if (tel) {
          const tb = st.tokenBalances[a.id]?.[tok.address.toLowerCase()];
          tel.textContent = `${tb == null ? '—' : fmtAmt(tb, tok.decimals)} ${tok.symbol}`;
        }
      }
    }
  }

  // ------------------------------------------------------------ actions

  /** Map raw session/engine errors onto localized copy where it exists. */
  function localizeError(message) {
    let m;
    if (/Invalid password/.test(message)) return t('wrongPassword');
    if ((m = message.match(/Too many attempts — wait (\d+)s/))) {
      return t('tooManyAttempts', { seconds: m[1] });
    }
    if ((m = message.match(/Chain ID mismatch: RPC reports chain (\d+), expected (\d+)/))) {
      return t('chainIdMismatch', { reported: m[1], expected: m[2] });
    }
    if (/PQ accounts can only send/.test(message)) return t('pqOnlyOnZeronyth');
    if (/Swap is only available on ZERONYTH/.test(message)) return t('swapUnavailable');
    return message;
  }

  async function guard(fn) {
    ui.error = '';
    try {
      await fn();
    } catch (e) {
      ui.error = localizeError(e.message);
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
      if (pw.length < 12) {
        ui.error = t('backupPwShort');
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
        scheduleClipboardClear({ clipboard: navigator.clipboard, text: ui.backupText });
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
      ui.asset = 'native';
      ui.swapQuote = null;
      ui.swapResult = null;
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

    async 'add-chain-account'() {
      const el = view.querySelector('input[name="add-chain-scheme"]:checked');
      const scheme = el ? el.value : 'solana';
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

    // ------------------------------------------------------------- swap

    async 'open-swap'() {
      ui.screen = 'swap';
      ui.swapQuote = null;
      ui.swapResult = null;
      ui.error = '';
      ui.notice = '';
      if (!ui.swapAccountId) {
        ui.swapAccountId = session.state.accounts.find((a) => operable(a))?.id ?? '';
      }
      render();
      if (net().id === 'zeronyth' && !ui.swapPools) {
        await guard(async () => {
          const manifest = await session.getSwapManifest();
          ui.swapPools = (manifest.pools ?? []).filter((p) => p.kind === 'native');
          if (!ui.swapPoolId && ui.swapPools[0]) ui.swapPoolId = ui.swapPools[0].id;
          render();
        });
      }
    },

    async 'swap-quote'() {
      const poolId = $('swap-pool')?.value;
      const direction = $('swap-dir')?.value ?? 'buy';
      let amountIn;
      try {
        amountIn = parseZnyt($('swap-amount').value);
      } catch {
        ui.error = t('invalidAmount');
        return render();
      }
      const slipPct = Number(($('swap-slippage')?.value ?? '1').trim());
      if (!Number.isFinite(slipPct) || slipPct < 0 || slipPct > 50) {
        ui.error = t('invalidAmount');
        return render();
      }
      ui.swapPoolId = poolId;
      ui.swapDir = direction;
      busy('deriving');
      await paint();
      await guard(async () => {
        ui.swapQuote = await session.quoteSwap({
          poolId,
          direction,
          amountIn,
          slippageBps: Math.round(slipPct * 100),
        });
        idle();
        render();
      });
    },

    async 'swap-execute'() {
      const accountId = $('swap-account')?.value;
      if (!accountId || !ui.swapQuote) return;
      busy('swapping');
      render();
      await paint();
      await guard(async () => {
        const plan = await session.prepareSwap({
          accountId,
          poolId: ui.swapQuote.pool.id,
          direction: ui.swapQuote.direction,
          amountIn: ui.swapQuote.amountIn,
          slippageBps: ui.swapQuote.slippageBps,
        });
        const { hashes } = await session.executeSwap(plan);
        ui.swapResult = { hashes };
        ui.swapQuote = null;
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
        // Hygiene: clear the address from the clipboard in 30 s, but
        // only if it still holds exactly what we copied.
        scheduleClipboardClear({ clipboard: navigator.clipboard, text });
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
      ui.asset = 'native';
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
      const n = net();
      const asset = sendAsset();
      const toRaw = $('send-to').value.trim();
      const dataEl = $('send-data');
      const advanced = $('send-advanced')?.checked;
      const data = advanced && dataEl ? dataEl.value.trim() || '0x' : '0x';
      let value;
      try {
        value = parseAmount($('send-value').value, asset.decimals);
      } catch {
        ui.error = t('invalidAmount');
        return render();
      }
      const to = toRaw === '' ? null : toRaw;
      if (n.kind === 'evm') {
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
      } else if (to === null) {
        ui.error = t('invalidAddress');
        return render();
      }
      let destinationTag;
      if (n.kind === 'xrp') {
        const tagRaw = ($('send-tag')?.value ?? '').trim();
        if (tagRaw !== '') {
          if (!/^\d+$/.test(tagRaw) || Number(tagRaw) > 4294967295) {
            ui.error = t('invalidData');
            return render();
          }
          destinationTag = Number(tagRaw);
        }
      }
      busy('deriving');
      await paint();
      await guard(async () => {
        const prepared = await session.prepareSend(ui.accountId, {
          to,
          value,
          data,
          asset: asset.id,
          destinationTag,
        });
        ui.review = {
          ...prepared,
          firstSend: prepared.to ? session.isFirstSendTo(prepared.to) : false,
          destinationTag: destinationTag ?? prepared.destinationTag ?? null,
        };
        idle();
        render();
      });
    },

    async approve() {
      const prepared = ui.review;
      if (!prepared) return;
      if (prepared.firstSend && !$('first-ack')?.checked) {
        ui.error = t('firstSendWarn');
        return render();
      }
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
  doc.getElementById('net-sel')?.addEventListener('change', async (ev) => {
    await guard(async () => {
      session.setNetwork(ev.target.value);
      ui.screen = 'accounts';
      ui.review = null;
      ui.result = null;
      ui.asset = 'native';
      ui.swapQuote = null;
      ui.swapResult = null;
      ui.error = '';
      ui.notice = '';
      render();
      await Promise.all([session.refreshBalances(), refreshConnection()]);
      patchBalances();
    });
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
    if (ev.target.id === 'send-asset') {
      ui.asset = ev.target.value;
      render();
    }
    if (ev.target.id === 'swap-pool') {
      ui.swapPoolId = ev.target.value;
      ui.swapQuote = null;
      render();
    }
    if (ev.target.id === 'swap-dir') {
      ui.swapDir = ev.target.value;
      ui.swapQuote = null;
    }
    if (ev.target.id === 'swap-account') {
      ui.swapAccountId = ev.target.value;
    }
    if (ev.target.id === 'autolock-sel') {
      const v = ev.target.value;
      if (v === 'off') writeAutoLockPrefs(storage, { enabled: false, minutes: readAutoLockPrefs(storage).minutes });
      else writeAutoLockPrefs(storage, { enabled: true, minutes: Number(v) });
      restartIdle();
    }
    if (
      ev.target.name === 'create-scheme' ||
      ev.target.name === 'add-scheme' ||
      ev.target.name === 'add-chain-scheme'
    ) {
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

  // ------------------------------------------------------------ idle lock

  // Auto-lock wiring (hardening): the controller polls the pure
  // IdleTracker decision machine; locking is the ordinary lock action,
  // which drops the decrypted vault from memory. Preferences are read
  // fresh on every poll for the enabled flag; a minutes change (or an
  // off→on toggle) restarts the controller so the new timeout applies.
  let idleController = null;
  function restartIdle() {
    idleController?.stop();
    idleController = createIdleLockController({
      doc,
      storage,
      isUnlocked: () => session.state.status === 'unlocked',
      onLock: () => {
        if (session.state.status === 'unlocked') actions.lock();
      },
    });
  }
  restartIdle();

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
