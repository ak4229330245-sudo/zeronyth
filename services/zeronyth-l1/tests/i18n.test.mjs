import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  CATALOGS, LOCALES, STORAGE_KEY, normalizeLocale, detectLocale, readPreference, writePreference,
  interpolate, createI18n,
} from '../dashboard/assets/i18n.mjs';
import {
  KeyedError, localizeWalletError, localizeGuardError, localizeNodeError, localizeP2pError,
} from '../dashboard/assets/i18n-errors.mjs';

const dash = new URL('../dashboard/', import.meta.url);
const read = (p) => readFileSync(new URL(p, dash), 'utf8');
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

test('all four locales share exactly the same keys, placeholders and are non-empty', () => {
  assert.deepEqual([...LOCALES].sort(), ['en', 'ja', 'ko', 'zh-CN']);
  const base = CATALOGS.en;
  for (const locale of LOCALES) {
    const catalog = CATALOGS[locale];
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(base).sort(), `${locale} keys`);
    for (const [key, value] of Object.entries(catalog)) {
      assert.ok(typeof value === 'string' && value.trim(), `${locale}:${key} empty`);
      assert.equal(placeholders(value), placeholders(base[key]), `${locale}:${key} placeholders`);
      assert.ok(!/<[a-z/][^>]*>/i.test(value), `${locale}:${key} contains markup`);
      assert.ok(!/\p{Extended_Pictographic}/u.test(value), `${locale}:${key} contains emoji`);
    }
  }
});

test('every key referenced by HTML and JS exists in the catalog', () => {
  const keys = new Set(Object.keys(CATALOGS.en));
  const used = new Set();
  for (const file of ['index.html', 'node.html']) {
    const html = read(file);
    for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]);
    for (const m of html.matchAll(/data-title-key="([^"]+)"/g)) used.add(m[1]);
    for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(';')) used.add(pair.split(':')[1].trim());
    assert.ok(!/\sstyle=|<script(?![^>]*\ssrc=)/.test(html), `${file} has inline style/script`);
  }
  for (const f of readdirSync(new URL('assets/', dash))) {
    if (!/\.(mjs|js)$/.test(f) || f.startsWith('i18n-') && f !== 'i18n-errors.mjs') continue;
    const src = read(`assets/${f}`);
    for (const m of src.matchAll(/(?:setText\([^,()]+(?:\([^)]*\))?,\s*|\bt\(|key:\s*|KeyedError\(|\[\s*)['"`]([a-z0-9]+(?:\.[A-Za-z0-9_]+)+)['"`]/g)) used.add(m[1]);
    for (const m of src.matchAll(/'((?:wallet|guard|node|p2p|sec|status|faucet)\.[A-Za-z0-9_.]+)'/g)) used.add(m[1]);
  }
  for (const key of used) assert.ok(keys.has(key), `missing catalog key ${key}`);
  assert.ok(used.size > 100);
});

test('security finding codes and risk labels are covered', () => {
  const engine = read('assets/security-engine.mjs');
  for (const m of engine.matchAll(/'([A-Z][A-Z_]{3,})'/g)) {
    if (/^(CRITICAL|HIGH|REVIEW|EVM|BNB|ZNYT|SOL|BTC|MAX_UINT256)$/.test(m[1])) continue;
    if (engine.includes(`'${m[1]}',`) && /^[A-Z_]+$/.test(m[1]) && `sec.f.${m[1]}` in CATALOGS.en === false) {
      assert.fail(`finding code ${m[1]} lacks sec.f key`);
    }
  }
});

test('locale normalization and detection fall back to English', () => {
  assert.equal(normalizeLocale('ja-JP'), 'ja');
  assert.equal(normalizeLocale('zh-Hans-CN'), 'zh-CN');
  assert.equal(normalizeLocale('ko_KR'), 'ko');
  assert.equal(normalizeLocale('fr'), null);
  assert.equal(normalizeLocale(42), null);
  assert.equal(detectLocale(['fr-FR', 'ko-KR']), 'ko');
  assert.equal(createI18n({ getStorage: () => memory(), languages: ['de'] }).locale, 'en');
});

test('preference reads stored value, ignores invalid, survives storage failure', () => {
  const store = memory();
  store.setItem(STORAGE_KEY, 'ko');
  assert.equal(createI18n({ getStorage: () => store, languages: ['ja'] }).locale, 'ko');
  store.setItem(STORAGE_KEY, 'xx');
  assert.equal(createI18n({ getStorage: () => store, languages: ['ja'] }).locale, 'ja');
  const broken = () => { throw new Error('denied'); };
  assert.equal(readPreference(broken), null);
  assert.equal(writePreference(broken, 'ja'), false);
  const i18n = createI18n({ getStorage: broken, languages: ['en'] });
  const result = i18n.setLocale('zh-CN');
  assert.deepEqual([result.ok, result.persisted, i18n.locale], [true, false, 'zh-CN']);
  assert.equal(i18n.setLocale('klingon').ok, false);
  assert.equal(i18n.locale, 'zh-CN');
});

test('setLocale persists only the language key', () => {
  const store = memory();
  const i18n = createI18n({ getStorage: () => store, languages: ['en'] });
  i18n.setLocale('ja');
  assert.deepEqual([...store.m.entries()], [[STORAGE_KEY, 'ja']]);
});

test('interpolation, nested keys and fallback', () => {
  assert.equal(interpolate('a {x} b {y}', { x: 1 }), 'a 1 b {y}');
  const i18n = createI18n({ getStorage: () => memory(), languages: ['ko'] });
  assert.equal(i18n.t('faucet.sent', { amount: '5', hash: '0xab' }), '5 ZNYT 전송됨 / 0xab');
  assert.equal(i18n.t('wallet.msg.switchFail', { error: { key: 'wallet.err.cancelled' } }).includes('취소'), true);
  assert.equal(i18n.t('no.such.key'), 'no.such.key');
});

test('bound text follows language changes without innerHTML', () => {
  const el = { textContent: '', isConnected: true };
  const gone = { textContent: 'x', isConnected: false };
  const i18n = createI18n({ getStorage: () => memory(), languages: ['en'] });
  i18n.setText(el, 'status.unexpectedChain', { chain: 1 });
  i18n.setText(gone, 'status.online');
  gone.textContent = 'x';
  assert.equal(el.textContent, 'Unexpected chain ID 1');
  i18n.setLocale('ja');
  assert.equal(el.textContent, '想定外のチェーンID 1');
  assert.equal(gone.textContent, 'x');
  i18n.setPlain(el, '<b>raw</b>');
  i18n.setLocale('en');
  assert.equal(el.textContent, '<b>raw</b>');
  for (const f of readdirSync(new URL('assets/', dash))) {
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(read(`assets/${f}`)) || f.endsWith('.css') || f === 'png', f);
  }
});

test('technical errors are localized by context, unknown ones stay raw', () => {
  assert.deepEqual(localizeWalletError('先にウォレットを接続してください。'), { key: 'wallet.err.connectFirst' });
  assert.equal(localizeWalletError('execution reverted'), 'execution reverted');
  assert.deepEqual(localizeGuardError(Error('BLOCKED: wallet chain 1 does not match reviewed chain 9127.')),
    { key: 'guard.e.chainMismatch', params: { active: '1', reviewed: '9127' } });
  assert.deepEqual(localizeGuardError(Error('BLOCKED: recipient is a contract, or its code could not be verified by the wallet provider.')), { key: 'guard.e.contract' });
  assert.deepEqual(localizeGuardError(new KeyedError('guard.e.noEip')), { key: 'guard.e.noEip' });
  assert.equal(localizeGuardError(Error('User rejected')), 'User rejected');
  assert.deepEqual(localizeNodeError('ワーカーが停止したため、安全側で処理を終了しました'), { key: 'node.err.worker' });
  assert.equal(localizeP2pError('Signaling /join failed'), 'Signaling /join failed');
  assert.deepEqual(localizeP2pError('シグナリング一時停止'), { key: 'p2p.err.signal' });
});

test('default disconnected state, node title and desktop descriptors are localized before interaction', () => {
  const walletUi = read('assets/wallet-ui.mjs');
  assert.match(walletUi, /setText\(networkName, 'wallet\.network\.none'\);\s*$/);
  const nodeUi = read('assets/web-node-ui.mjs');
  assert.doesNotMatch(nodeUi, /setPlain\(ui\.deviceType/);
  for (const locale of ['ja', 'zh-CN', 'ko']) {
    const core = createI18n({ getStorage: () => memory(), languages: [locale] });
    for (const key of ['meta.title.node', 'wallet.network.none', 'node.platform.desktop',
      'node.device.type.light', 'node.device.type.mobile', 'node.device.type.desktop']) {
      assert.notEqual(core.t(key), CATALOGS.en[key], `${locale}: untranslated ${key}`);
    }
    const name = core.t('node.device.name', {
      device: { key: 'node.dev.pc' }, platform: { key: 'node.platform.desktop' },
    });
    assert.ok(name.includes(core.t('node.platform.desktop')));
    assert.ok(!name.includes('Desktop browser'));
  }
});
