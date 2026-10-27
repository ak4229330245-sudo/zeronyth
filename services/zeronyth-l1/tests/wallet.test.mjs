import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WalletController, discoverWallets, walletRpcUrl, walletError, formatZnyt, CHAIN_ID } from '../dashboard/assets/wallet-core.mjs';

const A = `0x${'a'.repeat(40)}`, B = `0x${'b'.repeat(40)}`;
const tick = () => new Promise(resolve => setImmediate(resolve));
class Provider extends EventEmitter {
  accounts = [A]; chain = '0x1'; calls = []; unknown = false;
  async request(call) {
    this.calls.push(call);
    if (call.method === 'eth_requestAccounts' || call.method === 'eth_accounts') return this.accounts;
    if (call.method === 'eth_chainId') return this.chain;
    if (call.method === 'wallet_switchEthereumChain') {
      if (this.unknown) throw Object.assign(Error('unknown'), { code: 4902 });
      this.chain = call.params[0].chainId; this.emit('chainChanged', this.chain); return null;
    }
    if (call.method === 'wallet_addEthereumChain') { this.unknown = false; return null; }
    throw Error(`Unexpected method ${call.method}`);
  }
}
test('connect keeps address when network is not ZERONYTH; no automatic switch/sign/send', async () => {
  const p = new Provider(), c = new WalletController();
  await c.connect(p);
  assert.equal(c.state.account, A); assert.equal(c.state.chainId, '0x1');
  assert.equal(c.state.busy, false);
  assert.deepEqual(p.calls.map(x => x.method), ['eth_requestAccounts','eth_accounts','eth_chainId']);
});
test('account, chain, revocation and disconnect changes clear or update state', async () => {
  const p = new Provider(), c = new WalletController(); await c.connect(p);
  p.accounts = [B]; p.emit('accountsChanged', [B]); await tick();
  assert.equal(c.state.account, B);
  p.chain = '0x023A7'; p.emit('chainChanged', p.chain); await tick();
  assert.equal(c.state.chainId, CHAIN_ID);
  p.accounts = []; p.emit('accountsChanged', []); await tick();
  assert.equal(c.state.account, null); assert.equal(c.provider, null);
  assert.equal(p.listenerCount('accountsChanged'), 0);
  p.accounts = [A]; await c.connect(p); p.emit('disconnect'); assert.equal(c.provider, null);
});
test('rejected permissions do not leave account or busy state', async () => {
  const p = new Provider(); p.request = async () => { throw Object.assign(Error('Denied'), { code: 4001 }); };
  const c = new WalletController(); await assert.rejects(c.connect(p));
  assert.equal(c.provider, null); assert.equal(c.state.busy, false); assert.match(c.state.error, /キャンセル/);
});
test('local disconnect cannot be undone by late wallet permission result', async () => {
  const p = new Provider(), request = p.request.bind(p);
  let done; p.request = call => call.method === 'eth_requestAccounts' ? new Promise(r => { done = r; }) : request(call);
  const c = new WalletController(), pending = c.connect(p);
  c.disconnect(); done([A]); await pending;
  assert.equal(c.provider, null); assert.equal(c.state.account, null);
});
test('provider replacement detaches old events and binds requests to selected wallet', async () => {
  const a = new Provider(), b = new Provider(); b.accounts = [B];
  const c = new WalletController(); await c.connect(a); await c.connect(b);
  a.emit('disconnect'); a.emit('accountsChanged', []);
  assert.equal(c.provider, b); assert.equal(c.state.account, B);
  assert.equal(a.listenerCount('disconnect'), 0);
});
test('old async refresh cannot overwrite a newer account', async () => {
  const p = new Provider(), c = new WalletController(); await c.connect(p);
  let done; const request = p.request.bind(p);
  p.request = call => call.method === 'eth_accounts' ? new Promise(r => { done = r; }) : request(call);
  const slow = c.refresh(); p.request = request;
  p.accounts = [B]; await c.refresh(); done([A]); await slow;
  assert.equal(c.state.account, B);
});
for (const accounts of [[], ['not-an-address'], 'wrong']) {
  test(`reject malformed/empty permission accounts ${JSON.stringify(accounts)}`, async () => {
    const p = new Provider(); p.accounts = accounts; const c = new WalletController();
    await assert.rejects(c.connect(p)); assert.equal(c.provider, null);
  });
}
test('invalid chain response clears connection', async () => {
  const p = new Provider(); p.chain = 'not-hex'; const c = new WalletController();
  await c.connect(p); assert.equal(c.state.account, null); assert.ok(c.state.error);
});
test('known chain switches without adding an RPC', async () => {
  const p = new Provider(), c = new WalletController(); await c.connect(p);
  await c.switchChain('', () => assert.fail('not needed'));
  assert.equal(c.state.chainId, CHAIN_ID);
  assert.equal(p.calls.filter(x => x.method === 'wallet_addEthereumChain').length, 0);
});
test('unknown chain probes RPC and adds exact metadata then explicitly switches', async () => {
  const p = new Provider(), c = new WalletController(); p.unknown = true; await c.connect(p);
  await c.switchChain('https://example.com/rpc', async () => CHAIN_ID);
  const args = p.calls.find(x => x.method === 'wallet_addEthereumChain').params[0];
  assert.equal(args.chainId, CHAIN_ID); assert.equal(args.nativeCurrency.symbol, 'ZNYT');
  assert.deepEqual(args.rpcUrls, ['https://example.com/rpc']);
  assert.equal(c.state.chainId, CHAIN_ID); assert.equal(c.state.busy, false);
});
test('RPC wrong-chain and inaccessible probes do not add network or lose address', async () => {
  for (const probe of [async () => '0x1', async () => { throw Error('unreachable'); }]) {
    const p = new Provider(), c = new WalletController(); p.unknown = true; await c.connect(p);
    await assert.rejects(c.switchChain('https://example.com/rpc', probe));
    assert.equal(c.state.account, A); assert.equal(c.state.busy, false);
    assert.ok(!p.calls.some(x => x.method === 'wallet_addEthereumChain'));
  }
});
test('cancel network change keeps connected account', async () => {
  const p = new Provider(), c = new WalletController(); await c.connect(p);
  const original = p.request.bind(p);
  p.request = call => call.method === 'wallet_switchEthereumChain'
    ? Promise.reject(Object.assign(Error('Denied'), { code: 4001 })) : original(call);
  await assert.rejects(c.switchChain('', () => {})); assert.equal(c.state.account, A);
  assert.equal(c.state.busy, false); assert.match(c.state.error, /キャンセル/);
});
test('disconnect during RPC probe prevents wallet_addEthereumChain', async () => {
  const p = new Provider(), c = new WalletController(); p.unknown = true; await c.connect(p);
  await assert.rejects(c.switchChain('https://example.com/rpc', async () => { c.disconnect(); return CHAIN_ID; }));
  assert.ok(!p.calls.some(x => x.method === 'wallet_addEthereumChain'));
});
test('refresh does not clear busy flag while wallet network prompt is pending', async () => {
  const p = new Provider(), c = new WalletController(); await c.connect(p);
  const original = p.request.bind(p); let done;
  p.request = call => call.method === 'wallet_switchEthereumChain'
    ? new Promise(resolve => { done = () => { p.chain = CHAIN_ID; resolve(null); }; }) : original(call);
  const pending = c.switchChain('', () => {});
  await c.refresh(); assert.equal(c.state.busy, true);
  await assert.rejects(c.connect(new Provider()));
  done(); await pending; assert.equal(c.state.busy, false);
});
test('wallet returning success without actually switching is not treated as successful', async () => {
  const p = new Provider(), c = new WalletController(); await c.connect(p);
  const original = p.request.bind(p); p.request = call => call.method === 'wallet_switchEthereumChain' ? null : original(call);
  await assert.rejects(c.switchChain('', () => {}), /完了していません/);
});
test('EIP-6963, multiple legacy wallets, delayed injection and deduplication', () => {
  const host = new EventTarget(); const a = new Provider(), b = new Provider(); a.isMetaMask = true; b.isRabby = true;
  host.ethereum = { providers: [a, b] };
  const seen = []; const discovery = discoverWallets(host, list => seen.push(list));
  assert.equal(discovery.entries.length, 2);
  const event = new Event('eip6963:announceProvider'); event.detail = { info: { name: 'Rabby Wallet' }, provider: b };
  host.dispatchEvent(event); assert.equal(discovery.entries.length, 2);
  assert.equal(discovery.entries[1].name, 'Rabby Wallet');
  const late = new Provider(); host.ethereum.providers.push(late); host.dispatchEvent(new Event('ethereum#initialized'));
  assert.equal(discovery.entries.length, 3); assert.ok(seen.length > 0);
  discovery.close();
});
test('no injected wallet leaves empty selection and supports later announcement', () => {
  const host = new EventTarget(), discovery = discoverWallets(host, () => {});
  assert.equal(discovery.entries.length, 0);
  const event = new Event('eip6963:announceProvider');
  event.detail = { info: { name: '<img onerror=evil()>' }, provider: new Provider() };
  host.dispatchEvent(event); assert.equal(discovery.entries[0].name, '<img onerror=evil()>');
  discovery.close();
});
test('RPC candidate uses reachable page origin, never visitor loopback by default', () => {
  const location = new URL('https://example.com/zeronyth/index.html');
  assert.equal(walletRpcUrl(location), 'https://example.com/zeronyth/rpc');
  assert.equal(walletRpcUrl(new URL('http://localhost:3000/')), 'http://localhost:3000/rpc');
  for (const bad of ['http://127.0.0.1:8545', 'https://user:pass@example.com/rpc', 'javascript:alert(1)',
    'http://remote.example/rpc', 'https://example.com/rpc?token=secret']) {
    assert.throws(() => walletRpcUrl(location, bad));
  }
});
test('format balance without floating point or arbitrary precision abuse', () => {
  assert.equal(formatZnyt('0x0'), '0 ZNYT');
  assert.equal(formatZnyt(`0x${(1234567890123456789n).toString(16)}`), '1.234567890123456789 ZNYT');
  assert.equal(formatZnyt('0x1'), '0.000000000000000001 ZNYT');
  assert.throws(() => formatZnyt('NaN')); assert.throws(() => formatZnyt(`0x${'f'.repeat(65)}`));
  assert.match(walletError({ code: -32002 }), /確認待ち/);
});
