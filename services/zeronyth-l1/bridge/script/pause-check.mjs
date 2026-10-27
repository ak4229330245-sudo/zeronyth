// Live guardian check: guardian pauses the vault, a lock must revert, the owner unpauses. Records tx hashes.
import { parseEther } from 'ethers';
import { HOME } from '../lib/chains.mjs';
import { adminWallet, guardianWallet } from '../lib/keys.mjs';
import { provider, vaultContract, loadDeployment, saveDeployment, toB32 } from '../lib/bridge.mjs';
const d = loadDeployment(); const p = provider(HOME.rpc, 9127); const gp = { gasPrice: 1_000_000_000n };
const g = vaultContract(d.home.vault, guardianWallet(p)); const a = vaultContract(d.home.vault, adminWallet(p));
const cid = Number(Object.values(d.remotes).find((r) => r.vaultEnabled)?.chainId);
const r1 = await (await g.pause(gp)).wait();
let res; try { await a.lock.staticCall(cid, toB32(a.runner.address), { value: parseEther('0.1') }); res = 'UNEXPECTED: lock succeeded while paused'; } catch (e) { res = 'lock reverted while paused: ' + (e.revert?.name || e.shortMessage); }
const r2 = await (await a.unpause(gp)).wait();
d.liveChecks = { ...(d.liveChecks || {}), guardianPause: { pauseTx: r1.hash, result: res, unpauseTx: r2.hash, pausedAfter: await a.paused() } };
saveDeployment(d); console.log(JSON.stringify(d.liveChecks));
