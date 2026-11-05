// Live proof for the XRP engine (src/core/chains/xrp.mjs) on the XRP
// Testnet (Altnet). Read-only on mainnet; the only submission is a
// Payment from our own UNFUNDED derived account on Altnet, which the
// ledger must reject as terNO_ACCOUNT (proving the signed blob is
// well-formed — a malformed blob would come back temMALFORMED).
//
//   node evidence/multichain/xrp-live.mjs
//
// Writes xrp-live-output.json next to this script and prints it.
// No secrets are printed or recorded: the derived secret and the
// faucet-issued family seed are used in memory only and never logged.

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { deriveAccountSecret } from '../../src/core/hd.mjs';
import { publicKeyFromSecret } from '../../src/core/crypto.mjs';
import { ecdsaDerEncode } from '../../src/core/enc.mjs';
import {
  createXrpClient,
  deriveAddress,
  validateAddress,
  accountIdFromAddress,
  serializePayment,
  paymentSigningHash,
  computeTxId,
  bytesToHexUpper,
} from '../../src/core/chains/xrp.mjs';

const ALTNET = 'https://s.altnet.rippletest.net:51234';
const MAINNET = 'https://s1.ripple.com:51234';
const FAUCET_URL = 'https://faucet.altnet.rippletest.net/accounts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpcRaw(base, method, params = {}) {
  const res = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params: [params] }),
  });
  const json = await res.json();
  return { httpStatus: res.status, json };
}

async function probeHttp(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    await res.text(); // drain
    return { url, httpStatus: res.status, finalUrl: res.url };
  } catch (e) {
    return { url, httpStatus: null, error: String(e?.message ?? e) };
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  networks: { altnet: ALTNET, mainnet: MAINNET },
  steps: {},
};
const record = (name, data) => {
  out.steps[name] = data;
  console.error(`[xrp-live] ${name}: ${JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
};

// ---------------------------------------------------------- derived account
// Test master = 32 bytes of 0x42; XRP account index 0 via hd.mjs.
const master = new Uint8Array(32).fill(0x42);
const secret = deriveAccountSecret(master, 'xrp', 0);
const ourAddress = deriveAddress(secret, 'testnet');

const alt = createXrpClient(ALTNET);
record('connection', { altnetCheckConnection: await alt.checkConnection() });

const rawInfo = await rpcRaw(ALTNET, 'account_info', {
  account: ourAddress,
  strict: true,
  ledger_index: 'validated',
});
const ourBalance = await alt.getBalance(ourAddress);
record('derivedAccount', {
  address: ourAddress,
  validateAddress: validateAddress(ourAddress, 'testnet'),
  accountInfoStatus: rawInfo.json?.result?.status ?? null,
  accountInfoError: rawInfo.json?.result?.error ?? null, // expect 'actNotFound'
  balanceDrops: ourBalance, // expect 0n
});

// ---------------------------------------------------------- faucet account
const faucetRes = await fetch(FAUCET_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
});
const faucetJson = await faucetRes.json();
// The faucet returns a family seed for ITS account — recorded nowhere,
// never fed to the engine (the engine takes raw 32-byte keys only).
const faucetAddress = faucetJson?.account?.classicAddress ?? faucetJson?.account?.address ?? null;
let faucetBalance = null;
if (faucetAddress) {
  // Faucet funding needs a few seconds to validate; poll briefly.
  for (let i = 0; i < 10; i++) {
    faucetBalance = await alt.getBalance(faucetAddress);
    if (faucetBalance > 0n) break;
    await sleep(3000);
  }
}
record('faucetAccount', {
  httpStatus: faucetRes.status,
  address: faucetAddress,
  faucetAmountXrp: faucetJson?.amount ?? null,
  balanceDropsViaEngine: faucetBalance,
  balanceXrpViaEngine: faucetBalance != null ? Number(faucetBalance) / 1_000_000 : null,
});

// ---------------------------------------------------------- unfunded send
// A Payment of 1 XRP from our unfunded account (sequence 0). The blob
// must be accepted as well-formed and rejected only because the
// account does not exist: terNO_ACCOUNT, never tem*.
let sendRecord = {};
try {
  const plan = await alt.prepareSend({
    from: ourAddress,
    to: faucetAddress,
    amount: 1000000n, // 1 XRP
  });
  sendRecord.plan = {
    feeDrops: plan.fee,
    balanceDrops: plan.balance,
    sequence: plan.sequence,
    baseReserveDrops: plan.baseReserveDrops,
    destinationExists: plan.destinationExists,
    lastLedgerSequence: plan.lastLedgerSequence,
  };
  const { hash, engineResult } = await alt.executeSend(plan, secret);
  sendRecord.engine = { hash, engineResult };

  // executeSend does not surface engine_result_message, so rebuild the
  // identical blob in-script (noble ECDSA is RFC 6979 deterministic —
  // same plan + secret ⇒ same signature ⇒ same blob ⇒ same hash) and
  // submit it raw to capture the ledger's message verbatim.
  const baseTx = {
    accountId: accountIdFromAddress(plan.from),
    destinationId: accountIdFromAddress(plan.to),
    amountDrops: plan.amount,
    feeDrops: plan.fee,
    sequence: plan.sequence,
    lastLedgerSequence: plan.lastLedgerSequence,
  };
  const signingData = serializePayment({
    ...baseTx,
    signingPubKey: publicKeyFromSecret('xrp', secret),
  });
  const compact = secp256k1.sign(paymentSigningHash(signingData), secret, { prehash: false });
  const blob = serializePayment({
    ...baseTx,
    signingPubKey: publicKeyFromSecret('xrp', secret),
    txnSignature: ecdsaDerEncode(compact.slice(0, 32), compact.slice(32, 64)),
  });
  const rawHash = computeTxId(blob);
  sendRecord.rawResubmit = { hash: rawHash, hashMatchesEngine: rawHash === hash };
  if (rawHash === hash) {
    const submitted = await rpcRaw(ALTNET, 'submit', { tx_blob: bytesToHexUpper(blob) });
    sendRecord.rawResubmit.engine_result = submitted.json?.result?.engine_result ?? null;
    sendRecord.rawResubmit.engine_result_message =
      submitted.json?.result?.engine_result_message ?? null;
  }
  sendRecord.txStatusAfterSubmit = await alt.getTxStatus(hash); // never validated → 'pending'
} catch (e) {
  sendRecord.error = String(e?.message ?? e);
}
record('unfundedSend', sendRecord);

// ---------------------------------------------------------- reserves
const altReserve = await alt.getReserveInfo();
const mainReserve = await createXrpClient(MAINNET).getReserveInfo();
record('reserves', {
  altnet: { baseReserveDrops: altReserve.baseReserveDrops },
  mainnet: { baseReserveDrops: mainReserve.baseReserveDrops },
});

// ---------------------------------------------------------- explorer probes
const hash = sendRecord.engine?.hash;
if (hash) {
  record('explorerProbes', {
    testnet: await probeHttp(`https://testnet.xrpscan.com/tx/${hash}`),
    mainnet: await probeHttp(`https://xrpscan.com/tx/${hash}`),
    note: 'The transaction was rejected pre-validation (terNO_ACCOUNT), so no explorer can have it indexed; the probe records the HTTP status for the exact URL.',
  });
}

// ---------------------------------------------------------- verdict + output
const engineResult = sendRecord.engine?.engineResult ?? sendRecord.rawResubmit?.engine_result ?? null;
out.verdict = {
  derivedAccountUnfunded: rawInfo.json?.result?.error === 'actNotFound' && ourBalance === 0n,
  faucetBalanceReadViaEngine: faucetBalance != null && faucetBalance > 0n,
  blobWellFormed:
    typeof engineResult === 'string' && engineResult.startsWith('ter') && !engineResult.startsWith('tem'),
  engineResult,
};
const outPath = join(dirname(fileURLToPath(import.meta.url)), 'xrp-live-output.json');
await writeFile(
  outPath,
  JSON.stringify(out, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n',
);
console.log(JSON.stringify(out, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
console.error(`[xrp-live] wrote ${outPath}`);
