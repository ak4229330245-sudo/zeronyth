// Chain gas policy for the three schemes.
//
// The chain (PqIntrinsicGas in the ported Besu) charges a per-scheme
// signature-verification surcharge on top of the plain 21,000 intrinsic
// gas, because PQ signatures are kilobyte-sized and expensive to verify:
//
//   scheme   surcharge   plain-transfer intrinsic (= 21,000 + surcharge)
//   ecdsa          0               21,000
//   falcon    82,080              103,080
//   mldsa    126,176              147,176
//
// These are consensus values, proven on-chain (Phase 0 + production):
// a plain transfer consumes EXACTLY its intrinsic floor. Send forms on
// 912701 therefore use:
//   plain transfer -> gasLimit = intrinsic floor (no estimate needed)
//   contract call  -> gasLimit = eth_estimateGas + surcharge
// (the same estimate+surcharge pattern the v1 wallet shipped with for
// ML-DSA, generalized to all three schemes — wallet-v2-plan §4.4).

import { isScheme } from './crypto.mjs';

export const BASE_INTRINSIC_GAS = 21000n;

export const SIGNATURE_SURCHARGE = Object.freeze({
  ecdsa: 0n,
  falcon: 82080n,
  mldsa: 126176n,
});

export const INTRINSIC_GAS = Object.freeze({
  ecdsa: BASE_INTRINSIC_GAS + SIGNATURE_SURCHARGE.ecdsa, // 21,000
  falcon: BASE_INTRINSIC_GAS + SIGNATURE_SURCHARGE.falcon, // 103,080
  mldsa: BASE_INTRINSIC_GAS + SIGNATURE_SURCHARGE.mldsa, // 147,176
});

function check(scheme) {
  if (!isScheme(scheme)) throw Error(`Unknown scheme: ${scheme}`);
}

/** Exact gas a plain transfer will consume under this scheme. */
export function intrinsicGas(scheme) {
  check(scheme);
  return INTRINSIC_GAS[scheme];
}

/** Per-scheme signature surcharge added on top of a call estimate. */
export function signatureSurcharge(scheme) {
  check(scheme);
  return SIGNATURE_SURCHARGE[scheme];
}

/** gasLimit for a plain transfer: exactly the intrinsic floor. */
export function transferGasLimit(scheme) {
  return intrinsicGas(scheme);
}

/** gasLimit for a contract call: node estimate plus the scheme surcharge. */
export function callGasLimit(scheme, estimate) {
  check(scheme);
  const est = typeof estimate === 'bigint' ? estimate : BigInt(estimate);
  if (est < 0n) throw Error('estimate cannot be negative');
  return est + SIGNATURE_SURCHARGE[scheme];
}
