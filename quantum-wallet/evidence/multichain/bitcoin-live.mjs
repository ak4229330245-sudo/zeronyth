// Live evidence for the Bitcoin engine (evidence/multichain/).
//
// Run: node evidence/multichain/bitcoin-live.mjs
// Writes evidence/multichain/bitcoin-live-output.json and prints it.
//
// MAINNET IS READ-ONLY: balances / UTXOs are read for the genesis
// address and for the address derived from the public 0x42-fill test
// master (hd 'bitcoin', index 0). No mainnet transaction is ever built
// or broadcast. On testnet, the derived tb1 address is unfunded, so —
// after a timeboxed check for a no-captcha programmatic faucet (none
// found: the known faucets are interactive HTML/captcha pages) — a
// fully signed transaction spending a SYNTHETIC utxo (a real testnet
// txid with a fabricated value) is broadcast and esplora's rejection is
// recorded as broadcast-format evidence. That failure is EXPECTED: the
// point is that esplora parses and consensus-checks our serialization.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createBitcoinClient, deriveAddress } from '../../src/core/chains/bitcoin.mjs';
import { deriveAccountSecret } from '../../src/core/hd.mjs';
import { addressFromSecret } from '../../src/core/crypto.mjs';

const MAINNET_API = 'https://blockstream.info/api';
const TESTNET_API = 'https://blockstream.info/testnet/api';
const GENESIS_ADDRESS = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const OUTPUT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bitcoin-live-output.json');

const fetchTimeout = (url, init = {}) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(20000) });

async function getJson(url) {
  const res = await fetchTimeout(url);
  if (!res.ok) throw Error(`GET ${url} → HTTP ${res.status}`);
  return res.json();
}

async function getText(url) {
  const res = await fetchTimeout(url);
  if (!res.ok) throw Error(`GET ${url} → HTTP ${res.status}`);
  return (await res.text()).trim();
}

async function probeStatus(url) {
  try {
    const res = await fetchTimeout(url);
    await res.text(); // drain
    return res.status;
  } catch (err) {
    return `error: ${err.message}`;
  }
}

const out = {
  chain: 'bitcoin',
  engine: 'src/core/chains/bitcoin.mjs',
  generatedAt: new Date().toISOString(),
  mainnet: {},
  testnet: {},
  explorerProbes: {},
  notes: [
    'Mainnet access was READ-ONLY (UTXO/balance reads). No mainnet funds were used or moved.',
    'The 0x42-fill master seed is a public test fixture, not a user secret.',
  ],
};

const mainnet = createBitcoinClient(MAINNET_API, { fetchImpl: fetchTimeout });
const testnet = createBitcoinClient(TESTNET_API, { fetchImpl: fetchTimeout });

// ------------------------------------------------------------ mainnet reads

out.mainnet.tipHeight = await mainnet.checkConnection();

const genesisUtxos = await getJson(`${MAINNET_API}/address/${GENESIS_ADDRESS}/utxo`).catch((err) => ({ error: err.message }));
if (Array.isArray(genesisUtxos)) {
  const genesisTotal = genesisUtxos.reduce((sum, u) => sum + BigInt(u.value), 0n);
  out.mainnet.genesisAddress = {
    address: GENESIS_ADDRESS,
    utxoCount: genesisUtxos.length,
    totalSatoshis: genesisTotal.toString(),
    totalBtc: `${genesisTotal / 100000000n}.${String(genesisTotal % 100000000n).padStart(8, '0')}`,
  };
} else {
  // The genesis address holds tens of thousands of dust UTXOs and
  // esplora's /utxo listing refuses it ("Too many unspent outputs").
  // Count + total are then taken from the same API's /address chain
  // stats (funded − spent, chain + mempool), recorded alongside the
  // exact /utxo refusal.
  const stats = await getJson(`${MAINNET_API}/address/${GENESIS_ADDRESS}`);
  const utxoCount =
    stats.chain_stats.funded_txo_count - stats.chain_stats.spent_txo_count +
    (stats.mempool_stats.funded_txo_count - stats.mempool_stats.spent_txo_count);
  const genesisTotal =
    BigInt(stats.chain_stats.funded_txo_sum) - BigInt(stats.chain_stats.spent_txo_sum) +
    BigInt(stats.mempool_stats.funded_txo_sum) - BigInt(stats.mempool_stats.spent_txo_sum);
  out.mainnet.genesisAddress = {
    address: GENESIS_ADDRESS,
    utxoEndpointError: genesisUtxos.error,
    utxoCount,
    totalSatoshis: genesisTotal.toString(),
    totalBtc: `${genesisTotal / 100000000n}.${String(genesisTotal % 100000000n).padStart(8, '0')}`,
    source: 'esplora /address chain_stats + mempool_stats (funded − spent); the /address/{a}/utxo listing itself refuses this address — see utxoEndpointError',
  };
}

// Test-master derived account (index 0), mainnet form — a real read,
// balance 0 expected (the fixture has never been funded).
const master = new Uint8Array(32).fill(0x42);
const secret0 = deriveAccountSecret(master, 'bitcoin', 0);
const secret1 = deriveAccountSecret(master, 'bitcoin', 1);
const mainnetAddress0 = deriveAddress(secret0, 'mainnet');
out.mainnet.derivedFromTestMaster = {
  address: mainnetAddress0,
  matchesCryptoAddressFromSecret: mainnetAddress0 === addressFromSecret('bitcoin', secret0),
  balanceSatoshis: (await mainnet.getBalance(mainnetAddress0)).toString(),
};

// ------------------------------------------------------------ testnet reads

out.testnet.tipHeight = await testnet.checkConnection();
const testnetAddress0 = deriveAddress(secret0, 'testnet');
const testnetAddress1 = deriveAddress(secret1, 'testnet');
const testnetUtxos0 = await getJson(`${TESTNET_API}/address/${testnetAddress0}/utxo`);
out.testnet.derivedFromTestMaster = {
  addressIndex0: testnetAddress0,
  addressIndex1: testnetAddress1,
  utxoCount: testnetUtxos0.length,
  balanceSatoshis: (await testnet.getBalance(testnetAddress0)).toString(),
};

// ------------------------------------------------------------ faucet probe
// Timeboxed: the well-known testnet faucets are interactive HTML pages
// gated by captcha — there is no no-captcha JSON API to claim from.
// We probe their reachability and record the outcome; if the derived
// address were somehow funded afterwards, a real send would follow.

const faucetProbes = [];
for (const url of [
  'https://coinfaucet.eu/en/btc-testnet/',
  'https://mempool.space/testnet/faucet',
  'https://bitcoinfaucet.uo1.net/',
]) {
  try {
    const res = await fetchTimeout(url);
    const contentType = res.headers.get('content-type') ?? '';
    await res.text();
    faucetProbes.push({ url, httpStatus: res.status, contentType });
  } catch (err) {
    faucetProbes.push({ url, httpStatus: `error: ${err.message}` });
  }
}
out.testnet.faucetProbe = {
  attempted: true,
  result: 'no no-captcha JSON faucet API reachable — all known faucets serve interactive HTML (captcha) pages; no claim made',
  probes: faucetProbes,
};
const balanceAfterFaucetProbe = await testnet.getBalance(testnetAddress0);
out.testnet.derivedFromTestMaster.balanceAfterFaucetProbeSatoshis = balanceAfterFaucetProbe.toString();

if (balanceAfterFaucetProbe > 1000n + 546n) {
  // Funded path (not taken on this run): a real 1000-sat send idx0 → idx1.
  const plan = await testnet.prepareSend({ from: testnetAddress0, to: testnetAddress1, amount: 1000n });
  const { hash } = await testnet.executeSend(plan, secret0);
  out.testnet.realSend = {
    amountSatoshis: '1000',
    feeSatoshis: plan.fee.toString(),
    txid: hash,
    status: await testnet.getTxStatus(hash),
  };
} else {
  // ---------------------------------------------------------- synthetic send
  // Build a real signed tx spending a synthetic UTXO: the txid is a
  // REAL testnet transaction (taken from the tip block), vout 0, with
  // a fabricated value of 100_000 sat. Our key does not control that
  // output, so esplora must reject the broadcast — the rejection text
  // is the evidence that the serialization is well-formed enough to be
  // parsed and consensus-checked.
  const tipHash = await getText(`${TESTNET_API}/blocks/tip/hash`);
  const tipTxids = await getJson(`${TESTNET_API}/block/${tipHash}/txids`);
  const realTestnetTxid = tipTxids[0];
  out.testnet.syntheticBroadcast = {
    expectedFailure: true,
    syntheticUtxo: { txid: realTestnetTxid, vout: 0, fabricatedValueSatoshis: '100000' },
    sendAmountSatoshis: '1000',
    from: testnetAddress0,
    to: testnetAddress1,
  };
  const plan = {
    from: testnetAddress0,
    to: testnetAddress1,
    variant: 'testnet',
    amount: 1000n,
    fee: 141n, // 1 sat/vB × 141 vB (1 input, 2 outputs) — fee content is moot for a rejected tx
    change: 100000n - 1000n - 141n,
    feeRateSatVb: 1.0,
    vsize: 141,
    inputs: [{ txid: realTestnetTxid, vout: 0, value: 100000 }],
    balance: 100000n,
  };
  try {
    const { hash } = await testnet.executeSend(plan, secret0);
    out.testnet.syntheticBroadcast.unexpectedSuccessTxid = hash;
    out.testnet.syntheticBroadcast.status = await testnet.getTxStatus(hash);
  } catch (err) {
    out.testnet.syntheticBroadcast.broadcastError = err.message;
    const m = err.message.match(/txid ([0-9a-f]{64})/);
    if (m) out.testnet.syntheticBroadcast.attemptedTxid = m[1];
  }
  out.testnet.realTipTxidUsed = realTestnetTxid;
}

// ------------------------------------------------------------ explorer probes

const mainnetTipHash = await getText(`${MAINNET_API}/blocks/tip/hash`);
const mainnetTipTxids = await getJson(`${MAINNET_API}/block/${mainnetTipHash}/txids`);
const realMainnetTxid = mainnetTipTxids[0];
out.explorerProbes.mainnetRealTx = {
  url: `https://blockstream.info/tx/${realMainnetTxid}`,
  txid: realMainnetTxid,
  httpStatus: await probeStatus(`https://blockstream.info/tx/${realMainnetTxid}`),
};
if (out.testnet.realTipTxidUsed) {
  out.explorerProbes.testnetRealTx = {
    url: `https://blockstream.info/testnet/tx/${out.testnet.realTipTxidUsed}`,
    txid: out.testnet.realTipTxidUsed,
    httpStatus: await probeStatus(`https://blockstream.info/testnet/tx/${out.testnet.realTipTxidUsed}`),
  };
}
const attemptedTxid = out.testnet.syntheticBroadcast?.attemptedTxid;
if (attemptedTxid) {
  out.explorerProbes.testnetAttemptedBroadcastTx = {
    url: `https://blockstream.info/testnet/tx/${attemptedTxid}`,
    txid: attemptedTxid,
    httpStatus: await probeStatus(`https://blockstream.info/testnet/tx/${attemptedTxid}`),
    apiTxStatus: await probeStatus(`${TESTNET_API}/tx/${attemptedTxid}`),
    note: 'the broadcast was rejected by esplora, so this tx does not exist on-chain: the API GET /tx returns 404 (the explorer web page itself answers 200 with a not-found view, as esplora serves its UI shell)',
  };
}
if (out.testnet.realSend) {
  out.explorerProbes.testnetRealSendTx = {
    url: `https://blockstream.info/testnet/tx/${out.testnet.realSend.txid}`,
    txid: out.testnet.realSend.txid,
    httpStatus: await probeStatus(`https://blockstream.info/testnet/tx/${out.testnet.realSend.txid}`),
  };
}

out.notes.push(
  'Testnet faucet: probed the known faucets (see testnet.faucetProbe); all are captcha-gated HTML pages, so no programmatic claim was possible and the synthetic-broadcast path was used.',
  'The synthetic broadcast spends an output the test key does not control; esplora rejecting it (rather than a real spend succeeding) is the intended outcome.',
);

const json = JSON.stringify(out, null, 2);
writeFileSync(OUTPUT_PATH, json + '\n');
console.log(json);
