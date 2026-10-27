import test from 'node:test';
import assert from 'node:assert/strict';
import { AdmissionPolicy } from '../experiments/operations-policy.mjs';
const origin = 'https://example.invalid';
const request = { path:'/rpc', method:'POST', origin, clientId:'127.0.0.1', bytes:100, rpcMethod:'eth_blockNumber' };
test('public reference policy requires HTTPS origin and bounded limits', () => {
  assert.throws(() => new AdmissionPolicy({ origin:'http://example.invalid' }));
  assert.throws(() => new AdmissionPolicy({ origin, maxClients:Infinity }));
  assert.throws(() => new AdmissionPolicy({ origin:origin + '/path' }));
});
test('public reference policy allows only explicit read methods, never sign/send/admin', () => {
  const p = new AdmissionPolicy({ origin });
  assert.ok(p.admit(request, 0).allowed);
  for (const rpcMethod of ['eth_sendTransaction','eth_sendRawTransaction','personal_sign',
    'admin_peers','debug_traceBlock','wallet_addEthereumChain'])
    assert.equal(p.admit({ ...request, rpcMethod }, 1).code,'READ_ONLY_RPC');
});
test('cross-origin, unexpected routes and oversized bodies fail closed', () => {
  const p = new AdmissionPolicy({ origin });
  assert.equal(p.admit({ ...request, origin:'https://untrusted.invalid' },0).status,403);
  assert.equal(p.admit({ ...request, path:'/admin' },0).status,404);
  for (const bytes of [65537, NaN, -1, Infinity])
    assert.equal(p.admit({ ...request, bytes },0).status,413);
});
test('rate window and client map have explicit bounds', () => {
  const p = new AdmissionPolicy({ origin, requestsPerMinute:2, maxClients:1 });
  assert.ok(p.admit(request,0).allowed);
  assert.ok(p.admit(request,1).allowed);
  assert.equal(p.admit(request,2).status,429);
  assert.equal(p.admit({ ...request, clientId:'127.0.0.2' },3).status,503);
  assert.ok(p.admit(request,60000).allowed);
  assert.ok(p.clients.size <= 1);
});
test('faucet is disabled by default and requires server-verified authorization and devnet chain', () => {
  const claim = { ...request, path:'/faucet', authenticated:true, chainId:9127 };
  assert.equal(new AdmissionPolicy({ origin }).admit(claim,0).status,403);
  const p = new AdmissionPolicy({ origin, enableFaucet:true });
  assert.equal(p.admit({ ...claim, authenticated:false },0).status,403);
  assert.equal(p.admit({ ...claim, authenticated:'true' },0).status,403);
  assert.equal(p.admit({ ...claim, chainId:1 },0).status,403);
  assert.ok(p.admit(claim,0).allowed);
  assert.equal(p.admit(claim,1).status,429);
});
test('clock rollback fails closed instead of resetting quota', () => {
  const p = new AdmissionPolicy({ origin });
  assert.ok(p.admit(request,100).allowed);
  assert.equal(p.admit(request,99).code,'CLOCK_ROLLBACK');
});
