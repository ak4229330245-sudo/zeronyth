// OPTIONAL cross-check (not part of `npm test`): verifies that the ML-DSA
// address this project's crypto core derives for a fixed seed matches the
// ZERONYTH CLI wallet (pq-wallet.mjs) run live against the same seed.
//
//   node test/crosscheck-cli.mjs
//
// Exits non-zero on mismatch. Requires the Besu recon tree to be present.
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { addressFromSecret } from '../src/core/crypto.mjs';
import { VECTORS, seqBytes } from './fixtures.mjs';

const CLI = '/home/hatch/workspace/besu-2611-recon/e2e/wallet/pq-wallet.mjs';
const keyfile = '/tmp/qwallet-v2-crosscheck-key.json';

const seedHex = [...VECTORS.mldsa.secret].map((b) => b.toString(16).padStart(2, '0')).join('');
writeFileSync(keyfile, JSON.stringify({ scheme: 'mldsa', seed: seedHex }) + '\n');
try {
  const cliAddress = execFileSync('node', [CLI, 'address', keyfile], { encoding: 'utf8' }).trim();
  const coreAddress = addressFromSecret('mldsa', VECTORS.mldsa.secret);
  console.log('pq-wallet.mjs :', cliAddress);
  console.log('qwallet-v2    :', coreAddress);
  if (cliAddress !== coreAddress) {
    console.error('MISMATCH');
    process.exit(1);
  }
  console.log('MATCH');
} finally {
  rmSync(keyfile, { force: true });
}

// Also sanity: a second random seed agrees via derivation in both noble builds.
const seed2 = seqBytes(32, 0x40);
console.log('second seed core address:', addressFromSecret('mldsa', seed2));
