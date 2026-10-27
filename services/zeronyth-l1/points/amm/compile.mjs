// Compile ZnytAmm.sol + ZnytTokenRouter.sol (+ reused experiments/swap-lab/SwapLab.sol) -> build/*.json. Run from this dir with economy's solc.
import { createRequire } from 'node:module'; import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const solc = createRequire(path.join(here, '../../economy/package.json'))('solc');
const sources = { 'ZnytTokenRouter.sol': { content: readFileSync(path.join(here, 'ZnytTokenRouter.sol'), 'utf8') }, 'ZnytAmm.sol': { content: readFileSync(path.join(here, 'ZnytAmm.sol'), 'utf8') }, 'SwapLab.sol': { content: readFileSync(path.join(here, '../../experiments/swap-lab/SwapLab.sol'), 'utf8').replace('pragma solidity 0.8.28;', 'pragma solidity ^0.8.24; // pinned 0.8.28 upstream; box solc is 0.8.24 (no 0.8.25+ features used)') } };
const out = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { evmVersion: 'shanghai', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
for (const e of out.errors || []) console.error(e.formattedMessage.split('\n').slice(0, 4).join('\n'));
if ((out.errors || []).some((e) => e.severity === 'error')) process.exit(1);
mkdirSync(path.join(here, 'build'), { recursive: true });
for (const n of ['WZNYT', 'ZTestToken', 'ZnytAmmRouter', 'SwapLabPair', 'SwapLabRouter', 'ZnytTokenRouter']) { const c = out.contracts[n === 'ZnytTokenRouter' ? 'ZnytTokenRouter.sol' : !n.startsWith('SwapLab') ? 'ZnytAmm.sol' : 'SwapLab.sol'][n];
  writeFileSync(path.join(here, 'build', n + '.json'), JSON.stringify({ abi: c.abi, bytecode: '0x' + c.evm.bytecode.object })); console.log(n, c.evm.bytecode.object.length / 2, 'bytes'); }
