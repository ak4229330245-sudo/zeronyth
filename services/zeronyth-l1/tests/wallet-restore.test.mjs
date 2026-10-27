import test from 'node:test';
import assert from 'node:assert/strict';
import { WalletController, discoverWallets } from '../dashboard/assets/wallet-core.mjs';
import { WALLET_PREFERENCE_KEY, walletIdentity, readWalletPreference, saveWalletPreference,
  forgetWalletPreference, savedWalletCandidate } from '../dashboard/assets/wallet-preference.mjs';

const address = `0x${'a'.repeat(40)}`;
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key), setItem: (key, val) => values.set(key, val),
    removeItem: key => values.delete(key), values };
};
function provider(accounts = [address], chain = '0x23a7') {
  const calls = [];
  return { calls, isMetaMask: true, request: async ({ method }) => {
    calls.push(method);
    if (method === 'eth_accounts') return accounts;
    if (method === 'eth_chainId') return chain;
    throw Error(`Forbidden restoration request: ${method}`);
  } };
}
test('explicit restore reads existing permissions without permission, chain, sign or send requests', async () => {
  const p = provider(), controller = new WalletController();
  await controller.restore(p);
  assert.equal(controller.state.account, address);
  assert.equal(controller.state.busy, false);
  assert.ok(p.calls.length >= 2);
  assert.ok(p.calls.every(method => ['eth_accounts', 'eth_chainId'].includes(method)));
});
test('locked or revoked wallet never falls back to requestAccounts', async () => {
  const p = provider([]), controller = new WalletController();
  await assert.rejects(controller.restore(p));
  assert.equal(controller.provider, null);
  assert.deepEqual(p.calls, ['eth_accounts']);
});
test('restore preserves wrong-chain identity but does not switch the chain', async () => {
  const p = provider([address], '0x1'), controller = new WalletController();
  await controller.restore(p);
  assert.equal(controller.state.chainId, '0x1');
  assert.ok(p.calls.every(method => ['eth_accounts', 'eth_chainId'].includes(method)));
});
test('disconnect wins over a late restore result', async () => {
  let resolve;
  const controller = new WalletController();
  const p = { request: () => new Promise(r => { resolve = r; }) };
  const pending = controller.restore(p);
  controller.disconnect();
  resolve([address]);
  await pending;
  assert.equal(controller.state.account, null);
  assert.equal(controller.provider, null);
});
test('preference persists only provider hint, rejects generic/ambiguous identity, and forgets', () => {
  const s = storage(), entry = { restoreKey: 'legacy:metamask', account: address, secret: 'not-for-storage' };
  assert.equal(saveWalletPreference(() => s, entry), true);
  const raw = s.getItem(WALLET_PREFERENCE_KEY);
  assert.deepEqual(JSON.parse(raw), { version: 1, key: 'legacy:metamask' });
  assert.ok(!raw.includes(address) && !raw.includes('secret'));
  const pref = readWalletPreference(() => s);
  assert.equal(savedWalletCandidate([entry], pref), entry);
  assert.equal(savedWalletCandidate([entry, { ...entry }], pref), null);
  assert.equal(saveWalletPreference(() => s, { restoreKey: null }), false);
  forgetWalletPreference(() => s);
  assert.equal(readWalletPreference(() => s), null);
});
test('malformed, oversized and denied storage fails closed', () => {
  const s = storage();
  for (const raw of ['{', 'x'.repeat(300), '{"version":2,"key":"legacy:metamask"}',
    '{"version":1,"key":"javascript:evil"}']) {
    s.setItem(WALLET_PREFERENCE_KEY, raw);
    assert.equal(readWalletPreference(() => s), null);
  }
  const denied = () => { throw Error('blocked'); };
  assert.equal(readWalletPreference(denied), null);
  assert.equal(saveWalletPreference(denied, { restoreKey: 'legacy:rabby' }), false);
  assert.doesNotThrow(() => forgetWalletPreference(denied));
});
test('discovery retains stable announced identity across legacy rescans without trusting names', () => {
  const host = new EventTarget(), p = provider();
  host.ethereum = p;
  const discovery = discoverWallets(host, () => {});
  assert.equal(discovery.entries[0].restoreKey, 'legacy:metamask');
  const event = new Event('eip6963:announceProvider');
  event.detail = { provider: p, info: { rdns: 'io.metamask', name: '<untrusted>' } };
  host.dispatchEvent(event);
  discovery.rescan();
  assert.equal(discovery.entries.length, 1);
  assert.equal(discovery.entries[0].restoreKey, 'rdns:io.metamask');
  assert.equal(walletIdentity({}, { rdns: 'bad-value' }), null);
  assert.equal(walletIdentity({ isRabby: true, isMetaMask: true }), 'legacy:rabby');
  discovery.close();
});
