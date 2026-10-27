// ZERONYTH testnet AMM price keeper. For every token in tokens.json with a "priceSource" (all z tokens: real ETH/BTC/SOL/BNB/MON USD; zUSDT/zUSDC pegged at 1 USD), fetch the real USD price
// (CoinGecko, fallback Binance) every keeper.intervalSec, publish it to deployments/main-amm-prices.json, and nudge each pool holding
// that token back toward the target with ONE small swap per pool per tick from the keeper wallet's own inventory
// (bounded by keeper.maxSwapPctOfReserve, skipped inside keeper.deadbandPct). ZNYT is converted at the labeled test rate znytUsdTest.
// Test tokens only, no monetary value. The keeper key (~/.zeronyth-secrets/amm-keeper-key.json) is never printed.
import { createRequire } from 'node:module'; import { readFileSync, writeFileSync, renameSync } from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { ethers } = createRequire(path.join(here, '../package.json'))('ethers');
const { QueuedSigner } = await import(path.join(here, '../lib/signer-queue.mjs'));
const MAN = process.env.ZERONYTH_AMM_MANIFEST || path.join(here, '../../deployments/main-amm.json');
const OUT = process.env.ZERONYTH_AMM_PRICES || path.join(path.dirname(MAN), 'main-amm-prices.json');
const ONCE = process.argv.includes('--once'), DRY = process.argv.includes('--dry-run');
const provider = new ethers.JsonRpcProvider(process.env.ZERONYTH_RPC || 'http://127.0.0.1:9545', 9127, { staticNetwork: true });
const key = JSON.parse(readFileSync(process.env.ZERONYTH_AMM_KEEPER_KEY || path.join(os.homedir(), '.zeronyth-secrets/amm-keeper-key.json'), 'utf8'));
const signer = new QueuedSigner(new ethers.Wallet(key.privateKey, provider), { chainId: 9127 }); const me = await signer.getAddress();
const ov = { gasPrice: 1_000_000_000n, type: 0 };
const ERC = ['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function claim()', 'function nextClaimAt(address) view returns (uint256)'];
const PAIR = ['function getReserves() view returns (uint112,uint112,uint32)'];
const NATIVE = ['function swapExactZnytForToken(uint256,uint256) payable returns (uint256)', 'function swapExactTokenForZnyt(uint256,uint256,uint256) returns (uint256)'];
const TOKR = ['function swapExactInput(address,uint256,uint256,address,uint256) returns (uint256)'];
const log = (...a) => console.log(new Date().toISOString(), ...a);
// one batched CoinGecko call per tick (fallback: Binance per symbol); {fixedUsd} = pegged test stablecoin
async function usdAll(list) {
  const out = {}, ids = [...new Set(list.filter((t) => t.priceSource.coingecko).map((t) => t.priceSource.coingecko))];
  let cg = {}; if (ids.length) try { cg = await (await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`, { signal: AbortSignal.timeout(10000) })).json(); } catch {}
  for (const t of list) { const src = t.priceSource;
    if (src.fixedUsd) { out[t.symbol] = { usd: Number(src.fixedUsd), source: 'peg' }; continue; }
    const p = Number(cg[src.coingecko]?.usd); if (p > 0) { out[t.symbol] = { usd: p, source: 'coingecko' }; continue; }
    try { out[t.symbol] = await fallbackUsd(src); } catch (e) { log('price unavailable, pools skipped this tick:', t.symbol, e.message); } } // one missing price never blocks the others
  return out;
}
async function fallbackUsd(src) { // exchange spot fallback when CoinGecko fails: Binance (src.binance) or Coinbase (src.coinbase)
  if (src.binance) { const j = await (await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${src.binance}`, { signal: AbortSignal.timeout(10000) })).json(); const p = Number(j.price); if (p > 0) return { usd: p, source: 'binance' }; }
  if (src.coinbase) { const j = await (await fetch(`https://api.coinbase.com/v2/prices/${src.coinbase}/spot`, { signal: AbortSignal.timeout(10000) })).json(); const p = Number(j.data?.amount); if (p > 0) return { usd: p, source: 'coinbase' }; }
  throw new Error('no price for ' + JSON.stringify(src));
}
async function tick() {
  const cfg = JSON.parse(readFileSync(path.join(here, 'tokens.json'), 'utf8')), K = cfg.keeper || {}, m = JSON.parse(readFileSync(MAN, 'utf8'));
  const ZUSD = Number(cfg.znytUsdTest || m.znytUsdTest || 10), out = { updatedAt: new Date().toISOString(), znytUsdTest: ZUSD, keeper: me, note: 'Real USD reference prices for price-tracked test tokens. Test tokens have NO monetary value.', tokens: {}, pools: {} };
  const pxZ = {}; for (const [s, t] of Object.entries(m.tokens)) pxZ[s] = Number(t.testPriceZnyt); pxZ.ZNYT = 1;
  const live = await usdAll(cfg.tokens.filter((x) => x.priceSource && m.tokens[x.symbol]));
  for (const [sym, p] of Object.entries(live)) { pxZ[sym] = p.usd / ZUSD; out.tokens[sym] = { usd: p.usd, znyt: p.usd / ZUSD, source: p.source }; }
  for (const pool of m.pools.filter((p) => out.tokens[p.a] || out.tokens[p.b])) {
    const dec = (s) => (s === 'ZNYT' ? 18 : m.tokens[s].decimals), addrOf = (s) => (s === 'ZNYT' ? m.wznyt : m.tokens[s].address);
    const [r0, r1] = await new ethers.Contract(pool.pair, PAIR, provider).getReserves(); const aIs0 = addrOf(pool.a).toLowerCase() === pool.token0.toLowerCase();
    const rA = Number(ethers.formatUnits(aIs0 ? r0 : r1, dec(pool.a))), rB = Number(ethers.formatUnits(aIs0 ? r1 : r0, dec(pool.b)));
    const price = rB / rA, target = pxZ[pool.a] / pxZ[pool.b], dev = (price / target - 1) * 100; // price = B per A
    const rec = out.pools[pool.id] = { pricePerA: price, targetPerA: target, deviationPct: Math.round(dev * 100) / 100, action: 'none' };
    if (Math.abs(dev) < (K.deadbandPct ?? 1.5)) continue;
    // constant product: to reach target, A reserve must become sqrt(k/target) -> sell A if price too high (B per A too high), else sell B
    const k = rA * rB, rA2 = Math.sqrt(k / target), sellA = rA2 > rA, cap = (K.maxSwapPctOfReserve ?? 10) / 100;
    const sym = sellA ? pool.a : pool.b; let amt = Math.min(sellA ? (rA2 - rA) / 0.997 : (Math.sqrt(k * target) - rB) / 0.997, (sellA ? rA : rB) * cap);
    const inv = sym === 'ZNYT' ? Number(ethers.formatEther(await provider.getBalance(me))) - (K.minZnytReserve ?? 0.2) : Number(ethers.formatUnits(await new ethers.Contract(addrOf(sym), ERC, provider).balanceOf(me), dec(sym)));
    amt = Math.min(amt, inv * 0.9); if (!(amt > 0)) { rec.action = `skip: no ${sym} inventory`; continue; }
    const amount = ethers.parseUnits(amt.toFixed(Math.min(dec(sym), 12)), dec(sym)); rec.action = `sell ${amt.toPrecision(4)} ${sym}`; if (DRY) continue;
    const dl = Math.floor(Date.now() / 1000) + 300;
    if (sym !== 'ZNYT') { const t = new ethers.Contract(addrOf(sym), ERC, signer); if ((await t.allowance(me, pool.router)) < amount) await (await t.approve(pool.router, ethers.MaxUint256, { ...ov, gasLimit: 100_000n })).wait(); }
    let tx; if (pool.kind === 'native') { const r = new ethers.Contract(pool.router, NATIVE, signer); tx = sym === 'ZNYT' ? await r.swapExactZnytForToken(0n, dl, { ...ov, value: amount, gasLimit: 300_000n }) : await r.swapExactTokenForZnyt(amount, 0n, dl, { ...ov, gasLimit: 300_000n }); }
    else tx = await new ethers.Contract(pool.router, TOKR, signer).swapExactInput(addrOf(sym), amount, 0n, me, dl, { ...ov, gasLimit: 300_000n });
    await tx.wait(); rec.tx = tx.hash; log(pool.id, rec.action, 'dev', rec.deviationPct + '%', tx.hash);
  }
  // keeper inventory = test tokens minted through each token's public faucet (same daily cap as anyone)
  for (const s of Object.keys(m.tokens)) if (!DRY) { const t = new ethers.Contract(m.tokens[s].address, ERC, signer); if (Number(await t.nextClaimAt(me)) <= Date.now() / 1000) { try { await (await t.claim({ ...ov, gasLimit: 120_000n })).wait(); log('claimed', s); } catch (e) { log('claim failed', s, e.shortMessage || e.message); } } }
  writeFileSync(OUT + '.tmp', JSON.stringify(out, null, 2) + '\n'); renameSync(OUT + '.tmp', OUT); log('prices', JSON.stringify(out.tokens), JSON.stringify(Object.fromEntries(Object.entries(out.pools).map(([k, v]) => [k, v.deviationPct + '% ' + v.action]))));
  return Number(K.intervalSec || 600);
}
for (;;) { let wait = 600; try { wait = await tick(); } catch (e) { log('tick error', e.shortMessage || e.message); } if (ONCE || DRY) break; await new Promise((r) => setTimeout(r, wait * 1000)); }
