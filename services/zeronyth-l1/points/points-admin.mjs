#!/usr/bin/env node
// ZERONYTH points admin CLI (box only; talks to the loopback service with the admin token from the state dir).
//   node points-admin.mjs grant <address> <points> "<reason>"     bug report / contribution grant (logged in the ledger)
//   node points-admin.mjs ban|unban|zero|hold|clear <address> "<reason>"
//   node points-admin.mjs flags | status | verify | wallet <address>
//   node points-admin.mjs bot-flags                                anti-bot: suspended (BAN 審査中) / banned / bot flags with evidence + live scores
//   node points-admin.mjs bot-score <address>                      anti-bot: current score, signals, linked cluster, recent events
//   node points-admin.mjs confirm-ban <address> [--cluster] "<reason>"  permanent ban: forfeits all points, excluded from snapshots
//                                                                  (--cluster also bans the linked wallets: same funding source / IP hash)
//   node points-admin.mjs unban <address> "<reason>"               lifts a suspension or ban (forfeited points stay forfeited)
//   node points-admin.mjs snapshot [YYYY-MM-DD]                    today = partial snapshot (published on chain too)
//   node points-admin.mjs fund-publisher [ZNYT=2]                 send test ZNYT from the economy deployer role
import { readFileSync } from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.ZERONYTH_POINTS_DIR || '/workspace/zeronyth-points';
const URL_ = `http://127.0.0.1:${process.env.ZERONYTH_POINTS_PORT || 9807}`;
const [cmd, ...a] = process.argv.slice(2);
const token = readFileSync(path.join(DIR, 'admin.token'), 'utf8').trim();
async function call(p, body) {
  const r = await fetch(URL_ + p, { method: body ? 'POST' : 'GET', headers: { 'x-points-admin': token, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const j = await r.json(); console.log(JSON.stringify(j, null, 2)); if (!r.ok) process.exit(1); return j;
}
if (cmd === 'grant') await call('/admin/grant', { address: a[0], points: Number(a[1]), reason: a.slice(2).join(' ') });
else if (['ban', 'unban', 'zero', 'hold', 'clear'].includes(cmd)) await call('/admin/' + cmd, { address: a[0], reason: a.slice(1).join(' ') });
else if (['flags', 'status', 'verify'].includes(cmd)) await call('/admin/' + cmd);
else if (cmd === 'wallet') await call('/admin/wallet', { address: a[0] });
else if (cmd === 'bot-flags') await call('/admin/bot-flags', {});
else if (cmd === 'bot-score') await call('/admin/bot-score', { address: a[0] });
else if (cmd === 'confirm-ban') { const cl = a.includes('--cluster'), rest = a.filter((x) => x !== '--cluster'); await call('/admin/confirm-ban', { address: rest[0], cluster: cl, reason: rest.slice(1).join(' ') }); }
else if (cmd === 'snapshot') await call('/admin/snapshot', a[0] ? { day: a[0], partial: false } : {});
else if (cmd === 'fund-publisher') {
  const econ = path.join(here, '../economy'); const { ethers } = createRequire(path.join(here, 'package.json'))('ethers');
  const { QueuedSigner } = await import(path.join(here, 'lib/signer-queue.mjs'));
  const st = await (await fetch(URL_ + '/admin/status', { headers: { 'x-points-admin': token } })).json();
  const keys = JSON.parse(readFileSync(path.join(econ, '.secrets/main-keys.json'), 'utf8')); const pk = typeof keys.deployer === 'string' ? keys.deployer : keys.deployer.privateKey;
  const provider = new ethers.JsonRpcProvider('http://127.0.0.1:9545', 9127, { staticNetwork: true });
  const s = new QueuedSigner(new ethers.Wallet(pk, provider), { chainId: 9127 });
  const tx = await s.sendTransaction({ to: st.publisher, value: ethers.parseEther(a[0] || '2'), gasLimit: 21000n, gasPrice: 1_000_000_000n, type: 0 });
  await tx.wait(); console.log('funded publisher', st.publisher, tx.hash, ethers.formatEther(await provider.getBalance(st.publisher)), 'ZNYT');
} else { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).join('\n')); }
