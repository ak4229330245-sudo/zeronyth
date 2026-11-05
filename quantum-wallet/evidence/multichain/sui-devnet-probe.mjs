// Sui funded proof via DEVNET (testnet faucet is PoW-gated — see
// sui-live-output.json). Same engine code, devnet GraphQL endpoint.
// Funds idx0 via the devnet faucet, sends 1,000,000 MIST to idx1
// through the engine, verifies status + balances.
// Writes sui-devnet-probe-output.json. No secrets recorded.
import { writeFile } from 'node:fs/promises';
import { createSuiClient, deriveAddress } from '../../src/core/chains/sui.mjs';
import { deriveAccountSecret } from '../../src/core/hd.mjs';

const GQL = 'https://graphql.devnet.sui.io/graphql';
const FAUCET = 'https://faucet.devnet.sui.io/v2/gas';
const master = new Uint8Array(32).fill(0x42);
const secretA = deriveAccountSecret(master, 'sui', 0);
const secretB = deriveAccountSecret(master, 'sui', 1);
const A = deriveAddress(secretA, 'testnet');
const B = deriveAddress(secretB, 'testnet');
const out = { generatedAt: new Date().toISOString(), network: 'devnet', api: GQL, A, B };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const client = createSuiClient(GQL);
  out.connection = await client.checkConnection();
  out.balanceABefore = (await client.getBalance(A)).toString();
  if (BigInt(out.balanceABefore) < 2000000n) {
    const attempts = [];
    for (const body of [
      { FixedAmountRequest: { recipient: A } },
      { recipient: A },
    ]) {
      try {
        const res = await fetch(FAUCET, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
        });
        attempts.push({ shape: Object.keys(body)[0], httpStatus: res.status, body: (await res.text()).slice(0, 200) });
        if (res.ok) break;
      } catch (e) {
        attempts.push({ shape: Object.keys(body)[0], error: String(e?.message ?? e) });
      }
    }
    out.faucetAttempts = attempts;
    for (let i = 0; i < 20; i++) {
      await sleep(3000);
      const b = await client.getBalance(A);
      if (b >= 2000000n) { out.balanceAAfterFunding = b.toString(); break; }
    }
  }
  out.balanceBBefore = (await client.getBalance(B)).toString();
  const plan = await client.prepareSend({ from: A, to: B, amount: 1000000n });
  out.plan = { amount: plan.amount?.toString?.() ?? String(plan.amount), fee: plan.fee?.toString?.() ?? String(plan.fee ?? ''), gasBudget: String(plan.gasBudget ?? '') };
  const { hash } = await client.executeSend(plan, secretA);
  out.digest = hash;
  let status = 'pending';
  for (let i = 0; i < 30 && status === 'pending'; i++) {
    await sleep(3000);
    status = await client.getTxStatus(hash);
  }
  out.txStatus = status;
  out.balanceAAfter = (await client.getBalance(A)).toString();
  out.balanceBAfter = (await client.getBalance(B)).toString();
  out.ok = status === 'success' && BigInt(out.balanceBAfter) - BigInt(out.balanceBBefore) === 1000000n;
} catch (e) {
  out.error = String(e?.stack ?? e);
  out.ok = false;
}
await writeFile(new URL('./sui-devnet-probe-output.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
