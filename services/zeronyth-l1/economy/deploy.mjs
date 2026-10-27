// Deploy RewardPool, FeeSplitter (default 20% burn / 80% pool) and ZnytEconomy to the BOX chain.
import { provider, artifact, deployment, saveDeployment, roleWallet, funderWallet, txo, send, rpc, parseEther, NETWORK } from './lib/common.mjs';
import { ContractFactory } from 'ethers';
if (NETWORK !== 'box' && process.env.ECON_ALLOW_NONBOX !== '1') throw new Error('box only (set ECON_ALLOW_NONBOX=1 after approval)');
const funder = funderWallet();
const deployer = roleWallet('deployer');
const coordinator = roleWallet('coordinator');
const fund = async (w, eth) => {
  const bal = await provider.getBalance(w.address);
  if (bal < parseEther(eth) / 2n) await send(funder.sendTransaction({ to: w.address, value: parseEther(eth), ...txo() }));
};
await fund(deployer, '1000'); await fund(coordinator, '1000');
const validators = await rpc('qbft_getValidatorsByBlockNumber', ['latest']);
const d = deployment();
const deploy = async (name, ...args) => {
  const a = artifact(name); const f = new ContractFactory(a.abi, a.bytecode, deployer);
  const c = await f.deploy(...args, txo()); const r = await c.deploymentTransaction().wait();
  console.log(`${name} ${await c.getAddress()} gas ${r.gasUsed}`); return await c.getAddress();
};
const BURN_BPS = Number(process.env.BURN_BPS || 2000);
d.chainId = 9127; d.deployer = deployer.address; d.coordinator = coordinator.address; d.validators = validators;
d.RewardPool = await deploy('RewardPool', validators);
d.FeeSplitter = await deploy('FeeSplitter', d.RewardPool, BURN_BPS);
d.ZnytEconomy = await deploy('ZnytEconomy', coordinator.address, 10 * 86400, 3 * 86400, parseEther('10'), parseEther('5'));
d.ZnytEconomyFastTest = await deploy('ZnytEconomy', coordinator.address, 30, 15, parseEther('10'), parseEther('5'));
d.deployedAtBlock = await provider.getBlockNumber();
saveDeployment(d);
console.log(JSON.stringify({ ...d, validators: d.validators.length }, null, 1));
