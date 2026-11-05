// Swap tests (v12): the constant-product quote math in src/core/swap.mjs
// is grid-compared against the LIVE page implementation it ports
// (assets/amm-pq.mjs, line-verbatim fixture below), plus slippage rules,
// calldata builders, and the session-level quote/prepare paths with a
// fake RPC + fake manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { memoryStorage } from '../src/core/storage.mjs';
import {
  ammAmountOut,
  ammMinOut,
  ammQuote,
  ammSwapCall,
  ammApproveCall,
  ammFetchReserves,
  AMM_SELECTORS,
  MAX_UINT256,
} from '../src/core/swap.mjs';
import { createSession } from '../src/app/session.mjs';
import { PASSWORD } from './fixtures.mjs';

// The exact quote function from the deployed AMM PQ page module
// (~/zeronyth-falcon-912701/site/dashboard/assets/amm-pq.mjs):
const ammPqAmountOut = (a, rIn, rOut) =>
  a > 0n && rIn > 0n && rOut > 0n ? (a * 997n * rOut) / (rIn * 1000n + a * 997n) : 0n;

const WZNYT = '0x3Faa5f9Fcc51C561c7bdE7D4c4E6AD3ea86B5B34';
const ZUSDT = '0x10000000000000000000000000000000000000aa';
const PAIR = '0x54973beCCe8a9DC7c57cA52673627EC0C64A7066';
const ROUTER = '0x447B3b3a3c5200B8292542fC05D31aC80FcCBE9B';

const MANIFEST = {
  wznyt: WZNYT,
  tokens: { zUSDT: { symbol: 'zUSDT', decimals: 18, address: ZUSDT } },
  pools: [
    {
      id: 'zny-zusdt',
      kind: 'native',
      a: 'ZNYT',
      b: 'zUSDT',
      pair: PAIR,
      token0: WZNYT,
      router: ROUTER,
    },
    { id: 'token-pool', kind: 'token', a: 'zUSDT', b: 'zUSDC', pair: PAIR, token0: ZUSDT, router: ROUTER },
  ],
};

const word = (n) => '0x' + n.toString(16).padStart(64, '0');
const words = (...ns) => '0x' + ns.map((n) => n.toString(16).padStart(64, '0')).join('');

function fakeAmmRpc({ reserveA = 1000000n, reserveB = 2000000n, allowance = 0n } = {}) {
  const calls = [];
  return {
    calls,
    async call(method) {
      if (method === 'eth_chainId') return '0xded3d';
      throw Error(`unexpected ${method}`);
    },
    async ethCall({ to, data }) {
      calls.push({ to, data });
      if (data === AMM_SELECTORS.getReserves) return words(reserveA, reserveB, 0n);
      if (data.startsWith('0xdd62ed3e')) return word(allowance); // allowance
      if (data.startsWith('0x70a08231')) return word(0n); // balanceOf
      throw Error(`unexpected eth_call ${data}`);
    },
    async getBalance() {
      return 10n ** 20n;
    },
    async getTransactionCount() {
      return 0;
    },
    async gasPrice() {
      return 1000000000n;
    },
    async estimateGas() {
      return 100000n;
    },
  };
}

// ------------------------------------------------------------- quote math

test('quote math: identical to the live amm-pq implementation across a grid', () => {
  const amounts = [0n, 1n, 7n, 1000n, 123456789n, 10n ** 18n, 10n ** 24n];
  const reserves = [
    [0n, 1000n],
    [1000n, 0n],
    [1000000n, 2000000n],
    [999983n, 123457n],
    [10n ** 24n, 10n ** 18n],
    [546n, 546n],
  ];
  for (const a of amounts) {
    for (const [rIn, rOut] of reserves) {
      assert.equal(ammAmountOut(a, rIn, rOut), ammPqAmountOut(a, rIn, rOut), `a=${a} rIn=${rIn} rOut=${rOut}`);
    }
  }
  // one hand-checked anchor: 1000 into (1,000,000 / 2,000,000)
  assert.equal(ammAmountOut(1000n, 1000000n, 2000000n), 1992n);
  assert.equal(ammAmountOut(0n, 1000000n, 2000000n), 0n);
});

test('min-out: floor division at bps, zero tolerance is identity, range enforced', () => {
  assert.equal(ammMinOut(1992n, 100), 1972n);
  assert.equal(ammMinOut(1992n, 0), 1992n);
  assert.equal(ammMinOut(100n, 5000), 50n);
  assert.throws(() => ammMinOut(100n, 5001), /slippage/);
  assert.throws(() => ammMinOut(100n, -1), /slippage/);
});

test('reserves: token0 ordering resolves manifest a/b order both ways', async () => {
  const client = fakeAmmRpc({ reserveA: 111n, reserveB: 222n });
  const poolA = MANIFEST.pools[0];
  assert.deepEqual(await ammFetchReserves(client, MANIFEST, poolA), { reserveA: 111n, reserveB: 222n });
  const flipped = { ...poolA, token0: ZUSDT };
  assert.deepEqual(await ammFetchReserves(client, MANIFEST, flipped), { reserveA: 222n, reserveB: 111n });
});

test('quote: buy uses (reserveA,reserveB), sell flips; non-native pools invisible', async () => {
  const client = fakeAmmRpc({});
  const buy = await ammQuote(client, MANIFEST, { poolId: 'zny-zusdt', direction: 'buy', amountIn: 1000n });
  assert.equal(buy.amountOut, 1992n);
  assert.equal(buy.minOut, 1972n);
  assert.equal(buy.sellSymbol, 'ZNYT');
  assert.equal(buy.buySymbol, 'zUSDT');
  const sell = await ammQuote(client, MANIFEST, { poolId: 'zny-zusdt', direction: 'sell', amountIn: 1000n });
  assert.equal(sell.amountOut, ammPqAmountOut(1000n, 2000000n, 1000000n));
  assert.equal(sell.sellSymbol, 'zUSDT');
  await assert.rejects(
    () => ammQuote(client, MANIFEST, { poolId: 'token-pool', direction: 'buy', amountIn: 1n }),
    /Pool not found/,
  );
  await assert.rejects(
    () => ammQuote(client, MANIFEST, { poolId: 'zny-zusdt', direction: 'sideways', amountIn: 1n }),
    /direction/,
  );
});

test('calldata: swap/approve builders carry quote values and the right targets', () => {
  const quote = {
    pool: MANIFEST.pools[0],
    direction: 'sell',
    amountIn: 500n,
    amountOut: 900n,
    minOut: 891n,
  };
  const swap = ammSwapCall(quote, 1700000000);
  assert.equal(swap.to, ROUTER);
  assert.equal(swap.value, 0n);
  assert.ok(swap.data.startsWith(AMM_SELECTORS.swapExactTokenForZnyt));
  const approve = ammApproveCall(MANIFEST, quote);
  assert.equal(approve.to, ZUSDT);
  assert.ok(approve.data.startsWith(AMM_SELECTORS.approve));
  assert.ok(approve.data.endsWith(MAX_UINT256.toString(16).padStart(64, '0')));
  const buyQuote = { ...quote, direction: 'buy', amountIn: 700n };
  const buySwap = ammSwapCall(buyQuote, 1700000000);
  assert.equal(buySwap.value, 700n, 'buy pays native value with the call');
  assert.ok(buySwap.data.startsWith(AMM_SELECTORS.swapExactZnytForToken));
});

// ------------------------------------------------------------- session path

function makeSession(rpc, extra = {}) {
  return createSession({
    storage: memoryStorage(),
    rpcFactory: () => rpc,
    sleep: async () => {},
    manifestFetcher: async () => ({ amm: MANIFEST }),
    ...extra,
  });
}

test('session quoteSwap: quotes on ZERONYTH, refuses on other networks', async () => {
  const session = makeSession(fakeAmmRpc({}));
  const quote = await session.quoteSwap({ poolId: 'zny-zusdt', direction: 'buy', amountIn: 1000n });
  assert.equal(quote.amountOut, 1992n);
  session.setNetwork('base-sepolia');
  await assert.rejects(
    () => session.quoteSwap({ poolId: 'zny-zusdt', direction: 'buy', amountIn: 1000n }),
    /only available on ZERONYTH/,
  );
});

test('session prepareSwap: sell prepends an approve step when allowance is short', async () => {
  const session = makeSession(fakeAmmRpc({ allowance: 0n }));
  await session.create(PASSWORD, 'mldsa');
  const acct = session.state.accounts[0];
  const plan = await session.prepareSwap({
    accountId: acct.id,
    poolId: 'zny-zusdt',
    direction: 'sell',
    amountIn: 1000n,
  });
  assert.equal(plan.kind, 'swap');
  assert.equal(plan.scheme, 'mldsa');
  assert.deepEqual(plan.steps.map((s) => s.label), ['approve', 'swap']);
  // the approve step rides the normal ML-DSA send path (intrinsic + call gas)
  const approvePrepared = plan.steps[0].prepared;
  assert.equal(approvePrepared.chainId, 912701n);
  assert.equal(approvePrepared.txTo.toLowerCase(), ZUSDT.toLowerCase());
});

test('session sell: swap-step estimate may revert pre-approve; prepareSwap falls back, executeSwap orders approve→swap', async () => {
  // Stateful fake: the router call's estimateGas reverts with an
  // allowance error until an approve has actually been broadcast —
  // exactly what a real transferFrom-pulling router does.
  let allowance = 0n;
  const sent = [];
  const rpc = {
    async call(method) {
      if (method === 'eth_chainId') return '0xded3d';
      throw Error(`unexpected ${method}`);
    },
    async ethCall({ to, data }) {
      if (data === AMM_SELECTORS.getReserves) return words(1000000n, 2000000n, 0n);
      if (data.startsWith('0xdd62ed3e')) return word(allowance);
      if (data.startsWith('0x70a08231')) return word(10n ** 20n);
      throw Error(`unexpected eth_call ${data}`);
    },
    async getBalance() {
      return 10n ** 20n;
    },
    async getTransactionCount() {
      return sent.length;
    },
    async gasPrice() {
      return 1000000000n;
    },
    async estimateGas(tx) {
      if (tx.data?.startsWith(AMM_SELECTORS.swapExactTokenForZnyt) && allowance < 1000n) {
        throw Error('Execution reverted (allowance)');
      }
      return 120000n;
    },
    async sendRawTransaction(raw) {
      sent.push(raw);
      // The core signs opaque bytes; decode via the data we can see is
      // not possible here — the approve is the FIRST send in this flow.
      if (sent.length === 1) allowance = MAX_UINT256;
      return '0x' + sent.length.toString(16).padStart(64, '0');
    },
    async getTransactionReceipt() {
      return { status: '0x1' };
    },
  };
  const session = makeSession(rpc);
  await session.create(PASSWORD, 'mldsa');
  const acct = session.state.accounts[0];
  const plan = await session.prepareSwap({
    accountId: acct.id,
    poolId: 'zny-zusdt',
    direction: 'sell',
    amountIn: 1000n,
  });
  assert.deepEqual(plan.steps.map((s) => s.label), ['approve', 'swap']);
  assert.ok(plan.steps[1].prepared.gasLimit > 0n, 'swap step has a fallback-estimated gas limit');
  const { hashes } = await session.executeSwap(plan);
  assert.equal(hashes.length, 2, 'approve then swap were both broadcast');
  assert.equal(sent.length, 2);
});

test('session prepareSwap: sufficient allowance skips the approve step; buy never approves', async () => {
  const session = makeSession(fakeAmmRpc({ allowance: 10n ** 18n }));
  await session.create(PASSWORD, 'ecdsa');
  const acct = session.state.accounts[0];
  const sell = await session.prepareSwap({
    accountId: acct.id,
    poolId: 'zny-zusdt',
    direction: 'sell',
    amountIn: 1000n,
  });
  assert.deepEqual(sell.steps.map((s) => s.label), ['swap']);
  const buy = await session.prepareSwap({
    accountId: acct.id,
    poolId: 'zny-zusdt',
    direction: 'buy',
    amountIn: 1000n,
  });
  assert.deepEqual(buy.steps.map((s) => s.label), ['swap']);
  assert.equal(buy.steps[0].prepared.txValue, 1000n);
});
