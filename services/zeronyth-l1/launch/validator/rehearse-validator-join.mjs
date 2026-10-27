// LOCAL-ONLY rehearsal of the validator join flow: 4 throwaway validators + 1 applicant on isolated loopback ports.
// application JSON -> review-application.mjs -> 3/4 votes -> applicant proposes blocks -> 3/5 votes out -> chain keeps going.
// Never touches the live chain, its ports or keys. Ports: p2p 34301-34305, RPC 12541-12545. Data: /workspace/zeronyth-validator-rehearsal
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, openSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const l1 = path.resolve(here, '../..'); const pub = path.join(l1, 'launch/public');
const { ethers } = createRequire(path.join(l1, 'economy/package.json'))('ethers');
const DATA = '/workspace/zeronyth-validator-rehearsal';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const ok = (n, p, d = '') => { results.push(`${p ? 'PASS' : 'FAIL'} ${n} ${d}`); console.log(results.at(-1)); };
const procs = []; const stopAll = () => { for (const p of procs) try { p.kill('SIGTERM'); } catch {} }; process.on('exit', stopAll); process.on('SIGINT', () => process.exit(130));
const rpcUrl = (i) => `http://127.0.0.1:${12540 + i}`;
const call = async (i, method, params = []) => { const r = await fetch(rpcUrl(i), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result; };
const validators = async () => (await call(1, 'qbft_getValidatorsByBlockNumber', ['latest'])).map((v) => v.toLowerCase());
const height = async (i = 1) => Number(await call(i, 'eth_blockNumber'));

rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true });
const r = spawnSync(process.execPath, [path.join(pub, 'build-public-genesis.mjs'), '--test', '--launch-time', 'now'], { encoding: 'utf8' }); if (r.status) { console.error(r.stderr); process.exit(1); }
const genesis = path.join(pub, 'out-test/genesis.json'); const man = JSON.parse(readFileSync(path.join(pub, 'out-test/manifest.json'), 'utf8'));
const keys = JSON.parse(readFileSync(path.join(pub, 'out-test/test-keys.json'), 'utf8'));
keys.validator5 = ethers.Wallet.createRandom().privateKey; // throwaway applicant key, written only into its 0600 key file
const runtime = path.resolve(l1, '../../generated-artifacts/runtime');
const besu = path.join(runtime, 'besu-26.9.0/bin/besu'); const JAVA_HOME = path.join(runtime, readdirSync(runtime).find((d) => d.startsWith('jdk-')));
const enode = (i) => `enode://${new ethers.SigningKey(keys[`validator${i}`]).publicKey.slice(4)}@127.0.0.1:${34300 + i}`;
function start(i) {
  const d = path.join(DATA, `node${i}`); mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, 'key'), keys[`validator${i}`].slice(2), { mode: 0o600 });
  writeFileSync(path.join(d, 'static-nodes.json'), JSON.stringify([1, 2, 3, 4, 5].filter((j) => j !== i).map(enode)));
  const args = ['--profile=ENTERPRISE', `--genesis-file=${genesis}`, `--data-path=${d}`, `--node-private-key-file=${path.join(d, 'key')}`,
    `--network-id=${man.chainId}`, '--sync-mode=FULL', '--data-storage-format=FOREST', '--p2p-host=127.0.0.1', '--p2p-interface=127.0.0.1',
    `--p2p-port=${34300 + i}`, '--discovery-enabled=false', '--nat-method=NONE', `--static-nodes-file=${path.join(d, 'static-nodes.json')}`,
    '--min-gas-price=1000000000', '--metrics-enabled=false', '--rpc-http-enabled=true', '--rpc-http-host=127.0.0.1', `--rpc-http-port=${12540 + i}`,
    '--rpc-http-api=ETH,NET,QBFT,ADMIN', '--host-allowlist=localhost,127.0.0.1'];
  const log = openSync(path.join(DATA, `node${i}.log`), 'a');
  procs.push(spawn('/usr/bin/nice', ['-n', '15', besu, ...args], { env: { PATH: process.env.PATH, HOME: process.env.HOME, JAVA_HOME, JAVA_OPTS: '-Xms64m -Xmx256m -XX:+UseSerialGC -XX:ActiveProcessorCount=1' }, stdio: ['ignore', log, log] }));
}
const waitFor = async (fn, secs) => { for (let t = 0; t < secs; t++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(1000); } return null; };
for (const i of [1, 2, 3, 4]) start(i);
ok('4 validators produce blocks', await waitFor(async () => (await height()) >= 3, 150), `h=${await height().catch(() => '?')}`);
start(5);
const addr5 = new ethers.Wallet(keys.validator5).address;
ok('applicant full node syncs', await waitFor(async () => (await height(5)) >= (await height(1)) - 2 && (await height(5)) > 0, 150), `h5=${await height(5).catch(() => '?')}`);
const info = await call(5, 'admin_nodeInfo'); const appEnode = info.enode.replace(/@[^:]+:/, '@127.0.0.1:').replace(/\?.*$/, '');
const app = { kind: 'zeronyth-validator-application', version: 1, chainId: man.chainId, createdAt: new Date().toISOString(), name: 'rehearsal-applicant', contact: 'local',
  enode: appEnode, validatorAddress: addr5, host: 'vps', spec: '1/1/10', region: 'box', commitments: { uptime247: true, oneValidatorPerOperator: true, keepNodeKeyPrivate: true } };
writeFileSync(path.join(DATA, 'application.json'), JSON.stringify(app, null, 2));
const rv = spawnSync(process.execPath, [path.join(here, 'review-application.mjs'), path.join(DATA, 'application.json'), '--rpc', rpcUrl(1), '--admin', rpcUrl(1)], { encoding: 'utf8' });
ok('review-application: READY', rv.status === 0, rv.stdout.split('\n').filter((l) => l.startsWith('FAIL')).join('; '));
const bad = { ...app, validatorAddress: ethers.Wallet.createRandom().address }; writeFileSync(path.join(DATA, 'bad.json'), JSON.stringify(bad));
ok('review-application rejects wrong address', spawnSync(process.execPath, [path.join(here, 'review-application.mjs'), path.join(DATA, 'bad.json'), '--rpc', rpcUrl(1)]).status === 1);
// vote in: only 2 votes first (must NOT be enough), then the 3rd
for (const i of [1, 2]) await call(i, 'qbft_proposeValidatorVote', [addr5, true]);
await sleep(8000); ok('2 of 4 votes are not enough', !(await validators()).includes(addr5.toLowerCase()));
await call(3, 'qbft_proposeValidatorVote', [addr5, true]);
ok('3 of 4 votes add the applicant', await waitFor(async () => (await validators()).includes(addr5.toLowerCase()), 60), `${(await validators()).length} validators`);
for (const i of [1, 2, 3]) await call(i, 'qbft_discardValidatorVote', [addr5]);
const hAdd = await height();
const minedBy5 = await waitFor(async () => { const h = await height(); for (let b = hAdd; b <= h; b++) { const blk = await call(1, 'eth_getBlockByNumber', ['0x' + b.toString(16), false]); if (blk.miner.toLowerCase() === addr5.toLowerCase()) return b; } return null; }, 60);
ok('new validator proposes a block', !!minedBy5, `block ${minedBy5}`);
// vote out: 5 validators -> need 3
for (const i of [1, 2, 3]) await call(i, 'qbft_proposeValidatorVote', [addr5, false]);
ok('3 of 5 votes remove it', await waitFor(async () => !(await validators()).includes(addr5.toLowerCase()), 60), `${(await validators()).length} validators`);
for (const i of [1, 2, 3]) await call(i, 'qbft_discardValidatorVote', [addr5]);
procs[4].kill('SIGTERM'); const h0 = await height(); await sleep(8000);
ok('chain continues after removal with applicant offline', (await height()) >= h0 + 4, `+${(await height()) - h0} blocks in 8s`);
writeFileSync(path.join(here, 'rehearsal-result.txt'), `validator join rehearsal ${new Date().toString()}\n${results.join('\n')}\n`);
stopAll(); await sleep(3000); if (!process.argv.includes('--keep')) rmSync(DATA, { recursive: true, force: true });
process.exit(results.every((l) => l.startsWith('PASS')) ? 0 : 1);
