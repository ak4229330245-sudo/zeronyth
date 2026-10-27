import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGuardedNativePlan, nativeAmountToWei, sendGuardedNativeTransfer } from '../dashboard/assets/guarded-send.mjs';

const A = `0x${'1'.repeat(40)}`;
const B = `0x${'2'.repeat(40)}`;
const SENDER = `0x${'3'.repeat(40)}`;
const form = Object.freeze({ network: 'ZNYT', requestedRecipient: A, verifiedRecipient: A, amountNative: '0.001' });

function providerMock(options = {}) {
  const calls = [];
  const p = {
    calls,
    async request(call) {
      calls.push(call);
      if (call.method === 'eth_chainId') return options.chainId ?? '0x23a7';
      if (call.method === 'eth_accounts') return [options.account ?? SENDER];
      if (call.method === 'eth_getCode') return options.code ?? '0x';
      if (call.method === 'eth_sendTransaction') return '0xTEST_HASH';
      throw Error(`Unexpected method ${call.method}`);
    },
  };
  return p;
}

test('Decimal amounts are parsed exactly without floating-point errors', () => {
  assert.equal(nativeAmountToWei('0.000000000000000001'), 1n);
  assert.equal(nativeAmountToWei('1.123456789123456789'), 1123456789123456789n);
  assert.throws(() => nativeAmountToWei('1e2'), /decimal amount/);
  assert.throws(() => nativeAmountToWei('0'), /positive/);
});

test('Recipient mismatch blocks while constructing plan before wallet call', () => {
  assert.throws(() => buildGuardedNativePlan({ ...form, verifiedRecipient: B }), /BLOCKED/);
});

test('Guarded sending passes only strict native transfer to wallet confirmation', async () => {
  const plan = buildGuardedNativePlan(form);
  const wallet = providerMock();
  const hash = await sendGuardedNativeTransfer(wallet, plan, { form, reviewedSender: SENDER });
  assert.equal(hash, '0xTEST_HASH');
  const sendCall = wallet.calls.filter((call) => call.method === 'eth_sendTransaction');
  assert.equal(sendCall.length, 1);
  assert.deepEqual(sendCall[0].params, [{ from: SENDER, to: A, value: '0x38d7ea4c68000', data: '0x' }]);
  assert.equal(wallet.calls.filter((call) => call.method === 'eth_chainId').length, 2);
});

test('Wallet network mismatch never sends', async () => {
  const wallet = providerMock({ chainId: '0x38' });
  await assert.rejects(sendGuardedNativeTransfer(wallet, buildGuardedNativePlan(form), { form, reviewedSender: SENDER }), /BLOCKED/);
  assert.ok(!wallet.calls.some((call) => call.method === 'eth_sendTransaction'));
});

test('Wallet account changed never sends', async () => {
  const wallet = providerMock({ account: B });
  await assert.rejects(sendGuardedNativeTransfer(wallet, buildGuardedNativePlan(form), { form, reviewedSender: SENDER }), /BLOCKED/);
  assert.ok(!wallet.calls.some((call) => call.method === 'eth_sendTransaction'));
});

test('Contract recipient or missing code response is blocked', async () => {
  for (const code of ['0x60016001', null]) {
    const wallet = providerMock({ code });
    // null is an invalid RPC reply; do not implicitly treat it as no code.
    if (code === null) wallet.request = async (call) => {
      wallet.calls.push(call);
      if (call.method === 'eth_chainId') return '0x23a7';
      if (call.method === 'eth_accounts') return [SENDER];
      if (call.method === 'eth_getCode') return null;
      throw Error('Should never broadcast');
    };
    await assert.rejects(sendGuardedNativeTransfer(wallet, buildGuardedNativePlan(form), { form, reviewedSender: SENDER }), /BLOCKED/);
    assert.ok(!wallet.calls.some((call) => call.method === 'eth_sendTransaction'));
  }
});

test('Form mutation after review blocks before wallet access', async () => {
  const wallet = providerMock();
  await assert.rejects(sendGuardedNativeTransfer(wallet, buildGuardedNativePlan(form),
    { form: { ...form, amountNative: '0.002' }, reviewedSender: SENDER }), /BLOCKED/);
  assert.equal(wallet.calls.length, 0);
});
