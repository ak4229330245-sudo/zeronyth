// Generate relayer keys for ONE operator machine, on that machine (never copy keys between machines).
//   node script/operator-keygen.mjs --file=$HOME/.zeronyth-relayer/operator-keys.json --count=1
// Writes the file chmod 600 and prints only public data (addresses + ML-DSA-65 public-key hashes).
import os from 'node:os';
import path from 'node:path';
import { createOperatorKeys } from '../lib/keys.mjs';
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const file = String(args.file || path.join(os.homedir(), '.zeronyth-relayer', 'operator-keys.json'));
const n = Number(args.count || 1);
if (!(n >= 1 && n <= 4)) throw new Error('--count must be 1..4');
const ks = createOperatorKeys(file, n);
console.log(JSON.stringify({ file, mode: '0600', relayers: ks.map((k) => ({ address: k.wallet.address, mldsaPkSha256: k.mldsaPkHash })) }, null, 2));
