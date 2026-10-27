// On-chain proof of the 20% burn / 80% validator-pool fee split (box chain).
// Usage: node fee-split-test.mjs [txCount]
import { provider, artifact, deployment, roleWallet, funderWallet, send, rpc, parseEther, formatEther, Contract, GAS_PRICE } from './lib/common.mjs';
import { totalSupply } from './lib/supply.mjs';
const d = deployment();
const N = Number(process.argv[2] || 40);
const gasPrice = GAS_PRICE || 1_000_000_000n;
const splitter = new Contract(d.FeeSplitter, artifact('FeeSplitter').abi, roleWallet('coordinator'));
const pool = new Contract(d.RewardPool, artifact('RewardPool').abi, roleWallet('coordinator'));
const head = await provider.getBlock('latest');
// Note: the QBFT header coinbase stays the proposer; the miningbeneficiary transition redirects fee credit.
const g = JSON.parse((await import('node:fs')).readFileSync(new URL('../config/genesis.box-econ.json', import.meta.url), 'utf8'));
const tr = g.config.transitions.qbft.find((t) => t.miningbeneficiary?.toLowerCase() === d.FeeSplitter.toLowerCase());
if (!tr || head.number < tr.block) throw new Error(`miningbeneficiary transition not active yet (block ${head.number})`);
const user = roleWallet('feeTestUser'); const funder = funderWallet();
if ((await provider.getBalance(user.address)) < parseEther('1')) await send(funder.sendTransaction({ to: user.address, value: parseEther('10'), gasPrice }));

// 0) settle anything already accumulated so the test window starts clean
await send(splitter.distribute({ gasPrice, gasLimit: 300000n }));
const s0 = await totalSupply(); const split0 = await provider.getBalance(d.FeeSplitter, s0.block);
const pool0 = await provider.getBalance(d.RewardPool, s0.block);

// 1) generate fees: N self-transfers from a test user
let nonce = await provider.getTransactionCount(user.address, 'pending'); const hashes = [];
for (let i = 0; i < N; i++) hashes.push((await user.sendTransaction({ to: user.address, value: 1n, gasPrice, nonce: nonce++ })).hash);
const receipts = await Promise.all(hashes.map((h) => provider.waitForTransaction(h)));
const feesUser = receipts.reduce((a, r) => a + r.gasUsed * r.gasPrice, 0n);
const s1 = await totalSupply();
const split1 = await provider.getBalance(d.FeeSplitter, s1.block);

// 2) distribute: 20% burned through Incinerator, 80% to RewardPool
const r = await send(splitter.distribute({ gasPrice, gasLimit: 300000n }));
const ev = r.logs.map((l) => { try { return splitter.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === 'Distributed');
const [amount, burned, toPool] = [ev.args.amount, ev.args.burned, ev.args.toPool];
const sBefore = await totalSupply(r.blockNumber - 1); const sAfter = await totalSupply(r.blockNumber);
const poolAfter = await provider.getBalance(d.RewardPool, r.blockNumber);
const distFee = r.gasUsed * r.gasPrice;

// 3) pay validators (permissionless claim), check each got 1/4 of the pool share
const vals = await pool.getValidators(); const vb0 = await Promise.all(vals.map((v) => provider.getBalance(v)));
const pend = await Promise.all(vals.map((v) => pool.pending(v)));
for (const v of vals) if ((await pool.pending(v)) > 0n) await send(pool.claim(v, { gasPrice, gasLimit: 200000n }));
const vb1 = await Promise.all(vals.map((v) => provider.getBalance(v)));

const out = {
  gasPriceWei: gasPrice.toString(), userTxs: N, userFeesWei: feesUser.toString(),
  splitterGainedWei: (split1 - split0).toString(), splitterGainEqualsFees: split1 - split0 >= feesUser,
  distribute: { block: r.blockNumber, amountWei: amount.toString(), burnedWei: burned.toString(), toPoolWei: toPool.toString(),
    burnPct: Number((burned * 10000n) / amount) / 100, poolPct: Number((toPool * 10000n) / amount) / 100 },
  supply: { beforeDistributeWei: sBefore.supplyWei.toString(), afterDistributeWei: sAfter.supplyWei.toString(),
    deltaWei: (sAfter.supplyWei - sBefore.supplyWei).toString(), deltaEqualsMinusBurned: sAfter.supplyWei - sBefore.supplyWei === -burned,
    trieComplete: sBefore.complete && sAfter.complete, windowStartWei: s0.supplyWei.toString() },
  poolReceivedWei: (poolAfter - pool0).toString(), poolReceivedEqualsToPool: poolAfter - pool0 === toPool,
  validators: vals.map((v, i) => ({ v, pendingWei: pend[i].toString(), receivedWei: (vb1[i] - vb0[i]).toString() })),
  distributeTxFeeWei: distFee.toString(),
};
console.log(JSON.stringify(out, null, 1));
