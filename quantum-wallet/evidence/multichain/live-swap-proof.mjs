// Step 8 live proof: ONE tiny swap on PRODUCTION chain 912701 through
// the wallet code path (src/app/session.mjs prepareSwap/executeSwap),
// from a throwaway in-memory master wallet, ML-DSA account, 0.5 ZNYT
// into the ZNYT/zUSDT pool. Funding: the gateway zny_faucet (100 ZNYT
// test funds to the throwaway address). Writes live-swap-proof.json.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { memoryStorage } from '../../src/core/storage.mjs';
import { createSession } from '../../src/app/session.mjs';

const PASSWORD = 'throwaway-live-proof-01';
const out = { generatedAt: new Date().toISOString(), network: 'zeronyth-production-912701' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const session = createSession({
  storage: memoryStorage(),
  sleep,
  // In the browser this resolves against https://zeronyth.dpdns.org —
  // fetch the same production document directly here.
  manifestFetcher: async () =>
    (await (await fetch('https://zeronyth.dpdns.org/api/points/rules')).json()),
});
await session.beginPhraseCreate();
await session.createFromPhrase(PASSWORD);
const mldsa = session.state.accounts.find((a) => a.scheme === 'mldsa');
out.account = mldsa.address;

// Faucet-fund the throwaway ML-DSA address via the gateway (zny_faucet).
await session.faucet(mldsa.id);
let bal = 0n;
for (let i = 0; i < 40 && bal === 0n; i++) {
  await sleep(3000);
  const balances = await session.refreshBalances();
  bal = balances[mldsa.id] ?? 0n;
}
out.balanceAfterFaucet = bal.toString();
if (bal === 0n) throw Error('faucet funding did not arrive');

const manifest = await session.getSwapManifest();
const pool = manifest.pools.find((p) => p.kind === 'native' && p.b === 'zUSDT');
if (!pool) throw Error('no native zUSDT pool in production manifest');
out.pool = pool.id;
const quote0 = await session.quoteSwap({
  poolId: pool.id,
  direction: 'buy',
  amountIn: 500000000000000000n,
});
out.quote = {
  amountIn: quote0.amountIn.toString(),
  amountOut: quote0.amountOut.toString(),
  minOut: quote0.minOut.toString(),
  pool: quote0.pool.id,
};
const plan = await session.prepareSwap({
  accountId: mldsa.id,
  poolId: quote0.pool.id,
  direction: 'buy',
  amountIn: quote0.amountIn,
  slippageBps: 100,
});
const { hashes, quote } = await session.executeSwap(plan);
out.executed = { hashes, amountOut: quote.amountOut.toString() };
out.ok = hashes.length >= 1;
writeFileSync(fileURLToPath(new URL('./live-swap-proof.json', import.meta.url)), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
