import { analyzeSecurityRequest } from './security-engine.mjs';

// Narrow opt-in guard for transfers initiated INSIDE ZERONYTH's own UI.
// It cannot intercept other apps, override wallet prompts, or verify a hardware
// wallet's final signed bytes. Native transfers only; all calldata is forbidden.
const NETWORK_CHAIN = Object.freeze({ EVM: 1n, BNB: 56n, ZNYT: 9127n });
const EVM_ADDRESS = /^0x[\da-fA-F]{40}$/;
const WEI = 10n ** 18n;

function assertAddress(value, description) {
  if (typeof value !== 'string' || !EVM_ADDRESS.test(value)) throw Error(`${description} must be a full 0x-prefixed EVM address.`);
}

export function nativeAmountToWei(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(value)) {
    throw Error('Use a positive decimal amount with at most 18 decimal places (no exponent notation).');
  }
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * WEI + BigInt((fraction || '0').padEnd(18, '0'));
  if (amount <= 0n || amount >= 2n ** 256n) throw Error('Transfer amount must be positive and fit in uint256.');
  return amount;
}

export function buildGuardedNativePlan({ network, requestedRecipient, verifiedRecipient, amountNative }) {
  if (typeof network !== 'string' || !(network in NETWORK_CHAIN)) throw Error('Guarded sending supports EVM, BNB and ZNYT only.');
  assertAddress(requestedRecipient, 'Requested destination');
  assertAddress(verifiedRecipient, 'Independently verified recipient');
  if (requestedRecipient.toLowerCase() !== verifiedRecipient.toLowerCase()) {
    throw Error('BLOCKED: destination differs from the independently confirmed recipient.');
  }
  const wei = nativeAmountToWei(amountNative);
  const chainId = NETWORK_CHAIN[network];
  const transaction = Object.freeze({
    to: requestedRecipient,
    value: `0x${wei.toString(16)}`,
    data: '0x',
  });
  const analysis = analyzeSecurityRequest({
    network,
    expectedRecipient: verifiedRecipient,
    transaction: { ...transaction, chainId: Number(chainId) },
  });
  if (!analysis.complete || analysis.findings.some((f) => f.severity !== 'info') ||
      !analysis.findings.some((f) => f.code === 'NATIVE_TRANSFER')) {
    throw Error('BLOCKED: transaction is not an entirely decoded native transfer.');
  }
  const commitment = `${network}:${chainId}:${requestedRecipient.toLowerCase()}:${wei}`;
  return Object.freeze({ network, chainId: Number(chainId), transaction, commitment });
}

export async function sendGuardedNativeTransfer(provider, plan, { form, reviewedSender }) {
  if (!provider || typeof provider.request !== 'function') throw Error('An EIP-1193 wallet provider is required.');
  assertAddress(reviewedSender, 'Reviewed sender');
  // Check a fresh plan from the visible form, not only a previously approved snapshot.
  const fresh = buildGuardedNativePlan(form);
  if (!plan || plan.commitment !== fresh.commitment) {
    throw Error('BLOCKED: form changed since review; review again before signing.');
  }
  async function assertWalletIdentity() {
    const chainHex = await provider.request({ method: 'eth_chainId' });
    let active;
    try { active = BigInt(chainHex); } catch { throw Error('BLOCKED: wallet returned an invalid chain ID.'); }
    if (active !== BigInt(plan.chainId)) throw Error(`BLOCKED: wallet chain ${active} does not match reviewed chain ${plan.chainId}.`);
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== reviewedSender.toLowerCase()) {
      throw Error('BLOCKED: connected wallet account changed or is unavailable.');
    }
    return reviewedSender;
  }

  await assertWalletIdentity();
  const code = await provider.request({ method: 'eth_getCode', params: [fresh.transaction.to, 'latest'] });
  if (typeof code !== 'string' || !/^0x(?:00)*$/i.test(code)) {
    throw Error('BLOCKED: recipient is a contract, or its code could not be verified by the wallet provider.');
  }
  await assertWalletIdentity();

  // This request opens the WALLET'S OWN confirmation. Never sign on behalf of user.
  // The wallet controls how it displays/serializes the final transaction.
  return provider.request({
    method: 'eth_sendTransaction',
    params: [{ ...fresh.transaction, from: reviewedSender }],
  });
}
