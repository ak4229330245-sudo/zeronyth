// Deploy the ZERONYTH testnet AMM on chain 9127 from the economy "deployer" role, driven by tokens.json (single token list).
// Test tokens only (no monetary value). Native pools (ZNYT/zX) use ZnytAmmRouter (plain ZNYT in/out, wraps to WZNYT);
// token pools (zX/zY) use ZnytTokenRouter (SwapLabRouter + output-side fix). Each pair is a SwapLabPair (Uniswap-V2 pattern, 0.30% fee).
// Idempotent: only tokens/pools missing from deployments/main-amm.json are deployed. Keys are never printed.
import { createRequire } from 'node:module'; import { readFileSync, writeFileSync, existsSync } from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const econ = path.join(here, '../../economy');
const { ethers } = createRequire(path.join(here, '../package.json'))('ethers');
const { QueuedSigner } = await import(existsSync(path.join(econ, 'lib/signer-queue.mjs')) ? path.join(econ, 'lib/signer-queue.mjs') : path.join(here, '../lib/signer-queue.mjs'));
const MAN = process.env.ZERONYTH_AMM_MANIFEST || path.join(here, '../../deployments/main-amm.json');
const CFG = JSON.parse(readFileSync(path.join(here, 'tokens.json'), 'utf8'));
const provider = new ethers.JsonRpcProvider(process.env.ZERONYTH_RPC || 'http://127.0.0.1:9545', 9127, { staticNetwork: true });
const keys = JSON.parse(readFileSync(path.join(econ, '.secrets/main-keys.json'), 'utf8'));
const wallet = new ethers.Wallet(typeof keys.deployer === 'string' ? keys.deployer : keys.deployer.privateKey, provider);
const signer = new QueuedSigner(wallet, { chainId: 9127 }); const me = await signer.getAddress();
const art = (n) => JSON.parse(readFileSync(path.join(here, 'build', n + '.json'), 'utf8'));
const ov = { gasPrice: 1_000_000_000n, type: 0 }; const dl = () => Math.floor(Date.now() / 1000) + 600;
let m = existsSync(MAN) ? JSON.parse(readFileSync(MAN, 'utf8')) : {};
const save = () => { m.updatedAt = new Date().toISOString(); writeFileSync(MAN, JSON.stringify(m, null, 2) + '\n'); };
async function deploy(n, ...a) { const { abi, bytecode } = art(n); const c = await new ethers.ContractFactory(abi, bytecode, signer).deploy(...a, { ...ov, gasLimit: 3_000_000n }); const r = await c.deploymentTransaction().wait(); console.log(n, typeof a[1] === 'string' ? a[1] : '', await c.getAddress(), r.hash); return [c, r]; }
console.log('deployer', me, ethers.formatEther(await provider.getBalance(me)), 'ZNYT');
// --- migrate older manifest shapes (v1 tUSD single pool -> retired; v2 pools[{symbol}] -> tokens + pools[{id}])
if (m.tusd && !m.pools) {
  const pair = new ethers.Contract(m.pair, art('SwapLabPair').abi, signer), router = new ethers.Contract(m.router, art('ZnytAmmRouter').abi, signer); const lp = await pair.balanceOf(me);
  let tx = null; if (lp > 0n) { await (await pair.approve(m.router, lp, { ...ov, gasLimit: 100_000n })).wait(); const t = await router.removeLiquidity(lp, 0n, 0n, dl(), { ...ov, gasLimit: 400_000n }); await t.wait(); tx = t.hash; }
  m = { wznyt: m.wznyt, startBlock: m.startBlock, pools: [], retired: [{ symbol: 'tUSD', token: m.tusd, pair: m.pair, router: m.router, reason: 'renamed to z-prefixed test tokens; seed withdrawn', withdrawTx: tx }] };
}
m.tokens ||= {}; m.pools ||= []; m.retired ||= [];
for (const p of m.pools) if (p.symbol && !p.id) { m.tokens[p.symbol] = { symbol: p.symbol, name: p.name, address: p.token, decimals: 18, claimPerDay: p.claimPerDay, tx: p.tokenTx, note: 'deployed with the first ZTestToken build (decimals fixed at 18)' };
  Object.assign(p, { id: `ZNYT/${p.symbol}`, kind: 'native', a: 'ZNYT', b: p.symbol, seed: { a: p.seed.znyt, b: p.seed.token, tx: p.seed.tx } }); for (const k of ['symbol', 'name', 'token', 'claimPerDay', 'tokenTx']) delete p[k]; }
// v3 -> v4: token pools first deployed with SwapLabRouter, whose swapExactInput requested the input token as output
// (every token->token swap reverted). Pairs are bound to their router for good, so withdraw the deployer's seed via the
// old router (removeLiquidity is correct there), retire the pool, and let the loop below redeploy it with ZnytTokenRouter.
for (const p of [...m.pools]) if (p.kind === 'token' && p.routerContract !== 'ZnytTokenRouter') {
  const pair = new ethers.Contract(p.pair, art('SwapLabPair').abi, signer), router = new ethers.Contract(p.router, art('SwapLabRouter').abi, signer); const lp = await pair.balanceOf(me);
  let tx = null; if (lp > 0n) { await (await pair.approve(p.router, lp, { ...ov, gasLimit: 100_000n })).wait(); const t = await router.removeLiquidity(lp, 0n, 0n, dl(), { ...ov, gasLimit: 400_000n }); await t.wait(); tx = t.hash; }
  m.retired.push({ id: p.id, pair: p.pair, router: p.router, routerContract: 'SwapLabRouter', reason: 'SwapLabRouter swap bug (token->token swaps reverted); redeployed with ZnytTokenRouter; seed withdrawn', withdrawTx: tx });
  m.pools.splice(m.pools.indexOf(p), 1); console.log('retired', p.id, 'withdraw', tx); save();
}
for (const p of m.pools) if (p.kind === 'native') p.routerContract ||= 'ZnytAmmRouter';
Object.assign(m, { chainId: 9127, deployer: me, label: 'ZERONYTH public testnet AMM — z-prefixed test tokens only, NO monetary value, not redeemable',
  source: 'services/zeronyth-l1/points/amm/ZnytAmm.sol (WZNYT, ZTestToken, ZnytAmmRouter) + points/amm/ZnytTokenRouter.sol (token/token router) + experiments/swap-lab/SwapLab.sol (SwapLabPair); token list: points/amm/tokens.json' });
if (!m.wznyt) { const [w, r] = await deploy('WZNYT'); m.wznyt = await w.getAddress(); m.startBlock = r.blockNumber; } save();
// real-price tokens: fetch USD price now and resolve 'auto' seeds (value-matched to the other side)
async function usdPrice(src) {
  if (src.fixedUsd) return { usd: Number(src.fixedUsd), source: 'peg' };
  try { const j = await (await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${src.coingecko}&vs_currencies=usd`, { signal: AbortSignal.timeout(10000) })).json(); const p = Number(j[src.coingecko]?.usd); if (p > 0) return { usd: p, source: 'coingecko' }; } catch {}
  return fallbackUsd(src);
}
async function fallbackUsd(src) { // exchange spot fallback when CoinGecko fails: Binance (src.binance) or Coinbase (src.coinbase)
  if (src.binance) { const j = await (await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${src.binance}`, { signal: AbortSignal.timeout(10000) })).json(); const p = Number(j.price); if (p > 0) return { usd: p, source: 'binance' }; }
  if (src.coinbase) { const j = await (await fetch(`https://api.coinbase.com/v2/prices/${src.coinbase}/spot`, { signal: AbortSignal.timeout(10000) })).json(); const p = Number(j.data?.amount); if (p > 0) return { usd: p, source: 'coinbase' }; }
  throw new Error('no price for ' + JSON.stringify(src));
}
const ZUSD = Number(CFG.znytUsdTest || 10);
for (const t of CFG.tokens) if (t.priceSource) { const p = await usdPrice(t.priceSource); t.testPriceZnyt = p.usd / ZUSD; t.seedPrice = { ...p, at: new Date().toISOString() }; console.log(t.symbol, 'USD', p.usd, p.source); }
const pxZ = (sym) => sym === 'ZNYT' ? 1 : Number(CFG.tokens.find((t) => t.symbol === sym).testPriceZnyt);
const fix = (sym, x) => x.toFixed(sym === 'ZNYT' ? 18 : Math.min(8, CFG.tokens.find((t) => t.symbol === sym).decimals));
for (const p of CFG.pools) { if (p.seedB === 'auto') p.seedB = fix(p.b, Number(p.seedA) * pxZ(p.a) / pxZ(p.b)); if (p.seedA === 'auto') p.seedA = fix(p.a, Number(p.seedB) * pxZ(p.b) / pxZ(p.a)); }
const KEEPER = process.env.ZERONYTH_AMM_KEEPER || null; // keeper wallet address (receives keeperInventory)
const units = (sym, x) => ethers.parseUnits(String(x), sym === 'ZNYT' ? 18 : CFG.tokens.find((t) => t.symbol === sym).decimals);
// --- tokens: initial mint = the deployer's seed amounts for that token's pools
for (const t of CFG.tokens) {
  if (m.tokens[t.symbol]) continue;
  const seed = CFG.pools.filter((p) => !m.pools.some((x) => x.id === `${p.a}/${p.b}`)).reduce((s, p) => s + (p.a === t.symbol ? units(t.symbol, p.seedA) : 0n) + (p.b === t.symbol ? units(t.symbol, p.seedB) : 0n), 0n);
  const inv = KEEPER && t.keeperInventory ? units(t.symbol, t.keeperInventory) : 0n;
  const [c, r] = await deploy('ZTestToken', `${t.name} (testnet, no value)`, t.symbol, t.decimals, units(t.symbol, t.claimPerDay), 86400, seed + inv);
  m.tokens[t.symbol] = { symbol: t.symbol, name: t.name, address: await c.getAddress(), decimals: t.decimals, claimPerDay: t.claimPerDay, tx: r.hash };
  if (inv) { const x = await c.transfer(KEEPER, inv, { ...ov, gasLimit: 100_000n }); await x.wait(); m.tokens[t.symbol].keeperInventory = { to: KEEPER, amount: t.keeperInventory, tx: x.hash }; } save();
}
for (const t of CFG.tokens) Object.assign(m.tokens[t.symbol], { testPriceZnyt: t.testPriceZnyt, decimals: m.tokens[t.symbol].decimals ?? t.decimals, ...(t.priceSource ? { priceSource: t.priceSource, ...(m.tokens[t.symbol].seedPrice ? {} : { seedPrice: t.seedPrice }) } : {}) });
for (const P of CFG.pools) { const x = m.pools.find((p) => p.id === `${P.a}/${P.b}`); if (x && P.note) x.note = P.note; }
m.znytUsdTest = ZUSD; if (KEEPER) m.keeper = KEEPER;
// --- pools
const tok = (sym) => new ethers.Contract(m.tokens[sym].address, art('ZTestToken').abi, signer);
for (const P of CFG.pools) {
  const id = `${P.a}/${P.b}`; if (m.pools.some((x) => x.id === id)) continue;
  const native = P.a === 'ZNYT', A = native ? m.wznyt : m.tokens[P.a].address, B = m.tokens[P.b].address;
  const [pair] = await deploy('SwapLabPair', A, B); let router;
  if (native) { [router] = await deploy('ZnytAmmRouter', m.wznyt, B, await pair.getAddress()); await (await pair.setRouter(await router.getAddress(), { ...ov, gasLimit: 100_000n })).wait(); }
  else { // ZnytTokenRouter's (= SwapLabRouter's) constructor requires pair.router() == itself: set the predicted CREATE address first (deployer-only, one-shot)
    const n = await provider.getTransactionCount(me, 'pending'); const predicted = ethers.getCreateAddress({ from: me, nonce: n + 1 });
    await (await pair.setRouter(predicted, { ...ov, gasLimit: 100_000n })).wait();
    [router] = await deploy('ZnytTokenRouter', A, B, await pair.getAddress()); if (lc(await router.getAddress()) !== lc(predicted)) throw new Error(`router address mismatch for ${id}; pair ${await pair.getAddress()} is unusable`); }
  const R = await router.getAddress(); let add;
  for (const [sym, amt] of [[P.a, P.seedA], [P.b, P.seedB]]) if (sym !== 'ZNYT' && (await tok(sym).balanceOf(me)) < units(sym, amt)) { console.log('claiming', sym, 'from its faucet for seeding'); await (await tok(sym).claim({ ...ov, gasLimit: 120_000n })).wait();
    if ((await tok(sym).balanceOf(me)) < units(sym, amt)) throw new Error(`deployer lacks ${sym} for ${id}`); }
  await (await tok(P.b).approve(R, units(P.b, P.seedB), { ...ov, gasLimit: 100_000n })).wait();
  if (native) add = await router.addLiquidity(units(P.b, P.seedB), 0n, 0n, dl(), { ...ov, value: units('ZNYT', P.seedA), gasLimit: 600_000n });
  else { await (await tok(P.a).approve(R, units(P.a, P.seedA), { ...ov, gasLimit: 100_000n })).wait(); add = await router.addLiquidity(units(P.a, P.seedA), units(P.b, P.seedB), 0n, dl(), { ...ov, gasLimit: 600_000n }); }
  await add.wait();
  m.pools.push({ id, kind: native ? 'native' : 'token', a: P.a, b: P.b, pair: await pair.getAddress(), router: R, routerContract: native ? 'ZnytAmmRouter' : 'ZnytTokenRouter', token0: await pair.token0(), token1: await pair.token1(), note: P.note, seed: { a: P.seedA, b: P.seedB, tx: add.hash } }); save();
  console.log('pool', id, 'seeded', add.hash);
}
function lc(x) { return String(x).toLowerCase(); }
save(); console.log(JSON.stringify(m, null, 2)); console.log('deployer left', ethers.formatEther(await provider.getBalance(me)), 'ZNYT');
