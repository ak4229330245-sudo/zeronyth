// Aptos live proof for the Quantum Wallet v2 multi-chain expansion.
//
// Run:  node evidence/multichain/aptos-live.mjs
// Writes evidence/multichain/aptos-live-output.json and prints it.
//
// What it does:
//   1. Derives accounts A (index 0) and B (index 1) from the public
//      test master seed 0x42×32 via hd.mjs ("aptos" domain). No real
//      funds, no secrets printed — only public addresses.
//   2. TESTNET funding, exactly as originally specified: POST
//      https://faucet.testnet.aptoslabs.com/mint?amount=…&address=A,
//      and — when that fails — the currently documented alternative,
//      POST https://faucet-e2.testnet.aptoslabs.com/fund.
//      VERIFIED 2026-11-05: the legacy testnet faucet host no longer
//      answers at all (connection dropped / timeout), and the current
//      testnet faucet (faucet-e2, see
//      https://aptos.dev/build/apis/faucet-api) requires a Google
//      Firebase ID token (x-is-jwt) — a human sign-in an automated
//      proof cannot perform. Both attempts are recorded verbatim.
//   3. Because testnet funding is human-gated, the funded transfer is
//      executed on DEVNET, whose faucet is the documented programmable
//      one: POST https://faucet.devnet.aptoslabs.com/fund with a JSON
//      {"address", "amount"} body → {"txn_hashes": ["<hex>"]}.
//      The engine under test (src/core/chains/aptos.mjs) is identical
//      code — only the apiBase differs — and devnet's chain_id is
//      read from its own ledger info. A → B, 100000 octas, polled to
//      success through the engine's own getTxStatus.
//   4. MAINNET is read-only: chain_id + the framework account (0x1)
//      balance. NEVER a mainnet send.
//   5. TESTNET read-only checks are recorded too (chain_id, A's
//      balance after the faucet attempts), plus an explorer probe of
//      the devnet transaction.

import { writeFile } from 'node:fs/promises';

import { createAptosClient, deriveAddress } from '../../src/core/chains/aptos.mjs';
import { deriveAccountSecret } from '../../src/core/hd.mjs';

const TESTNET_API = 'https://fullnode.testnet.aptoslabs.com/v1';
const MAINNET_API = 'https://fullnode.mainnet.aptoslabs.com/v1';
const DEVNET_API = 'https://fullnode.devnet.aptoslabs.com/v1';
const LEGACY_TESTNET_FAUCET = 'https://faucet.testnet.aptoslabs.com/mint';
const TESTNET_FAUCET = 'https://faucet-e2.testnet.aptoslabs.com/fund';
const DEVNET_FAUCET = 'https://faucet.devnet.aptoslabs.com/fund';
const FRAMEWORK = '0x0000000000000000000000000000000000000000000000000000000000000001';

const FUND_AMOUNT = 100000000n; // 1 APT, as specified
const SEND_AMOUNT = 100000n; // 0.001 APT, as specified

const master = new Uint8Array(32).fill(0x42); // public test fixture
const secretA = deriveAccountSecret(master, 'aptos', 0);
const secretB = deriveAccountSecret(master, 'aptos', 1);
const A = deriveAddress(secretA, 'testnet');
const B = deriveAddress(secretB, 'testnet');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const str = (v) => (typeof v === 'bigint' ? v.toString() : v);

async function pollUntil(fn, timeoutMs, intervalMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await fn();
    if (last?.done) return last.value;
    if (Date.now() >= deadline) return last?.value;
    await sleep(intervalMs);
  }
}

/** One faucet attempt; returns a record, never throws. */
async function faucetAttempt(url, init, timeoutMs = 20000) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    return { url, method: init.method ?? 'GET', httpStatus: res.status, body: text.slice(0, 500), ok: res.ok };
  } catch (err) {
    return { url, method: init.method ?? 'GET', httpStatus: null, error: `${err.name}: ${err.message}`, ok: false };
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  engine: 'src/core/chains/aptos.mjs',
  accounts: { A, B },
  testnet: {},
  devnet: {},
  mainnet: {},
  notes: [],
};

let failed = false;

try {
  // ---------------------------------------------------------- testnet (read + faucet attempts)
  const testnet = createAptosClient(TESTNET_API);
  output.testnet.api = TESTNET_API;
  output.testnet.connection = await testnet.checkConnection();
  output.testnet.chainId = await testnet.getChainId();
  output.testnet.balanceABefore = str(await testnet.getBalance(A));

  const legacy = await faucetAttempt(
    `${LEGACY_TESTNET_FAUCET}?amount=${FUND_AMOUNT}&address=${A}`,
    { method: 'POST' },
  );
  const documented = await faucetAttempt(TESTNET_FAUCET, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: A, amount: Number(FUND_AMOUNT) }),
  });
  output.testnet.faucetAttempts = [legacy, documented];
  output.notes.push(
    'Testnet faucet (verified 2026-11-05): the legacy faucet.testnet.aptoslabs.com/mint host ' +
      'no longer answers (connection dropped / request timeout). The current documented testnet ' +
      'faucet is faucet-e2.testnet.aptoslabs.com POST /fund, which rejects unauthenticated calls: ' +
      'it requires a Google Firebase ID token (x-is-jwt header) from a human sign-in — see ' +
      'https://aptos.dev/build/apis/faucet-api. An automated proof cannot fund testnet; the ' +
      'funded transfer below therefore runs on devnet through the same engine code, and ' +
      `testnet account A (${A}) can be funded by hand on the mint page to repeat it there.`,
  );
  // Give any faucet transaction a brief chance to land, then re-read.
  await sleep(5000);
  output.testnet.balanceAAfterFaucetAttempts = str(await testnet.getBalance(A));
  output.testnet.funded = BigInt(output.testnet.balanceAAfterFaucetAttempts) > 0n;

  // ---------------------------------------------------------- devnet funded transfer
  const devnet = createAptosClient(DEVNET_API);
  output.devnet.api = DEVNET_API;
  output.devnet.connection = await devnet.checkConnection();
  output.devnet.chainId = await devnet.getChainId();
  output.devnet.balanceABefore = str(await devnet.getBalance(A));
  output.devnet.balanceBBefore = str(await devnet.getBalance(B));

  const fund = await faucetAttempt(DEVNET_FAUCET, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: A, amount: Number(FUND_AMOUNT) }),
  });
  output.devnet.faucet = fund;
  let fundHashes = [];
  try {
    fundHashes = JSON.parse(fund.body)?.txn_hashes ?? [];
  } catch {
    fundHashes = [];
  }
  output.devnet.faucetTxnHashes = fundHashes.map((h) => (h.startsWith('0x') ? h : `0x${h}`));
  output.notes.push(
    'Devnet faucet shape (verified live): POST https://faucet.devnet.aptoslabs.com/fund ' +
      'with JSON {"address","amount"} → HTTP 200 {"txn_hashes":["<64 hex, no 0x prefix>"]}.',
  );
  if (!fund.ok) throw Error(`devnet faucet failed: ${fund.body ?? fund.error}`);

  const fundedBalance = await pollUntil(async () => {
    const bal = await devnet.getBalance(A);
    return { done: bal > 0n, value: bal };
  }, 60000);
  output.devnet.balanceAAfterFunding = str(fundedBalance);
  if (!fundedBalance || fundedBalance <= 0n) throw Error('devnet faucet balance never landed within 60 s');

  const plan = await devnet.prepareSend({ from: A, to: B, amount: SEND_AMOUNT });
  output.devnet.plan = {
    from: plan.from,
    to: plan.to,
    amount: str(plan.amount),
    feeUpperBound: str(plan.fee),
    balance: str(plan.balance),
    sequence: str(plan.sequence),
    gasUnitPrice: plan.gasUnitPrice,
    maxGasAmount: plan.maxGasAmount,
    chainId: plan.chainId,
    expirationSecs: plan.expirationSecs,
  };

  const { hash } = await devnet.executeSend(plan, secretA);
  output.devnet.txHash = hash;

  const status = await pollUntil(async () => {
    const s = await devnet.getTxStatus(hash);
    return { done: s === 'success' || s === 'failed', value: s };
  }, 90000);
  output.devnet.txStatus = status;

  // Raw transaction record for the vm_status.
  try {
    const res = await fetch(`${DEVNET_API}/transactions/by_hash/${hash}`, {
      signal: AbortSignal.timeout(20000),
    });
    const j = await res.json();
    output.devnet.vmStatus = j?.vm_status ?? null;
    output.devnet.txType = j?.type ?? null;
  } catch (err) {
    output.devnet.vmStatus = null;
    output.devnet.vmStatusError = `${err.name}: ${err.message}`;
  }

  output.devnet.balanceAAfter = str(await devnet.getBalance(A));
  output.devnet.balanceBAfter = str(await devnet.getBalance(B));
  output.devnet.sentConfirmed =
    status === 'success' &&
    BigInt(output.devnet.balanceBAfter) - BigInt(output.devnet.balanceBBefore) === SEND_AMOUNT;
  if (!output.devnet.sentConfirmed) failed = true;

  // Explorer probe for the live transaction.
  const explorerUrl = `https://explorer.aptoslabs.com/txn/${hash}?network=devnet`;
  const probe = await faucetAttempt(explorerUrl, { method: 'GET' }, 20000);
  output.devnet.explorer = { url: explorerUrl, httpStatus: probe.httpStatus, ok: probe.ok };

  // ---------------------------------------------------------- mainnet (read-only)
  const mainnet = createAptosClient(MAINNET_API);
  output.mainnet.api = MAINNET_API;
  output.mainnet.connection = await mainnet.checkConnection();
  output.mainnet.chainId = await mainnet.getChainId();
  output.mainnet.frameworkAccount = FRAMEWORK;
  output.mainnet.frameworkBalanceOctas = str(await mainnet.getBalance(FRAMEWORK));
  output.mainnet.sendsAttempted = false;
} catch (err) {
  failed = true;
  output.error = `${err.name}: ${err.message}`;
}

const outUrl = new URL('./aptos-live-output.json', import.meta.url);
await writeFile(outUrl, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
if (failed) process.exitCode = 1;
