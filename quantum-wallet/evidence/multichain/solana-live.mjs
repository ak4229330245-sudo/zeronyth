// Live proof for the Solana engine against Solana DEVNET only.
//
//   node evidence/multichain/solana-live.mjs
//
// Derives two accounts from the public test-fixture master seed
// (32 bytes of 0x42) via hd.mjs, tries to airdrop 1 SOL to account 0
// (devnet faucet rate-limits aggressively — retried, and failure is
// recorded, not fatal), sends 100000 lamports 0 → 1 through the
// engine client when funded, and records real balance reads either
// way. Output: evidence/multichain/solana-live-output.json.
//
// No mainnet, no real funds, no secrets printed (the 0x42 master is a
// public test fixture; derived secrets never leave the process).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveAccountSecret, deriveAccountAddress } from '../../src/core/hd.mjs';
import { createSolanaClient } from '../../src/core/chains/solana.mjs';

const API = 'https://api.devnet.solana.com';
const AIRDROP_LAMPORTS = 1_000_000_000; // 1 SOL
const SEND_LAMPORTS = 100000n; // 0.0001 SOL
const OUT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'solana-live-output.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rawRpc(method, params) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await res.text();
  let j = null;
  try {
    j = JSON.parse(text);
  } catch {
    /* non-JSON error body (e.g. faucet 429 page) */
  }
  if (!res.ok) throw Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  if (j?.error) throw Error(`RPC ${j.error.code}: ${j.error.message}`);
  return j?.result;
}

async function main() {
  const notes = [];
  const master = new Uint8Array(32).fill(0x42); // public test fixture
  const secret0 = deriveAccountSecret(master, 'solana', 0);
  const from = deriveAccountAddress(master, 'solana', 0);
  const to = deriveAccountAddress(master, 'solana', 1);
  const client = createSolanaClient(API);

  const connected = await client.checkConnection();
  notes.push(`checkConnection(devnet): ${connected}`);

  let balFromBefore = 0n;
  let balToBefore = 0n;
  try {
    balFromBefore = await client.getBalance(from);
    balToBefore = await client.getBalance(to);
  } catch (e) {
    notes.push(`initial balance read failed: ${e.message}`);
  }
  notes.push(`balances before: from=${balFromBefore} to=${balToBefore} lamports`);

  // --- airdrop (retry: devnet faucet rate-limits per IP / per wallet)
  let airdropSignature = null;
  let airdropError = null;
  if (balFromBefore < SEND_LAMPORTS + 5000n) {
    for (let attempt = 1; attempt <= 6 && !airdropSignature; attempt++) {
      try {
        airdropSignature = await rawRpc('requestAirdrop', [from, AIRDROP_LAMPORTS]);
        notes.push(`airdrop attempt ${attempt}: ok, signature ${airdropSignature}`);
      } catch (e) {
        airdropError = e.message;
        notes.push(`airdrop attempt ${attempt}: failed (${e.message})`);
        if (attempt < 6) await sleep(5000 * attempt);
      }
    }
    if (airdropSignature) {
      // Wait for the airdrop to land.
      for (let i = 0; i < 10; i++) {
        await sleep(3000);
        try {
          balFromBefore = await client.getBalance(from);
        } catch {
          /* keep polling */
        }
        if (balFromBefore >= SEND_LAMPORTS + 5000n) break;
      }
      notes.push(`balance after airdrop wait: from=${balFromBefore} lamports`);
    } else {
      notes.push(
        `AIRDROP BLOCKER: all 6 requestAirdrop attempts failed (last error: ${airdropError}). ` +
          'Devnet faucet is rate-limited; falling back to balance reads only, no send attempted.',
      );
    }
  } else {
    notes.push('account 0 already funded; airdrop skipped');
  }

  // --- send through the engine client, when funded
  let sendSignature = null;
  let sendStatus = null;
  if (balFromBefore >= SEND_LAMPORTS + 5000n) {
    try {
      const plan = await client.prepareSend({ from, to, amount: SEND_LAMPORTS });
      notes.push(
        `prepareSend: balance=${plan.balance} fee=${plan.fee} blockhash=${plan.blockhash} ` +
          `lastValidBlockHeight=${plan.lastValidBlockHeight}`,
      );
      const { hash } = await client.executeSend(plan, secret0);
      sendSignature = hash;
      notes.push(`sendTransaction: signature ${hash}`);
      const deadline = Date.now() + 90000;
      sendStatus = 'pending';
      while (Date.now() < deadline) {
        sendStatus = await client.getTxStatus(hash);
        if (sendStatus === 'success' || sendStatus === 'failed') break;
        await sleep(3000);
      }
      notes.push(`getTxStatus(${hash}): ${sendStatus}`);
    } catch (e) {
      notes.push(`send failed: ${e.message}`);
      sendStatus = 'failed';
    }
  }

  let balFromAfter = balFromBefore;
  let balToAfter = balToBefore;
  try {
    balFromAfter = await client.getBalance(from);
    balToAfter = await client.getBalance(to);
  } catch (e) {
    notes.push(`final balance read failed: ${e.message}`);
  }

  // --- explorer pattern probe (solscan devnet)
  const probeSignature = sendSignature ?? airdropSignature;
  let explorerProbe = { url: null, status: null };
  if (probeSignature) {
    const url = `https://solscan.io/tx/${probeSignature}?cluster=devnet`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) solana-live-probe' },
        redirect: 'follow',
      });
      await res.text();
      explorerProbe = { url, status: res.status };
    } catch (e) {
      explorerProbe = { url, status: null, error: e.message };
    }
    notes.push(`explorer probe ${url}: HTTP ${explorerProbe.status ?? explorerProbe.error}`);
  } else {
    notes.push('explorer probe skipped: no signature available (airdrop blocked)');
  }

  const status = sendSignature
    ? sendStatus === 'success'
      ? 'success'
      : `send_${sendStatus ?? 'unknown'}`
    : airdropSignature
      ? 'funded_no_send'
      : 'airdrop_failed';

  const output = {
    network: 'devnet',
    api: API,
    from,
    to,
    airdropSignature,
    sendSignature,
    sendAmountLamports: SEND_LAMPORTS.toString(),
    balances: {
      fromBefore: balFromBefore.toString(),
      toBefore: balToBefore.toString(),
      fromAfter: balFromAfter.toString(),
      toAfter: balToAfter.toString(),
    },
    status,
    explorerProbe,
    notes,
  };
  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
}

main().catch((e) => {
  console.error(`solana-live: fatal: ${e.message}`);
  process.exitCode = 1;
});
