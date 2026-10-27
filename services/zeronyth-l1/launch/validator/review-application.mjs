#!/usr/bin/env node
// Operator-side review of a validator application JSON (made by dashboard/validator-apply.html).
//   node review-application.mjs app.json --rpc http://127.0.0.1:9545 [--admin http://127.0.0.1:<admin-port>]
// Checks: schema, enode format, address = keccak(enode pubkey)[12:], not already a validator, and (with --admin) that the
// node is connected to us as a peer and reports a head close to ours. It ONLY PRINTS the vote calls; it never votes.
// QBFT adds a validator when more than 50% of current validators call qbft_proposeValidatorVote(address, true).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { ethers } = createRequire(path.join(here, '../../economy/package.json'))('ethers');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2]; const rpc = arg('--rpc'); const admin = arg('--admin');
if (!file || !rpc) { console.error('usage: review-application.mjs <app.json> --rpc <url> [--admin <url>] [--json]'); process.exit(2); }
const call = async (url, method, params = []) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); const j = await r.json(); if (j.error) throw new Error(`${method}: ${j.error.message}`); return j.result; };
const checks = []; const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail });
const app = JSON.parse(readFileSync(file, 'utf8'));
check('kind/version', app.kind === 'zeronyth-validator-application' && app.version === 1);
check('name/contact present', typeof app.name === 'string' && app.name.trim() && typeof app.contact === 'string' && app.contact.trim());
check('commitments accepted', app.commitments?.uptime247 && app.commitments?.oneValidatorPerOperator && app.commitments?.keepNodeKeyPrivate);
const m = /^enode:\/\/([0-9a-fA-F]{128})@([^:]+|\[[0-9a-fA-F:]+\]):(\d{1,5})(\?discport=\d+)?$/.exec(String(app.enode || ''));
check('enode format', !!m);
const derived = m ? ethers.computeAddress('0x04' + m[1]) : null;
check('address derived from enode matches', derived && derived.toLowerCase() === String(app.validatorAddress || '').toLowerCase(), derived || '');
check('no private key material in file', !/"(key|privateKey|nodeKey|secret|mnemonic)"\s*:/i.test(readFileSync(file, 'utf8')));
const chainId = Number(await call(rpc, 'eth_chainId'));
check('chainId matches', chainId === (app.chainId ?? chainId), String(chainId));
const vals = (await call(rpc, 'qbft_getValidatorsByBlockNumber', ['latest'])).map((v) => v.toLowerCase());
check('not already a validator', derived && !vals.includes(derived.toLowerCase()), `${vals.length} current validators`);
if (admin && m) {
  const peers = await call(admin, 'admin_peers').catch(() => []);
  const peer = peers.find((p) => String(p.id || p.enode || '').toLowerCase().includes(m[1].toLowerCase()));
  check('node is connected to our node (RLPx-authenticated key)', !!peer, peer ? peer.network?.remoteAddress || '' : 'not in admin_peers');
}
const ok = checks.every((c) => c.pass);
for (const c of checks) console.log(`${c.pass ? 'OK  ' : 'FAIL'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
const need = Math.floor(vals.length / 2) + 1;
console.log(`\n${ok ? 'READY FOR A VOTE' : 'NOT READY'}: ${app.name} <${app.contact}> ${derived || ''}`);
if (ok) {
  console.log(`Needs ${need} of ${vals.length} current validators to vote. Each validator operator runs ON THEIR OWN NODE (admin/QBFT API, loopback):`);
  console.log(`  curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"qbft_proposeValidatorVote","params":["${derived}",true]}' http://127.0.0.1:<their-rpc-port>`);
  console.log('After it is included (check qbft_getValidatorsByBlockNumber), each voter clears the pending vote:');
  console.log(`  ... "method":"qbft_discardValidatorVote","params":["${derived}"] ...`);
  console.log('Note: adding a validator raises the quorum. Only vote in nodes that are synced and online.');
}
if (process.argv.includes('--json')) console.log(JSON.stringify({ ok, derived, checks, need, validators: vals.length }));
process.exit(ok ? 0 : 1);
