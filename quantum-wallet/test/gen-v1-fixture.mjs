// PROVENANCE TOOL (not part of `npm test` — depends on the v1 bundle outside
// this repo). It generated the baked V1_FIXTURE in fixtures.mjs.
//
// Generate a v1 vault fixture using the ACTUAL v1 bundle code
// (extracted regions executed with stubs, same technique as
// ~/workspace/qwallet-fix/test-bundle-patch.mjs).
import { ml_dsa65, keccak_256 } from '/home/hatch/workspace/besu-2611-recon/e2e/wallet/vendor-noble.mjs';
import { readFileSync } from 'node:fs';

const s = readFileSync('/home/hatch/workspace/qwallet-fix/bundle.js', 'utf8');

// Region A: pure helpers incl. bu, $y, tg — from "function bu(" to "function aE("
const aStart = s.indexOf('function bu(');
const aEnd = s.indexOf('function aE(');
// Region B: vault code — from "const ng=" (the v1 AAD) to "function Gf(" (exclusive)
const bStart = s.indexOf('const ng=');
const bEnd = s.indexOf('function Gf(');
if ([aStart, aEnd, bStart, bEnd].some((x) => x < 0)) throw new Error('region not found');
const region = s.slice(aStart, aEnd) + '\n' + s.slice(bStart, bEnd);

const Xi = new TextEncoder();
const Pm = (b) => keccak_256(b);
const V2 = (b) => Buffer.from(b).toString('hex');
const Q2 = (h) => new Uint8Array(Buffer.from(h, 'hex'));
const Zl = (c) => '0x' + V2(c);
const De = 912701, mr = 'zeronyth-pq-experimental-v1';
const no = {
  keygen: (seed) => ml_dsa65.keygen(seed),
  sign: (m, sk) => ml_dsa65.sign(m, sk),
  verify: (sig, m, pk) => ml_dsa65.verify(sig, m, pk),
};
const factory = new Function('Xi', 'Pm', 'Zl', 'Q2', 'De', 'mr', 'no',
  region + '\nreturn { bu, $y, tg, uE, Wy };');
const W = factory(Xi, Pm, Zl, Q2, De, mr, no);

const seed = new Uint8Array(32);
for (let i = 0; i < 32; i++) seed[i] = i;
const password = 'phase1-fixture-password';

const blob = await W.uE(seed, password);
console.log('BLOB=' + JSON.stringify(blob));

// Verify with the bundle's own decrypt: keypair round-trip + address + seed identity
const kp = await W.Wy(JSON.parse(JSON.stringify(blob)), password);
console.log('wy-seed-match:', Buffer.from(kp.seed).equals(Buffer.from(seed)));
console.log('wy-address:', W.$y(kp.publicKey));

// Wrong password must fail in the bundle's own code too
try {
  await W.Wy(blob, 'phase1-fixture-passw0rd');
  console.log('wy-wrong-password: NOT REJECTED (bad)');
} catch (e) {
  console.log('wy-wrong-password rejected:', e.message);
}
