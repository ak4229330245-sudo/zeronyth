import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSecurityRequest } from '../dashboard/assets/security-engine.mjs';

const A = `0x${'1'.repeat(40)}`;
const B = `0x${'2'.repeat(40)}`;
const word = (x) => x.replace(/^0x/, '').padStart(64, '0');
const evm = (network, selector, args = [], extras = {}) => ({
  network, expectedRecipient: A,
  transaction: { chainId: network === 'BNB' ? 56 : network === 'ZNYT' ? 9127 : 1,
    to: A, value: '0', data: `${selector}${args.map(word).join('')}` }, ...extras,
});
const codes = (result) => result.findings.map((f) => f.code);

test('EVM unlimited ERC20 approval is critical', () => {
  const report = analyzeSecurityRequest(evm('EVM', '0x095ea7b3', [B, `0x${'f'.repeat(64)}`]));
  assert.equal(report.risk, 'CRITICAL');
  assert.ok(codes(report).includes('TOKEN_APPROVAL'));
  assert.equal(report.decision, 'MANUAL_REVIEW_REQUIRED');
});

test('BNB uses the EVM decoder and catches wrong chain', () => {
  const request = evm('BNB', '0xa9059cbb', [A, '10']);
  request.transaction.chainId = 1;
  const report = analyzeSecurityRequest(request);
  assert.ok(codes(report).includes('CHAIN_MISMATCH'));
  assert.equal(report.risk, 'HIGH');
});

test('ZERONYTH uses local chain ID and does not pretend PQC validation', () => {
  const report = analyzeSecurityRequest(evm('ZNYT', '0xa9059cbb', [A, '10']));
  assert.ok(codes(report).includes('TOKEN_TRANSFER'));
  assert.match(report.disclaimer, /post-quantum protection/);
});

test('ERC20 destination substitution is critical', () => {
  const report = analyzeSecurityRequest(evm('EVM', '0xa9059cbb', [B, '1']));
  assert.ok(codes(report).includes('DESTINATION_MISMATCH'));
  assert.equal(report.risk, 'CRITICAL');
});

test('Unknown EVM method never passes as complete', () => {
  const report = analyzeSecurityRequest(evm('EVM', '0xdeadbeef'));
  assert.equal(report.complete, false);
  assert.ok(codes(report).includes('UNKNOWN_CALL'));
});

test('EIP712 signature preview fails closed', () => {
  const report = analyzeSecurityRequest({ network: 'EVM', expectedRecipient: A, typedData: { primaryType: 'Permit' } });
  assert.equal(report.risk, 'HIGH');
  assert.equal(report.complete, false);
  assert.ok(codes(report).includes('TYPED_SIGNATURE_UNCHECKED'));
});

test('Safe EIP-712 DELEGATECALL and changed recipient are critical (Bybit-style)', () => {
  const report = analyzeSecurityRequest({ network: 'EVM', expectedRecipient: A, expectedSafe: A,
    typedData: { primaryType: 'SafeTx', domain: { chainId: 1, verifyingContract: A },
      types: { SafeTx: [{ name: 'operation', type: 'uint8' }] },
      message: { to: B, value: '0', operation: 1, data: '0xa9059cbb', nonce: '7' } },
  });
  assert.equal(report.risk, 'CRITICAL');
  for (const code of ['SAFE_DELEGATECALL', 'DESTINATION_MISMATCH', 'SAFE_NESTED_CALL_UNVERIFIED']) {
    assert.ok(codes(report).includes(code), code);
  }
});

test('Safe EIP-712 verifyingContract mismatch is critical', () => {
  const report = analyzeSecurityRequest({ network: 'BNB', expectedRecipient: A, expectedSafe: A,
    typedData: { primaryType: 'SafeTx', domain: { chainId: 56, verifyingContract: B },
      types: { SafeTx: [{ name: 'to', type: 'address' }] },
      message: { to: A, value: '0', operation: 0, data: '0x', nonce: '1' } },
  });
  assert.equal(report.risk, 'CRITICAL');
  assert.ok(codes(report).includes('SAFE_DOMAIN_MISMATCH'));
});

test('Solana delegates and authority mutation are flagged', () => {
  const report = analyzeSecurityRequest({ network: 'SOL',
    instructions: [
      { program: 'spl-token', parsed: { type: 'approve', info: { delegate: '11111111111111111111111111111111' } } },
      { program: 'spl-token', parsed: { type: 'setAuthority', info: {} } },
    ] });
  assert.equal(report.risk, 'CRITICAL');
  assert.ok(codes(report).includes('SOL_DELEGATE'));
  assert.ok(codes(report).includes('SOL_AUTHORITY_CHANGE'));
});

test('Solana unknown program does not get marked as decoded', () => {
  const report = analyzeSecurityRequest({ network: 'SOL', instructions: [{ program: 'unknown', data: 'base64' }] });
  assert.equal(report.complete, false);
  assert.ok(codes(report).includes('UNDECODED_SOL_INSTRUCTION'));
});

test('Bitcoin unexpected output and missing recipient are flagged', () => {
  const intended = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
  const other = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
  const report = analyzeSecurityRequest({ network: 'BTC', expectedRecipient: intended, psbt: {
    inputs: [{ amountSat: '100000' }], outputs: [{ address: other, amountSat: '90000' }],
  } });
  assert.equal(report.risk, 'CRITICAL');
  assert.ok(codes(report).includes('DESTINATION_MISMATCH'));
  assert.ok(codes(report).includes('BTC_EXTRA_OUTPUT'));
});

test('Bitcoin huge fee is high and missing inputs are incomplete', () => {
  const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
  const report = analyzeSecurityRequest({ network: 'BTC', expectedRecipient: address,
    psbt: { inputs: [{ amountSat: '1000000' }], outputs: [{ address, amountSat: '100000' }], changeAddress: address } });
  assert.equal(report.risk, 'HIGH');
  assert.ok(codes(report).includes('BTC_FEE'));

  const incomplete = analyzeSecurityRequest({ network: 'BTC', expectedRecipient: address,
    psbt: { outputs: [{ address, amountSat: '100000' }] } });
  assert.equal(incomplete.complete, false);
});

test('Invalid inputs are rejected without inventing a safe result', () => {
  assert.throws(() => analyzeSecurityRequest({ network: 'EVM', transaction: { to: 'bad' } }), /Invalid EVM/);
  assert.throws(() => analyzeSecurityRequest({ network: 'BTC', psbt: { inputs: [{ amountSat: '10' }], outputs: [{ amountSat: '100' }] } }), /Outputs exceed inputs/);
});
