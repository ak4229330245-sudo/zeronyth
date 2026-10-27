// Deploy the REAL (10-day) ZNYT economy to the main public testnet (chain 9127, box primary RPC 127.0.0.1:9545).
// Approved by the owner on 2026-10-27 (「本番テストネットに入れていいよ」). No genesis / fee-config change.
//   ECON_NETWORK=main RPC_URL=http://127.0.0.1:9545 ECON_GAS_PRICE_WEI=1000000000 CONFIRM_MAIN=1 node deploy-main/deploy-main.mjs
// Contracts: RewardPool(validators) + FeeSplitter(20% burn) [needed by the coordinator's epoch keeper],
//   ZnytEconomy(period 10 d, grace 3 d, VPS 10 ZNYT, AI 5 ZNYT) + EmissionPool(15%/yr of remaining, 40/30/30 split, cap 25%).
// Funding (only what is needed): ONE tx from the funded faucet key -> deployer role (pool + gas). Everything else is sent by
// the deployer role, so the shared faucet key (also used by the faucet service) signs a single tx with an explicit,
// freshly read nonce and is retried on nonce collisions. Idempotent: every step is recorded in deployments/main.json.
// Keys: funder from services/zeronyth-l1/.env (never printed); role keys in economy/.secrets/main-keys.json (0600, gitignored).
import { provider, artifact, deployment, saveDeployment, roleWallet, funderWallet, txo, send, rpc, parseEther, formatEther, NETWORK, RPC_URL } from '../lib/common.mjs';
import { ContractFactory, Contract, NonceManager } from 'ethers';

if (NETWORK !== 'main' || process.env.CONFIRM_MAIN !== '1') throw new Error('set ECON_NETWORK=main CONFIRM_MAIN=1');
if (await rpc('eth_chainId') !== '0x23a7') throw new Error('not chain 9127');
const FUNDER = '0x8D976E2A2FC2577703D16E0102C366a08f5e1708';
const POOL = parseEther(process.env.EMISSION_POOL_ZNYT || '30000000');   // tokenomics: reward pool = 30% of 100M
const GAS_DEPLOYER = parseEther('100'), GAS_COORD = parseEther('50');
const YEAR = 365 * 86400;
const funder = funderWallet();
if (funder.address !== FUNDER) throw new Error('unexpected funder address');
const deployerW = roleWallet('deployer'), coordW = roleWallet('coordinator');
const deployer = new NonceManager(deployerW);
const d = deployment(); d.v2 ||= {};
const log = (...a) => console.log(new Date().toISOString(), ...a);
const save = () => saveDeployment(d);
d.network = 'main'; d.chainId = 9127; d.rpc = 'https://zeronyth.dpdns.org/rpc'; d.deployer = deployerW.address; d.coordinator = coordW.address; d.funder = FUNDER;
d.txs ||= {};

// 1) one funding tx from the shared faucet key, nonce-safe
const need = (d.v2.poolFunded ? 0n : POOL) + GAS_DEPLOYER + GAS_COORD;
if (!d.txs.fundDeployer) {
  const bal = await provider.getBalance(deployerW.address);
  if (bal < need) {
    let r;
    for (let i = 0; i < 6 && !r; i++) {
      const nonce = await provider.getTransactionCount(FUNDER, 'pending');
      try { const tx = await funder.sendTransaction({ to: deployerW.address, value: need - bal, nonce, ...txo() }); r = await tx.wait(); }
      catch (e) { const m = String(e.shortMessage || e.message); if (!/nonce|replacement|already known/i.test(m)) throw e; log('funder nonce collision, retrying', m.slice(0, 80)); await new Promise((s) => setTimeout(s, 1500 + i * 1000)); }
    }
    if (!r || r.status !== 1) throw new Error('funding failed');
    d.txs.fundDeployer = r.hash; save(); log(`funded deployer ${formatEther(need - bal)} ZNYT tx ${r.hash} block ${r.blockNumber}`);
  }
}
const deploy = async (key, name, ...args) => {
  if (d[key] || d.v2[key]) return d[key] || d.v2[key];
  const a = artifact(name); const c = await new ContractFactory(a.abi, a.bytecode, deployer).deploy(...args, txo());
  const r = await c.deploymentTransaction().wait(); const addr = await c.getAddress();
  d.txs[key] = r.hash; log(`${key} ${addr} tx ${r.hash} block ${r.blockNumber} gas ${r.gasUsed}`); return addr;
};
if (!d.txs.fundCoordinator && (await provider.getBalance(coordW.address)) < GAS_COORD / 2n) {
  const r = await send(deployer.sendTransaction({ to: coordW.address, value: GAS_COORD, ...txo() })); d.txs.fundCoordinator = r.hash; save(); log(`coordinator gas tx ${r.hash}`);
}
const validators = await rpc('qbft_getValidatorsByBlockNumber', ['latest']);
d.validators = validators;
if (!d.RewardPool) { d.RewardPool = await deploy('RewardPool', 'RewardPool', validators); save(); }
if (!d.FeeSplitter) { d.FeeSplitter = await deploy('FeeSplitter', 'FeeSplitter', d.RewardPool, 2000); save(); }
if (!d.v2.ZnytEconomy) { d.v2.ZnytEconomy = await deploy('ZnytEconomy', 'ZnytEconomy', coordW.address, 10 * 86400, 3 * 86400, parseEther('10'), parseEther('5')); d.deployedAtBlock ||= await provider.getBlockNumber(); save(); }
if (!d.v2.EmissionPool) { d.v2.EmissionPool = await deploy('EmissionPool', 'EmissionPool', d.v2.ZnytEconomy, YEAR, 1500); save(); }
const econ = new Contract(d.v2.ZnytEconomy, artifact('ZnytEconomy').abi, deployer);
const pool = new Contract(d.v2.EmissionPool, artifact('EmissionPool').abi, deployer);
if (!d.v2.emissionSet) { const r = await send(econ.setEmission(d.v2.EmissionPool, [4000, 3000, 3000], 2500, txo())); d.txs.setEmission = r.hash; d.v2.emissionSet = true; save(); log(`setEmission tx ${r.hash}`); }
if (!d.v2.poolFunded) { const r = await send(deployer.sendTransaction({ to: d.v2.EmissionPool, value: POOL, ...txo() })); d.txs.fundEmissionPool = r.hash; d.v2.poolFunded = formatEther(POOL); save(); log(`EmissionPool funded ${formatEther(POOL)} tx ${r.hash}`); }
if (!d.v2.poolStarted) { const r = await send(pool.start(txo())); d.txs.startEmission = r.hash; d.v2.poolStarted = true; d.v2.allocatedAtBlock = r.blockNumber; save(); log(`EmissionPool started tx ${r.hash} block ${r.blockNumber}`); }
d.params = { periodSeconds: Number(await econ.period()), graceSeconds: Number(await econ.grace()), priceVpsZnyt: formatEther(await econ.price(0)), priceAiZnyt: formatEther(await econ.price(1)),
  emissionSplitBps: [4000, 3000, 3000], capBps: 2500, annualBps: 1500, burnBps: 2000 };
save();
console.log(JSON.stringify({ ...d, validators: d.validators.length }, null, 1));
