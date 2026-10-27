import { buildGuardedNativePlan, sendGuardedNativeTransfer } from './guarded-send.mjs';
import { wallet, connectSelectedWallet } from './wallet-ui.mjs';
import { setText, clearText } from './i18n.mjs';
import { KeyedError, localizeGuardError } from './i18n-errors.mjs';

const $ = (id) => document.getElementById(id);
const destination = $('guardDestination');
const verified = $('guardVerified');
const amount = $('guardAmount');
const connect = $('guardConnect');
const preview = $('guardPreview');
const confirm = $('guardConfirm');
const send = $('guardSend');
const status = $('guardStatus');
const account = $('guardAccount');
let currentPlan = null;
let reviewedSender = null;
let reviewedProvider = null;
let reviewVersion = 0;

function form() {
  return {
    network: 'ZNYT',
    requestedRecipient: destination.value.trim(),
    verifiedRecipient: verified.value.trim(),
    amountNative: amount.value.trim(),
  };
}

function say(el, key, params) { clearText(el); setText(el, key, params); }

function invalidate(key, params) {
  reviewVersion++;
  currentPlan = null;
  reviewedSender = null;
  reviewedProvider = null;
  confirm.checked = false;
  confirm.disabled = true;
  send.disabled = true;
  if (key) say(status, key, params);
}

function showError(error) {
  const d = localizeGuardError(error);
  invalidate('guard.blocked', { error: d });
  status.classList.add('bad');
}

async function connectWallet() {
  try {
    await connectSelectedWallet();
    const provider = wallet.provider;
    if (!provider?.request) throw new KeyedError('guard.e.noEip');
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (!Array.isArray(accounts) || !accounts[0]) throw new KeyedError('guard.e.noAccount');
    setText(account, 'guard.selected', { account: accounts[0] });
    invalidate('guard.connected');
    status.classList.remove('bad');
  } catch (error) { showError(error); }
}

async function review() {
  const version = ++reviewVersion;
  preview.disabled = true;
  try {
    const provider = wallet.provider;
    if (!provider?.request) throw new KeyedError('guard.e.connectFirst');
    const chainId = await provider.request({ method: 'eth_chainId' });
    if (BigInt(chainId) !== 9127n) throw new KeyedError('guard.e.wrongChain');
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (!Array.isArray(accounts) || !/^0x[\da-fA-F]{40}$/.test(accounts[0] ?? '')) throw new KeyedError('guard.e.noSender');
    const plan = buildGuardedNativePlan(form());
    if (version !== reviewVersion || provider !== wallet.provider) throw new KeyedError('guard.e.changedDuring');
    reviewedSender = accounts[0];
    reviewedProvider = provider;
    currentPlan = plan;
    status.classList.remove('bad');
    clearText(status);
    for (const [key, params] of [
      ['guard.r.head'],
      ['guard.r.sender', { value: reviewedSender }],
      ['guard.r.recipient', { value: plan.transaction.to }],
      ['guard.r.value', { value: BigInt(plan.transaction.value).toString() }],
      ['guard.r.data'],
    ]) {
      const p = document.createElement('p');
      setText(p, key, params);
      status.appendChild(p);
    }
    confirm.checked = false;
    confirm.disabled = false;
    send.disabled = true;
  } catch (error) { showError(error); }
  finally { preview.disabled = false; }
}

async function walletHandoff() {
  if (!confirm.checked || !currentPlan || !reviewedSender) return;
  if (wallet.provider !== reviewedProvider) { showError(new KeyedError('guard.e.walletChanged')); return; }
  send.disabled = true;
  preview.disabled = true;
  try {
    const result = await sendGuardedNativeTransfer(wallet.provider, currentPlan, {
      form: form(), reviewedSender,
    });
    invalidate('guard.result', { ref: String(result) });
    status.classList.remove('bad');
  } catch (error) { showError(error); }
  finally { preview.disabled = false; }
}

for (const element of [destination, verified, amount]) {
  element.addEventListener('input', () => invalidate('guard.changed.form'));
}
confirm.addEventListener('change', () => { send.disabled = !confirm.checked || !currentPlan; });
connect.addEventListener('click', connectWallet);
preview.addEventListener('click', review);
send.addEventListener('click', walletHandoff);
window.addEventListener('zeronyth:walletchange', () => {
  if (wallet.state.account) setText(account, 'guard.selected', { account: wallet.state.account });
  else setText(account, 'guard.noSender');
  invalidate('guard.changed.wallet');
});
setText(account, 'guard.noSender');
setText(status, 'guard.status.initial');
