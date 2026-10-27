import solc from 'solc';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
const sources = Object.fromEntries(readdirSync('contracts').filter((f) => f.endsWith('.sol')).map((f) => [f, { content: readFileSync(`contracts/${f}`, 'utf8') }]));
const out = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources,
  settings: { evmVersion: 'shanghai', viaIR: true, optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
const errs = (out.errors || []).filter((e) => e.severity === 'error');
for (const e of out.errors || []) console.error(e.formattedMessage.split('\n').slice(0, 3).join('\n'));
if (errs.length) process.exit(1);
mkdirSync('build', { recursive: true });
for (const [file, cs] of Object.entries(out.contracts)) for (const [name, c] of Object.entries(cs)) {
  writeFileSync(`build/${name}.json`, JSON.stringify({ abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }));
  console.log(name, c.evm.bytecode.object.length / 2, 'bytes');
}
