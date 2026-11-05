// Focused devnet probe for the fixed Aptos engine (TypeTag::Struct
// variant 7). Funds A via the devnet faucet if needed, sends
// A -> B 100000 octas through the engine, polls to success, and
// writes aptos-devnet-probe-output.json.
import { writeFile } from 'node:fs/promises';
import { createAptosClient, deriveAddress } from '../../src/core/chains/aptos.mjs';
import { deriveAccountSecret } from '../../src/core/hd.mjs';

const DEVNET_API = 'https://fullnode.devnet.aptoslabs.com/v1';
const DEVNET_FAUCET = 'https://faucet.devnet.aptoslabs.com/fund';
const master = new Uint8Array(32).fill(0x42);
const secretA = deriveAccountSecret(master, 'aptos', 0);
const secretB = deriveAccountSecret(master, 'aptos', 1);
const A = deriveAddress(secretA, 'testnet');
const B = deriveAddress(secretB, 'testnet');
const out = { generatedAt: new Date().toISOString(), A, B, api: DEVNET_API };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const client = createAptosClient(DEVNET_API);
  out.chainId = await client.getChainId();
  out.balanceABefore = (await client.getBalance(A)).toString();
  if (BigInt(out.balanceABefore) < 200000n) {
    const res = await fetch(DEVNET_FAUCET, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: A, amount: 100000000 }),
      signal: AbortSignal.timeout(60000),
    });
    out.faucet = { httpStatus: res.status, body: (await res.text()).slice(0, 300) };
    for (let i = 0; i < 20; i++) {
      await sleep(3000);
      const b = await client.getBalance(A);
      if (b >= 200000n) { out.balanceAAfterFunding = b.toString(); break; }
    }
  }
  out.balanceBBefore = (await client.getBalance(B)).toString();
  const plan = await client.prepareSend({ from: A, to: B, amount: 100000n });
  out.plan = { ...plan, amount: plan.amount.toString(), fee: plan.fee.toString(), balance: plan.balance.toString(), sequence: plan.sequence.toString() };
  const { hash } = await client.executeSend(plan, secretA);
  out.txHash = hash;
  let status = 'pending';
  for (let i = 0; i < 30 && status === 'pending'; i++) {
    await sleep(3000);
    status = await client.getTxStatus(hash);
  }
  out.txStatus = status;
  out.balanceAAfter = (await client.getBalance(A)).toString();
  out.balanceBAfter = (await client.getBalance(B)).toString();
  out.ok = status === 'success' && BigInt(out.balanceBAfter) - BigInt(out.balanceBBefore) === 100000n;
} catch (e) {
  out.error = String(e?.stack ?? e);
  out.ok = false;
}
await writeFile(new URL('./aptos-devnet-probe-output.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
