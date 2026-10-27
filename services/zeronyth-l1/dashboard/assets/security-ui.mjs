import { analyzeSecurityRequest } from './security-engine.mjs';
import { t, setText, clearText, getLocale, subscribe } from './i18n.mjs';
import { KeyedError } from './i18n-errors.mjs';

const $ = (id) => document.getElementById(id);
const network = $('securityNetwork');
const input = $('securityInput');
const results = $('securityResults');

const ADDRESS_A = `0x${'1'.repeat(40)}`;
const ADDRESS_B = `0x${'2'.repeat(40)}`;
const WORD = (hex) => hex.replace(/^0x/, '').padStart(64, '0');
const BTC_RECIPIENT = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
const BTC_CHANGE = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const SOL_RECIPIENT = 'Vote111111111111111111111111111111111111111';

function sample(chain) {
  if (chain === 'SOL') return {
    network: 'SOL', expectedRecipient: SOL_RECIPIENT,
    recentBlockhash: 'ExampleBlockhashNotForBroadcast',
    instructions: [{ program: 'system', parsed: { type: 'transfer', info: {
      source: '11111111111111111111111111111111', destination: SOL_RECIPIENT, lamports: '1000000',
    } } }],
  };
  if (chain === 'BTC') return {
    network: 'BTC', expectedRecipient: BTC_RECIPIENT,
    psbt: { inputs: [{ amountSat: '100000' }], outputs: [
      { address: BTC_RECIPIENT, amountSat: '80000' },
      { address: BTC_CHANGE, amountSat: '19000' },
    ], changeAddress: BTC_CHANGE },
  };
  return {
    network: chain, expectedRecipient: ADDRESS_A,
    transaction: { chainId: chain === 'BNB' ? 56 : chain === 'ZNYT' ? 9127 : 1,
      to: ADDRESS_A, value: '0', data: `0x095ea7b3${WORD(ADDRESS_B)}${'f'.repeat(64)}` },
  };
}

let last = null; // { report } | { error: string | {key,params} } | null

function renderFinding(finding) {
  const item = document.createElement('li');
  item.className = finding.severity;
  const label = t(`sec.sev.${finding.severity}`);
  const known = t(`sec.f.${finding.code}`);
  const localized = known !== `sec.f.${finding.code}` && getLocale() !== 'en';
  const head = document.createElement('strong');
  head.textContent = `[${label}] ${finding.code}`;
  const body = document.createElement('span');
  body.textContent = localized ? ` ${known}` : ` ${finding.message}`;
  item.append(head, body);
  if (localized) {
    const raw = document.createElement('small');
    raw.className = 'raw';
    raw.textContent = finding.message;
    item.append(document.createElement('br'), raw);
  }
  return item;
}

function renderResult(report) {
  const title = document.createElement('strong');
  title.className = report.risk === 'CRITICAL' ? 'critical' : report.risk === 'HIGH' ? 'high' : 'caution';
  title.textContent = `${t(`sec.risk.${report.risk}`)} / ${t(report.complete ? 'sec.decoded' : 'sec.incomplete')}`;
  const list = document.createElement('ul');
  for (const finding of report.findings) list.appendChild(renderFinding(finding));
  const footnote = document.createElement('p');
  footnote.className = 'muted small';
  footnote.textContent = t('sec.disclaimer');
  results.append(title, list, footnote);
}

function renderLast() {
  if (!last) return;
  clearText(results);
  if (last.report) { renderResult(last.report); return; }
  const line = document.createElement('p');
  line.className = 'bad';
  const e = last.error;
  line.textContent = t('sec.unavailable', { error: e });
  results.appendChild(line);
}

function analyze() {
  try {
    const raw = input.value.trim();
    if (!raw || raw.length > 150_000) throw new KeyedError('sec.err.range');
    if (/"(?:private.?key|secret.?key|mnemonic|seed.?phrase|password)"\s*:/i.test(raw)) throw new KeyedError('sec.err.secret');
    const request = JSON.parse(raw);
    if (String(request.network ?? '').toUpperCase() !== network.value) throw new KeyedError('sec.err.mismatch');
    last = { report: analyzeSecurityRequest(request) };
  } catch (error) {
    last = { error: error instanceof KeyedError ? { key: error.key } : String(error?.message ?? error) };
  }
  renderLast();
}

function loadSample() {
  input.value = JSON.stringify(sample(network.value), null, 2);
  last = null; clearText(results); setText(results, 'sec.loaded');
}

function loadSafeSample() {
  network.value = 'EVM';
  input.value = JSON.stringify({
    network: 'EVM',
    expectedRecipient: ADDRESS_A,
    expectedSafe: ADDRESS_A,
    typedData: {
      primaryType: 'SafeTx',
      types: { SafeTx: [
        { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' }, { name: 'operation', type: 'uint8' },
        { name: 'nonce', type: 'uint256' },
      ] },
      domain: { chainId: 1, verifyingContract: ADDRESS_A },
      message: { to: ADDRESS_B, value: '0', data: '0xa9059cbb', operation: 1, nonce: '1' },
    },
  }, null, 2);
  last = null; clearText(results); setText(results, 'sec.safeLoaded');
}

$('securityAnalyze').addEventListener('click', analyze);
$('securitySample').addEventListener('click', loadSample);
$('securitySafeSample').addEventListener('click', loadSafeSample);
network.addEventListener('change', loadSample);
loadSample();
subscribe(() => renderLast());
