// Generates a NEW server hot key (faucet or coordinator) on this machine: secrets/<role>.key (0600, gitignored).
// Prints ONLY the address. Not for user wallets — the user's own addresses come from their wallet/hardware wallet.
// Usage: node gen-server-key.mjs faucet|coordinator
import { createRequire } from 'node:module';
import { writeFileSync, existsSync, mkdirSync, chmodSync, readFileSync } from 'node:fs';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { ethers } = createRequire(path.resolve(here, '../../economy/package.json'))('ethers');
const role = process.argv[2]; if (!['faucet', 'coordinator'].includes(role)) throw new Error('role: faucet|coordinator');
const dir = path.join(here, 'secrets'); mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
const f = path.join(dir, `${role}.key`);
if (!existsSync(f)) writeFileSync(f, ethers.Wallet.createRandom().privateKey + '\n', { mode: 0o600 });
chmodSync(f, 0o600);
console.log(`${role} address: ${new ethers.Wallet(readFileSync(f, 'utf8').trim()).address}  (key: ${f}, 0600, never printed)`);
