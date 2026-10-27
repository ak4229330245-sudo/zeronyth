// Day-0 step after the public chain starts: opsDeployer (nonce 0) deploys ZnytEconomy, wires the predeployed EmissionPool,
// then starts the pool schedule. Refuses unless the deployer's nonce is 0 and the CREATE address matches the genesis manifest.
// The deployer key is read from the environment of the person running it (ZERONYTH_DEPLOYER_KEY) and is never written to disk.
// --test uses the throwaway rehearsal key in out-test/test-keys.json.
// Usage: RPC_URL=http://127.0.0.1:9545 COORDINATOR=0x... node launch-deploy.mjs [--test] [--gas-price-wei 1000000000]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const l1 = path.resolve(here, '../..');
const { ethers } = createRequire(path.join(l1, 'economy/package.json'))('ethers');
const TEST = process.argv.includes('--test'); const dir = path.join(here, TEST ? 'out-test' : 'out');
const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const gi = process.argv.indexOf('--gas-price-wei'); const gasPrice = BigInt(gi > 0 ? process.argv[gi + 1] : '1000000000');
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'http://127.0.0.1:9545', m.chainId, { staticNetwork: true });
const key = TEST ? JSON.parse(readFileSync(path.join(dir, 'test-keys.json'), 'utf8')).opsDeployer : process.env.ZERONYTH_DEPLOYER_KEY;
if (!key) throw new Error('Set ZERONYTH_DEPLOYER_KEY in your own shell (not saved anywhere)');
const w = new ethers.Wallet(key, provider);
if (w.address !== m.addresses.opsDeployer) throw new Error('Key does not match manifest opsDeployer');
if (await provider.getTransactionCount(w.address) !== 0) throw new Error('opsDeployer nonce is not 0 — the EmissionPool beneficiary would not match. STOP.');
const coordinator = process.env.COORDINATOR || (TEST ? m.addresses.faucet : null);
if (!coordinator || !ethers.isAddress(coordinator)) throw new Error('COORDINATOR=0x... required');
const art = (n) => JSON.parse(readFileSync(path.join(l1, 'economy/build', `${n}.json`), 'utf8'));
const E = art('ZnytEconomy'); const P = art('EmissionPool');
const o = { gasPrice, gasLimit: 6_000_000n };
const econ = await new ethers.ContractFactory(E.abi, E.bytecode, w).deploy(coordinator, 10 * 86400, 3 * 86400, ethers.parseEther('10'), ethers.parseEther('5'), o);
await econ.deploymentTransaction().wait();
const econAddr = await econ.getAddress();
if (econAddr !== m.economyExpected) throw new Error(`economy at ${econAddr} != expected ${m.economyExpected}`);
console.log('ZnytEconomy', econAddr, '(matches EmissionPool.beneficiary)');
await (await econ.setEmission(m.emissionPool, [4000, 3000, 3000], 2500, { gasPrice, gasLimit: 300_000n })).wait();
const pool = new ethers.Contract(m.emissionPool, P.abi, w);
await (await pool.start({ gasPrice, gasLimit: 300_000n })).wait();
console.log('EmissionPool started: remaining', ethers.formatEther(await pool.remaining()), 'daily', ethers.formatEther(await pool.dailyEmission()));
