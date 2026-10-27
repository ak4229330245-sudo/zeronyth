// Box test chain only: runs a faucet build (argv[2] = server.mjs path) with a TEST role key (never the real faucet key),
// fires 24 concurrent /claim requests while another process-style QueuedSigner uses the same key, checks every drip mines.
import { spawn } from 'node:child_process';
import { Wallet, parseEther } from 'ethers';
import { provider, roleWallet, queuedRole, GAS_PRICE } from '../lib/common.mjs';
import { QueuedSigner } from '../lib/signer-queue.mjs';
const server = process.argv[2]; const PORT = 18787;
process.on('exit', () => { try { child.kill(); } catch {} });
const probe = await fetch(`http://127.0.0.1:${PORT}/health`).then(() => true, () => false);
if (probe) throw new Error(`port ${PORT} already in use; stop the stale test faucet first`);
const ROLE = `faucet-test-${process.argv[3] || 'x'}`; // fresh test key per run so earlier runs leave no pool residue
const fw = roleWallet(ROLE);
if ((await provider.getBalance(fw.address)) < parseEther('30')) await (await (await queuedRole('deployer')).sendTransaction({ to: fw.address, value: parseEther('32'), gasPrice: GAS_PRICE })).wait();
var child = spawn(process.execPath, [server], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, PORT: String(PORT), LISTEN_HOST: '127.0.0.1', RPC_URL: 'http://127.0.0.1:8545', FAUCET_PRIVATE_KEY: fw.privateKey, FAUCET_ADDRESS: fw.address, FAUCET_DRIP_ZNYT: '1', FAUCET_COOLDOWN_MS: '0', FAUCET_GAS_PRICE_WEI: String(GAS_PRICE), CHAIN_ID: '9127' } });
let log = ''; child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
for (let i = 0; i < 50 && !/listening/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
const other = new QueuedSigner(roleWallet(ROLE), { chainId: 9127 });
const n0 = await provider.getTransactionCount(fw.address, 'latest');
const claims = Array.from({ length: 24 }, () => fetch(`http://127.0.0.1:${PORT}/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: Wallet.createRandom().address }) }).then(async (r) => ({ s: r.status, j: await r.json() })));
const side = Array.from({ length: 6 }, () => other.sendTransaction({ to: fw.address, value: 1n, gasLimit: 21000n, gasPrice: GAS_PRICE, type: 0 }).then((t) => t.wait(1, 60_000)));
side.forEach((p) => p.catch(() => {}));
const res = await Promise.all(claims);
const health = await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.json()).catch(() => ({})); const sideRes = await Promise.allSettled(side);
const hashes = res.filter((r) => r.s === 200).map((r) => r.j.txHash);
const rec = await Promise.all(hashes.map((h) => provider.waitForTransaction(h, 1, 30_000).catch(() => null)));
const mined = (await provider.getTransactionCount(fw.address, 'latest')) - n0;
console.log(JSON.stringify({ faucetAddrMatches: JSON.stringify(health).toLowerCase().includes(fw.address.toLowerCase().slice(2)), server: server.split('/').slice(-3).join('/'), claims: res.length, http200: hashes.length, otherStatus: [...new Set(res.filter((r) => r.s !== 200).map((r) => `${r.s}:${r.j.error}`))], dripsMinedOk: rec.filter((x) => x?.status === 1).length, sideSender: { ok: sideRes.filter((x) => x.status === 'fulfilled').length, failed: sideRes.filter((x) => x.status === 'rejected').length, errs: [...new Set(sideRes.filter((x) => x.status === 'rejected').map((x) => x.reason?.code || x.reason?.shortMessage))] }, nonceAdvanced: mined }));
child.kill(); process.exit(0);
