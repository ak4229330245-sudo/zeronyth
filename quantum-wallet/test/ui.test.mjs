// Phase 3 tests: i18n runtime, amount helpers, and the session
// controller (vault lifecycle, v3 reset semantics, memory-only unlock
// with no password persistence, send pipeline) — all headless, with an
// injected fake RPC. Run with npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { memoryStorage } from '../src/core/storage.mjs';
import { VAULT_KEY, VAULT_BACKUP_KEY } from '../src/core/vault.mjs';
import { decodeRawTransaction } from '../src/core/tx.mjs';
import { parseZnyt, formatZnyt, isAddress, isHexData } from '../src/core/amount.mjs';
import {
  DICT,
  LANGS,
  LANGUAGE_KEY,
  LANGUAGE_INDEX_KEY,
  detectLang,
  createI18n,
} from '../src/i18n.mjs';
import {
  createSession,
  AUTOUNLOCK_KEY,
  RPC_URL_KEY,
  DEFAULT_RPC_URL,
  explorerTxUrl,
} from '../src/app/session.mjs';
import { PASSWORD, WRONG_PASSWORD, VECTORS, V1_PASSWORD, V1_FIXTURE } from './fixtures.mjs';

// ------------------------------------------------------------------ fakes

function fakeRpc(overrides = {}) {
  const calls = [];
  let receiptCalls = 0;
  return {
    calls,
    async call(method, params = []) {
      calls.push({ method, params });
      if (overrides.call) return overrides.call(method, params);
      if (method === 'eth_chainId') return '0xded3d'; // 912701
      if (method === 'zny_faucet') return null;
      throw Error(`unexpected call ${method}`);
    },
    async getTransactionCount() {
      return overrides.nonce ?? 7;
    },
    async gasPrice() {
      if (overrides.gasPriceThrows) throw Error('no gas price');
      return overrides.gasPrice ?? 2000000000n;
    },
    async getBalance(address) {
      if (overrides.balanceThrows) throw Error('balance unavailable');
      return overrides.balanceFor ? overrides.balanceFor(address) : 5000000000000000000n;
    },
    async estimateGas(tx) {
      calls.push({ method: 'eth_estimateGas', params: [tx] });
      return overrides.estimate ?? 50000n;
    },
    async sendRawTransaction(raw) {
      calls.push({ method: 'eth_sendRawTransaction', params: [raw] });
      return overrides.hash ?? '0x' + 'ab'.repeat(32);
    },
    async getTransactionReceipt() {
      receiptCalls++;
      if (overrides.receipt) return overrides.receipt(receiptCalls);
      return { status: '0x1', transactionHash: '0x' + 'ab'.repeat(32) };
    },
  };
}

function makeSession(storage, rpc, extra = {}) {
  return createSession({
    storage,
    rpcFactory: () => rpc,
    sleep: async () => {},
    ...extra,
  });
}

// ------------------------------------------------------------------ i18n

test('i18n: dictionary is complete — every key has 4 non-empty strings', () => {
  const keys = Object.keys(DICT);
  assert.ok(keys.length >= 99, `expected >= 99 keys, got ${keys.length}`);
  for (const [k, v] of Object.entries(DICT)) {
    assert.ok(Array.isArray(v) && v.length === 4, `${k} has 4 entries`);
    for (const s of v) assert.ok(typeof s === 'string' && s.length > 0, `${k} non-empty`);
  }
});

test('i18n: all 56 v1 keys are present', () => {
  const v1Keys =
    'tagline,warning,overview,tokens,activity,connect,settings,total,send,receive,faucet,refresh,create,restore,unlock,lock,password,confirmPassword,backup,secure,local,recipient,amount,review,approve,cancel,copy,copied,network,rpc,save,offline,connected,readOnly,chainNote,receiveWarn,pqKeysTitle,native,tokenAddress,add,empty,fee,from,chain,success,receipt,dappHelp,demo,revoke,permission,allow,note,status,assets,confirm,backupNotice'.split(
      ',',
    );
  assert.equal(v1Keys.length, 56);
  for (const k of v1Keys) assert.ok(DICT[k], `v1 key ${k} present`);
});

test('i18n: default language is Japanese; v1 keys resolve', () => {
  const i18n = createI18n(memoryStorage());
  assert.equal(i18n.lang, 'ja');
  assert.equal(i18n.t('send'), '送金');
  assert.equal(i18n.t('unlock'), 'ロック解除');
  assert.equal(i18n.t('faucet'), 'テスト用資金を取得');
});

test('i18n: detection prefers the code key, then the index key', () => {
  const byCode = memoryStorage();
  byCode.setItem(LANGUAGE_KEY, 'en');
  byCode.setItem(LANGUAGE_INDEX_KEY, '3');
  assert.equal(detectLang(byCode), 'en');
  assert.equal(createI18n(byCode).t('send'), 'Send');

  const byIndex = memoryStorage();
  byIndex.setItem(LANGUAGE_INDEX_KEY, '2');
  assert.equal(detectLang(byIndex), 'zh-CN');
  assert.equal(createI18n(byIndex).t('send'), '发送');

  const zhAlias = memoryStorage();
  zhAlias.setItem(LANGUAGE_KEY, 'zh');
  assert.equal(detectLang(zhAlias), 'zh-CN');

  const garbage = memoryStorage();
  garbage.setItem(LANGUAGE_KEY, 'xx');
  assert.equal(detectLang(garbage), 'ja');
});

test('i18n: setLang persists code + index and switches strings', () => {
  const storage = memoryStorage();
  const i18n = createI18n(storage);
  i18n.setLang('ko');
  assert.equal(i18n.lang, 'ko');
  assert.equal(i18n.t('send'), '보내기');
  assert.equal(storage.getItem(LANGUAGE_KEY), 'ko');
  assert.equal(storage.getItem(LANGUAGE_INDEX_KEY), '3');
  assert.throws(() => i18n.setLang('fr'), /Unknown language/);
  // A fresh runtime over the same storage picks the language up.
  assert.equal(createI18n(storage).lang, 'ko');
  assert.deepEqual(LANGS, ['ja', 'en', 'zh-CN', 'ko']);
});

test('i18n: interpolation replaces {vars}', () => {
  DICT.__test = ['{x} です', '{x} here', '{x} 这里', '{x} 여기'];
  try {
    const i18n = createI18n(memoryStorage());
    assert.equal(i18n.t('__test', { x: 'A' }), 'A です');
  } finally {
    delete DICT.__test;
  }
});

test('i18n: reset-flow strings match reset-wallet v3 verbatim (ja)', () => {
  const i18n = createI18n(memoryStorage());
  assert.equal(
    i18n.t('forgot'),
    'パスワードを忘れた場合：この端末のウォレットを削除して新規作成',
  );
  assert.equal(i18n.t('resetDelete'), '削除して新規作成');
  assert.ok(i18n.t('resetWarn').includes('二度と復元できず'));
});

// ------------------------------------------------------------------ amount

test('amount: parseZnyt converts decimal ZNYT to wei', () => {
  assert.equal(parseZnyt('0'), 0n);
  assert.equal(parseZnyt('1'), 1000000000000000000n);
  assert.equal(parseZnyt('0.001'), 1000000000000000n);
  assert.equal(parseZnyt('1.5'), 1500000000000000000n);
  assert.equal(parseZnyt('0.000000000000000001'), 1n);
  assert.equal(parseZnyt(' 2.25 '), 2250000000000000000n);
});

test('amount: parseZnyt rejects malformed input', () => {
  for (const bad of ['', 'abc', '1.2.3', '-1', '1e3', '.5', '1.', '1,000', '0.0000000000000000001', 'NaN']) {
    assert.throws(() => parseZnyt(bad), /Invalid amount/, JSON.stringify(bad));
  }
});

test('amount: formatZnyt round-trips and trims zeros', () => {
  assert.equal(formatZnyt(0n), '0');
  assert.equal(formatZnyt(1000000000000000000n), '1');
  assert.equal(formatZnyt(1500000000000000000n), '1.5');
  assert.equal(formatZnyt(1n), '0.000000000000000001');
  assert.equal(formatZnyt(103080000000000n), '0.00010308');
  for (const s of ['0', '1', '1.5', '0.001', '123.456']) {
    assert.equal(formatZnyt(parseZnyt(s)), s);
  }
  assert.throws(() => formatZnyt(-1n), /negative/);
});

test('amount: address / data shape checks', () => {
  assert.equal(isAddress(VECTORS.ecdsa.address), true);
  assert.equal(isAddress('0x1234'), false);
  assert.equal(isAddress('c04e7e8933966eac97dfbe95a89c125095cf27c9'), false);
  assert.equal(isHexData('0x'), true);
  assert.equal(isHexData('0xdeadBEEF'), true);
  assert.equal(isHexData('0x123'), false);
  assert.equal(isHexData('deadbeef'), false);
});

// ------------------------------------------------------------------ session

/** Assert no storage value holds the password (or any given secret). */
function assertPasswordNowhere(storage, secret = PASSWORD) {
  assert.equal(storage.getItem(AUTOUNLOCK_KEY), null, 'legacy autounlock key must never be written');
  for (const [k, v] of storage._map) {
    assert.ok(typeof v !== 'string' || !v.includes(secret), `password material leaked into ${k}`);
  }
}

test('session: create makes the first account and never persists the password', async () => {
  const storage = memoryStorage();
  const session = makeSession(storage, fakeRpc());
  assert.equal(session.state.status, 'no-vault');

  const state = await session.create(PASSWORD, 'mldsa');
  assert.equal(state.status, 'unlocked');
  assert.equal(state.accounts.length, 1);
  assert.equal(state.accounts[0].scheme, 'mldsa');
  assertPasswordNowhere(storage);
});

test('session: unlock writes no persistence — a reload requires the password', async () => {
  const storage = memoryStorage();
  const first = makeSession(storage, fakeRpc());
  const created = await first.create(PASSWORD, 'ecdsa');
  const address = created.accounts[0].address;
  first.lock();

  const unlocked = await first.unlock(PASSWORD);
  assert.equal(unlocked.status, 'unlocked');
  assertPasswordNowhere(storage);

  // A fresh session over the same storage models a page reload: it must
  // come up locked even though the previous session unlocked fine.
  const second = makeSession(storage, fakeRpc());
  assert.equal(second.state.status, 'locked');
  const state = await second.start();
  assert.equal(state.status, 'locked', 'start() must never auto-unlock');
  assert.equal(state.accounts.length, 0);
  const again = await second.unlock(PASSWORD);
  assert.equal(again.status, 'unlocked');
  assert.equal(again.accounts[0].address, address);
  assertPasswordNowhere(storage);
});

test('session: legacy autounlock key is scrubbed on load and never used', async () => {
  const storage = memoryStorage();
  const first = makeSession(storage, fakeRpc());
  await first.create(PASSWORD, 'ecdsa');
  first.lock();
  // Simulate a pre-fix build's leftover: the correct password, stored.
  storage.setItem(AUTOUNLOCK_KEY, PASSWORD);
  assert.equal(storage.getItem(AUTOUNLOCK_KEY), PASSWORD);

  const second = makeSession(storage, fakeRpc());
  assert.equal(storage.getItem(AUTOUNLOCK_KEY), null, 'scrubbed at session startup');
  const state = await second.start();
  assert.equal(state.status, 'locked', 'the scrubbed password must not unlock anything');
  assert.equal(state.accounts.length, 0);
});

test('session: lock blocks vault ops and stores nothing', async () => {
  const storage = memoryStorage();
  const session = makeSession(storage, fakeRpc());
  await session.create(PASSWORD, 'ecdsa');

  session.lock();
  assert.equal(session.state.status, 'locked');
  assertPasswordNowhere(storage);
  await assert.rejects(() => session.addAccount('ecdsa'), /locked/);
});

test('session: failed manual unlock stores nothing either', async () => {
  const storage = memoryStorage();
  const session = makeSession(storage, fakeRpc());
  await session.create(PASSWORD, 'ecdsa');
  session.lock();

  await assert.rejects(() => session.unlock(WRONG_PASSWORD), /Invalid password/);
  assert.equal(session.state.status, 'locked');
  assertPasswordNowhere(storage);
  assertPasswordNowhere(storage, WRONG_PASSWORD);
});

test('session: wipe deletes the deletion key set and keeps the migration backup', async () => {
  const storage = memoryStorage();
  const session = makeSession(storage, fakeRpc());
  await session.create(PASSWORD, 'ecdsa');
  storage.setItem('zeronyth-tokens:0xabc', '[]');
  storage.setItem('zeronyth-tokens:0xdef', '[]');
  storage.setItem(VAULT_BACKUP_KEY, V1_FIXTURE);

  session.wipe();
  assert.equal(storage.getItem(VAULT_KEY), null);
  assert.equal(storage.getItem(AUTOUNLOCK_KEY), null);
  assert.equal(storage.getItem('zeronyth-tokens:0xabc'), null);
  assert.equal(storage.getItem('zeronyth-tokens:0xdef'), null);
  assert.equal(storage.getItem(VAULT_BACKUP_KEY), V1_FIXTURE, 'backup key kept, as v3 kept it');
  assert.equal(session.state.status, 'no-vault');
  assert.equal(session.hasVault(), false);
});

test('session: v1 vault migrates on unlock and reports it', async () => {
  const storage = memoryStorage();
  storage.setItem(VAULT_KEY, V1_FIXTURE);
  const session = makeSession(storage, fakeRpc());
  const state = await session.unlock(V1_PASSWORD);
  assert.equal(state.migratedFromV1, true);
  assert.equal(state.accounts.length, 1);
  assert.equal(state.accounts[0].address, VECTORS.mldsa.address, 'address preserved verbatim');
  assert.equal(state.hasBackup, true);
});

test('session: RPC URL defaults and persists under the v1 key', async () => {
  const storage = memoryStorage();
  const session = makeSession(storage, fakeRpc());
  assert.equal(session.getRpcUrl(), DEFAULT_RPC_URL);
  assert.equal(DEFAULT_RPC_URL, 'https://zeronyth.dpdns.org/rpc');
  session.setRpcUrl('http://127.0.0.1:8545');
  assert.equal(session.getRpcUrl(), 'http://127.0.0.1:8545');
  assert.equal(storage.getItem(RPC_URL_KEY), 'http://127.0.0.1:8545');
  assert.throws(() => session.setRpcUrl('  '), /required/);
});

test('session: connection check requires chain 912701', async () => {
  const good = makeSession(memoryStorage(), fakeRpc());
  assert.deepEqual(await good.checkConnection(), { ok: true, chainId: 912701n });

  const wrong = makeSession(
    memoryStorage(),
    fakeRpc({ call: async () => '0x1' }),
  );
  assert.equal((await wrong.checkConnection()).ok, false);

  const down = makeSession(
    memoryStorage(),
    fakeRpc({
      call: async () => {
        throw Error('unreachable');
      },
    }),
  );
  assert.equal((await down.checkConnection()).ok, false);
});

test('session: balances refresh per account; failures stay unknown', async () => {
  const storage = memoryStorage();
  const rpc = fakeRpc({ balanceFor: (a) => (a === VECTORS.ecdsa.address ? 42n : 7n) });
  const session = makeSession(storage, rpc);
  const vault = await session.create(PASSWORD, 'ecdsa');
  const id = vault.accounts[0].id;
  const balances = await session.refreshBalances();
  assert.equal(balances[id], 7n, 'ecdsa vector address is not the created account');

  const failing = makeSession(storage, fakeRpc({ balanceThrows: true }));
  await failing.unlock(PASSWORD);
  const unknown = await failing.refreshBalances();
  assert.equal(Object.values(unknown)[0], null);
});

test('session: faucet posts zny_faucet for the account address', async () => {
  const storage = memoryStorage();
  const rpc = fakeRpc();
  const session = makeSession(storage, rpc);
  const state = await session.create(PASSWORD, 'ecdsa');
  await session.faucet(state.accounts[0].id);
  const faucetCall = rpc.calls.find((c) => c.method === 'zny_faucet');
  assert.ok(faucetCall, 'zny_faucet called');
  assert.deepEqual(faucetCall.params, [state.accounts[0].address]);
});

// ------------------------------------------------------------- send pipeline

async function unlockedSendSession(rpc, schemes = ['mldsa']) {
  const storage = memoryStorage();
  const session = makeSession(storage, rpc);
  let state = await session.create(PASSWORD, schemes[0]);
  for (const scheme of schemes.slice(1)) state = (await session.addAccount(scheme), session.state);
  return { session, state };
}

test('send: plain transfer uses the exact intrinsic gas per scheme', async () => {
  const rpc = fakeRpc();
  const { session, state } = await unlockedSendSession(rpc, ['mldsa', 'ecdsa']);
  const [mldsa, ecdsa] = state.accounts;

  const p1 = await session.prepareSend(mldsa.id, {
    to: VECTORS.ecdsa.address,
    value: parseZnyt('0.5'),
  });
  assert.equal(p1.gasLimit, 147176n, 'ML-DSA intrinsic');
  assert.equal(p1.estimate, null);
  assert.equal(p1.nonce, 7);
  assert.equal(p1.gasPrice, 2000000000n);
  assert.equal(p1.fee, 147176n * 2000000000n);
  assert.equal(p1.from, mldsa.address);
  assert.equal(p1.balance, 5000000000000000000n);

  const p2 = await session.prepareSend(ecdsa.id, { to: VECTORS.mldsa.address, value: 1n });
  assert.equal(p2.gasLimit, 21000n, 'ECDSA intrinsic');
});

test('send: falcon transfer uses its intrinsic gas', async () => {
  const rpc = fakeRpc();
  const { session, state } = await unlockedSendSession(rpc, ['falcon']);
  const prepared = await session.prepareSend(state.accounts[0].id, {
    to: VECTORS.mldsa.address,
    value: 1n,
  });
  assert.equal(prepared.gasLimit, 103080n, 'Falcon intrinsic');
});

test('send: contract call uses estimate + scheme surcharge', async () => {
  const rpc = fakeRpc({ estimate: 50000n });
  const { session, state } = await unlockedSendSession(rpc, ['mldsa']);
  const prepared = await session.prepareSend(state.accounts[0].id, {
    to: VECTORS.ecdsa.address,
    value: 0n,
    data: '0xdeadbeef',
  });
  assert.equal(prepared.estimate, 50000n);
  assert.equal(prepared.gasLimit, 50000n + 126176n, 'estimate + ML-DSA surcharge');
  const estCall = rpc.calls.find((c) => c.method === 'eth_estimateGas');
  assert.equal(estCall.params[0].data, '0xdeadbeef');
  assert.equal(estCall.params[0].to, VECTORS.ecdsa.address);
});

test('send: prepareSend validates address / data / creation rule', async () => {
  const rpc = fakeRpc();
  const { session, state } = await unlockedSendSession(rpc, ['ecdsa']);
  const id = state.accounts[0].id;
  await assert.rejects(() => session.prepareSend(id, { to: '0x123', value: 1n }), /Invalid address/);
  await assert.rejects(
    () => session.prepareSend(id, { to: VECTORS.mldsa.address, value: 1n, data: 'zz' }),
    /Invalid data/,
  );
  await assert.rejects(() => session.prepareSend(id, { value: 1n }), /Invalid address/);
  // Creation (no `to`, with data) is allowed and estimated.
  const creation = await session.prepareSend(id, { data: '0x6000' });
  assert.equal(creation.to, null);
  assert.equal(creation.gasLimit, 50000n, 'ECDSA surcharge is 0');
});

test('send: executeSend signs with the vault and broadcasts the raw tx', async () => {
  const rpc = fakeRpc();
  const { session, state } = await unlockedSendSession(rpc, ['mldsa']);
  const account = state.accounts[0];
  const prepared = await session.prepareSend(account.id, {
    to: VECTORS.ecdsa.address,
    value: parseZnyt('0.25'),
  });
  const { hash, signed } = await session.executeSend(prepared);
  assert.equal(hash, '0x' + 'ab'.repeat(32));
  assert.equal(signed.from, account.address);

  const broadcast = rpc.calls.find((c) => c.method === 'eth_sendRawTransaction');
  assert.ok(broadcast);
  assert.equal(broadcast.params[0], signed.rawTx);
  assert.ok(signed.rawTx.startsWith('0x7f'), 'ML-DSA type byte');

  const decoded = decodeRawTransaction(signed.rawTx);
  assert.equal(decoded.scheme, 'mldsa');
  assert.equal(decoded.from, account.address);
  assert.equal(decoded.to, VECTORS.ecdsa.address);
  assert.equal(decoded.value, parseZnyt('0.25'));
  assert.equal(decoded.nonce, 7n);
  assert.equal(explorerTxUrl(hash), `https://scan.zeronyth.dpdns.org/tx/${hash}`);
});

test('send: gas price falls back to 1 gwei when the node reports 0 or fails', async () => {
  const zeroRpc = fakeRpc({ gasPrice: 0n });
  const a = await unlockedSendSession(zeroRpc, ['ecdsa']);
  const p1 = await a.session.prepareSend(a.state.accounts[0].id, {
    to: VECTORS.mldsa.address,
    value: 1n,
  });
  assert.equal(p1.gasPrice, 1000000000n);

  const downRpc = fakeRpc({ gasPriceThrows: true });
  const b = await unlockedSendSession(downRpc, ['ecdsa']);
  const p2 = await b.session.prepareSend(b.state.accounts[0].id, {
    to: VECTORS.mldsa.address,
    value: 1n,
  });
  assert.equal(p2.gasPrice, 1000000000n);
});

test('send: receipt polling resolves success, failure, and timeout', async () => {
  const seq = [null, null, { status: '0x1', transactionHash: '0xh' }];
  const rpc = fakeRpc({ receipt: (n) => (n <= seq.length ? seq[n - 1] : seq.at(-1)) });
  const { session } = await unlockedSendSession(rpc, ['ecdsa']);
  const seen = [];
  const done = await session.pollReceipt('0xh', {
    onUpdate: (u) => seen.push(u.state),
    maxAttempts: 5,
  });
  assert.equal(done.state, 'success');
  assert.deepEqual(seen, ['pending', 'pending', 'success']);

  const failSession = await unlockedSendSession(
    fakeRpc({ receipt: () => ({ status: '0x0' }) }),
    ['ecdsa'],
  );
  assert.equal((await failSession.session.pollReceipt('0xh', {})).state, 'failed');

  const muteSession = await unlockedSendSession(fakeRpc({ receipt: () => null }), ['ecdsa']);
  const timeout = await muteSession.session.pollReceipt('0xh', { maxAttempts: 3 });
  assert.equal(timeout.state, 'pending');
  assert.equal(timeout.receipt, null);
});
