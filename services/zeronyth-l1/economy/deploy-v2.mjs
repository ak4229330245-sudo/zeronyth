// Box only: tokenomics v2 — ZnytEconomy v2 + EmissionPool (30M, 15%/yr of remaining) + DevVesting (13M, 1y cliff + 3y linear)
// + approved allocation moved out of the dev account into separate wallets/contracts (valueless box testnet).
// Allocation (100,000,000 ZNYT): reward pool 30% | developer 15% (2% unlocked + 13% vesting) | ecosystem & contributor grants 20%
//   | operations treasury 15% | liquidity 10% | early participant distribution 10% (on the box this stays in the faucet account).
import { provider, artifact, deployment, saveDeployment, roleWallet, funderWallet, txo, send, parseEther, formatEther, NETWORK } from './lib/common.mjs';
import { ContractFactory, Contract } from 'ethers';
if (NETWORK !== 'box') throw new Error('box only');
const M = (n) => parseEther(String(n)) * 1_000_000n;
const funder = funderWallet(); const deployer = roleWallet('deployer'); const coordinator = roleWallet('coordinator');
const d = deployment(); const YEAR = 365 * 86400;
const deploy = async (name, ...args) => { const a = artifact(name); const c = await new ContractFactory(a.abi, a.bytecode, deployer).deploy(...args, txo()); const r = await c.deploymentTransaction().wait(); console.log(`${name} ${await c.getAddress()} gas ${r.gasUsed}`); return new Contract(await c.getAddress(), a.abi, deployer); };
const pay = async (to, v, label) => { await send(funder.sendTransaction({ to, value: v, ...txo() })); console.log(`allocated ${formatEther(v)} ZNYT -> ${label} ${to}`); };
const step = process.argv[2] || 'all';
if (!d.v2) d.v2 = {};
if (!d.v2.ZnytEconomy) {
  const econ = await deploy('ZnytEconomy', coordinator.address, 10 * 86400, 3 * 86400, parseEther('10'), parseEther('5'));
  const pool = await deploy('EmissionPool', await econ.getAddress(), YEAR, 1500);
  await send(econ.setEmission(await pool.getAddress(), [4000, 3000, 3000], Number(process.env.CAP_BPS || 2500), txo()));
  d.v2.ZnytEconomy = await econ.getAddress(); d.v2.EmissionPool = await pool.getAddress(); saveDeployment(d);
}
if (!d.v2.ZnytEconomyFastTest) {   // e2e only: 30 s plans, small 300k pool with a 1-day "year" so rewards are visible quickly
  const econ = await deploy('ZnytEconomy', coordinator.address, 30, 15, parseEther('10'), parseEther('5'));
  const pool = await deploy('EmissionPool', await econ.getAddress(), 86400, 1500);
  await send(econ.setEmission(await pool.getAddress(), [4000, 3000, 3000], 2500, txo()));
  d.v2.ZnytEconomyFastTest = await econ.getAddress(); d.v2.EmissionPoolFastTest = await pool.getAddress(); saveDeployment(d);
}
if (step === 'all' && !d.v2.allocated) {
  const dev = roleWallet('developer');           // box stand-in for the user's own developer address
  const now = (await provider.getBlock('latest')).timestamp;
  const vest = await deploy('DevVesting', dev.address, now, YEAR, 3 * YEAR);
  d.v2.DevVesting = await vest.getAddress();
  const pool = new Contract(d.v2.EmissionPool, artifact('EmissionPool').abi, deployer);
  await pay(d.v2.EmissionPool, M(30), 'reward pool (EmissionPool, locked)');
  await send(pool.start(txo()));
  await pay(d.v2.DevVesting, M(13), 'developer vesting (1y cliff + 3y linear)');
  await pay(dev.address, M(2), 'developer unlocked 2%');
  for (const [role, amt, label] of [['grants', 20, 'ecosystem & contributor grants'], ['treasury', 15, 'operations treasury'], ['liquidity', 10, 'liquidity']]) {
    const w = roleWallet(role); d.v2[role] = w.address; await pay(w.address, M(amt), label);
  }
  const fpool = new Contract(d.v2.EmissionPoolFastTest, artifact('EmissionPool').abi, deployer);
  await pay(d.v2.EmissionPoolFastTest, parseEther('300000'), 'FastTest emission pool (test only, from early-participant bucket)');
  await send(fpool.start(txo()));
  d.v2.developer = dev.address; d.v2.earlyParticipants = funder.address; d.v2.allocatedAtBlock = await provider.getBlockNumber(); d.v2.allocated = true;
  saveDeployment(d);
}
console.log(JSON.stringify(d.v2, null, 1));
