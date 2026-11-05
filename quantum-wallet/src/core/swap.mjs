// ZERONYTH AMM swap core (in-wallet swap, chain 912701).
//
// Ported from the proven AMM page transport (~/workspace/amm-pq/amm-pq.mjs),
// which executed live swaps on production in all three schemes. The math,
// selectors and call shapes here are byte-identical to that module:
//   quote:  amountOut(a, rIn, rOut) = (a·997·rOut) / (rIn·1000 + a·997)
//           (SwapLabPair 0.30% fee, reserves read FRESH via getReserves)
//   buy:    ZNYT → token: router.swapExactZnytForToken(minOut, deadline),
//           payable with value = amountIn (the router wraps ZNYT itself)
//   sell:   token → ZNYT: approve(router, MAX) when allowance < amountIn,
//           then router.swapExactTokenForZnyt(amountIn, minOut, deadline)
// Gas is NOT decided here — sends go through the session's normal
// prepareSend path (node estimate + scheme surcharge, gas.mjs policy),
// exactly as the page transport did.
//
// Scope: native pools only (kind "native", ZnytAmmRouter). Token↔token
// pools (ZnytTokenRouter) are deliberately not wired into the wallet.

export const AMM_SELECTORS = Object.freeze({
  balanceOf: '0x70a08231',
  allowance: '0xdd62ed3e',
  approve: '0x095ea7b3',
  getReserves: '0x0902f1ac',
  swapExactZnytForToken: '0x61e5c3d8',
  swapExactTokenForZnyt: '0xd4fe6995',
});

export const MAX_UINT256 = (1n << 256n) - 1n;
export const DEFAULT_SLIPPAGE_BPS = 100; // 1%

/** ABI word encoder: address (string) or uint (bigint) → 64 hex chars. */
export function ammWord(x) {
  return typeof x === 'string'
    ? x.toLowerCase().replace(/^0x/, '').padStart(64, '0')
    : BigInt(x).toString(16).padStart(64, '0');
}

export function ammEncodeCall(selector, ...args) {
  return selector + args.map(ammWord).join('');
}

/** Decode an eth_call result into its 32-byte words (bigint[]). */
export function ammWordsOf(hex) {
  return typeof hex === 'string' && hex.length > 2
    ? (hex.slice(2).match(/.{64}/g)?.map((x) => BigInt('0x' + x)) ?? [])
    : [];
}

/** Constant-product quote with the pair's 0.30% fee (identical to amm-pq). */
export function ammAmountOut(amountIn, reserveIn, reserveOut) {
  const a = BigInt(amountIn);
  const rIn = BigInt(reserveIn);
  const rOut = BigInt(reserveOut);
  return a > 0n && rIn > 0n && rOut > 0n ? (a * 997n * rOut) / (rIn * 1000n + a * 997n) : 0n;
}

/** Minimum received after slippage tolerance (bps), floor division. */
export function ammMinOut(amountOut, slippageBps = DEFAULT_SLIPPAGE_BPS) {
  const bps = BigInt(slippageBps);
  if (bps < 0n || bps > 5000n) throw Error('slippage out of range');
  return (BigInt(amountOut) * (10000n - bps)) / 10000n;
}

/** Token descriptor for a manifest symbol; ZNYT is the native coin. */
export function ammTokenOf(manifest, symbol) {
  if (symbol === 'ZNYT') {
    return { symbol: 'ZNYT', decimals: 18, address: manifest.wznyt, native: true };
  }
  const t = manifest.tokens?.[symbol];
  if (!t) throw Error(`Unknown AMM token: ${symbol}`);
  return { symbol: t.symbol ?? symbol, decimals: t.decimals, address: t.address, native: false };
}

/** Native pools from the manifest (the only pools the wallet swaps on). */
export function ammNativePools(manifest) {
  return (manifest?.pools ?? []).filter((p) => p.kind === 'native');
}

/**
 * Reserves of a native pool in (a, b) order — the pair stores token0 /
 * token1 order, the manifest's a/b is the human order; amm-pq resolved
 * the mapping by comparing token0 against token a's address.
 */
export async function ammFetchReserves(client, manifest, pool) {
  const words = ammWordsOf(await client.ethCall({ to: pool.pair, data: AMM_SELECTORS.getReserves }));
  if (words.length < 2) throw Error('Pool reserves unavailable');
  const aIs0 = ammTokenOf(manifest, pool.a).address.toLowerCase() === pool.token0.toLowerCase();
  return aIs0
    ? { reserveA: words[0], reserveB: words[1] }
    : { reserveA: words[1], reserveB: words[0] };
}

/** Balance of a manifest symbol for an address (native → eth_getBalance). */
export async function ammBalanceOf(client, manifest, symbol, address) {
  if (symbol === 'ZNYT') return client.getBalance(address);
  const token = ammTokenOf(manifest, symbol);
  const words = ammWordsOf(
    await client.ethCall({ to: token.address, data: ammEncodeCall(AMM_SELECTORS.balanceOf, address) }),
  );
  return words[0] ?? 0n;
}

/** ERC-20 allowance of a manifest token toward a spender. */
export async function ammAllowanceOf(client, manifest, symbol, owner, spender) {
  const token = ammTokenOf(manifest, symbol);
  const words = ammWordsOf(
    await client.ethCall({
      to: token.address,
      data: ammEncodeCall(AMM_SELECTORS.allowance, owner, spender),
    }),
  );
  return words[0] ?? 0n;
}

/**
 * Full quote for a swap against FRESH reserves.
 * direction: 'buy' = ZNYT → pool.b; 'sell' = pool.b → ZNYT.
 * Returns { pool, direction, sellSymbol, buySymbol, amountIn, amountOut,
 *           minOut, reserveIn, reserveOut }.
 */
export async function ammQuote(client, manifest, { poolId, direction, amountIn, slippageBps = DEFAULT_SLIPPAGE_BPS }) {
  const pool = ammNativePools(manifest).find((p) => p.id === poolId);
  if (!pool) throw Error(`Pool not found: ${poolId}`);
  if (direction !== 'buy' && direction !== 'sell') throw Error(`Invalid swap direction: ${direction}`);
  const amt = BigInt(amountIn);
  if (amt <= 0n) throw Error('Invalid amount');
  const { reserveA, reserveB } = await ammFetchReserves(client, manifest, pool);
  const [reserveIn, reserveOut] = direction === 'buy' ? [reserveA, reserveB] : [reserveB, reserveA];
  const amountOut = ammAmountOut(amt, reserveIn, reserveOut);
  const minOut = ammMinOut(amountOut, slippageBps);
  return {
    pool,
    direction,
    sellSymbol: direction === 'buy' ? 'ZNYT' : pool.b,
    buySymbol: direction === 'buy' ? pool.b : 'ZNYT',
    amountIn: amt,
    amountOut,
    minOut,
    reserveIn,
    reserveOut,
    slippageBps,
  };
}

/** The swap transaction call ({ to, data, value }) for a quote. */
export function ammSwapCall(quote, deadline) {
  const { pool, direction, amountIn, minOut } = quote;
  if (direction === 'buy') {
    return {
      to: pool.router,
      data: ammEncodeCall(AMM_SELECTORS.swapExactZnytForToken, minOut, BigInt(deadline)),
      value: amountIn,
    };
  }
  return {
    to: pool.router,
    data: ammEncodeCall(AMM_SELECTORS.swapExactTokenForZnyt, amountIn, minOut, BigInt(deadline)),
    value: 0n,
  };
}

/** The approve call needed before a sell when allowance is short. */
export function ammApproveCall(manifest, quote) {
  const token = ammTokenOf(manifest, quote.pool.b);
  return {
    to: token.address,
    data: ammEncodeCall(AMM_SELECTORS.approve, quote.pool.router, MAX_UINT256),
    value: 0n,
  };
}
