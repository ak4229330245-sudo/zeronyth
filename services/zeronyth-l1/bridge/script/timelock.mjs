// List / execute 24h-timelock operations recorded in deployments/<network>.json (d.timelockOps). Executing is open to
// anyone once the delay has passed; this uses the admin key only to pay gas (any funded key would do).
//   node script/timelock.mjs            list
//   node script/timelock.mjs --execute  execute every ready operation on 9127
import { ZeroHash } from 'ethers';
import { HOME } from '../lib/chains.mjs';
import { adminWallet } from '../lib/keys.mjs';
import { provider as mkProvider, loadDeployment, saveDeployment } from '../lib/bridge.mjs';
import { timelockContract } from '../lib/board.mjs';
const d = loadDeployment(); const home = mkProvider(HOME.rpc, d.home.chainId);
const tlAddr = d.timelocks?.[d.home.chainId]?.address; if (!tlAddr) { console.log('no timelock on home chain'); process.exit(0); }
const tl = timelockContract(tlAddr, adminWallet(home));
for (const [id, op] of Object.entries(d.timelockOps || {})) {
  op.done = await tl.isOperationDone(id); const ready = await tl.isOperationReady(id);
  console.log(op.label, op.done ? 'DONE' : ready ? 'READY' : `waiting until ${op.readyAt}`);
  if (ready && process.argv.includes('--execute')) {
    const r = await (await tl.execute(op.target, 0, op.data, ZeroHash, op.salt, { gasPrice: 1_000_000_000n })).wait();
    op.done = true; op.executeTx = r.hash; console.log('  executed', r.hash);
  }
}
saveDeployment(d);
