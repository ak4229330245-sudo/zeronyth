// node compile.cjs -> build.json (abi+bytecode for BenchToken/BenchPool)
const solc = require('../../economy/node_modules/solc'); const fs = require('fs');
const input = { language: 'Solidity', sources: { 'BenchToken.sol': { content: fs.readFileSync(__dirname + '/BenchToken.sol', 'utf8') } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
const out = JSON.parse(solc.compile(JSON.stringify(input)));
if (out.errors?.some((e) => e.severity === 'error')) { console.error(out.errors); process.exit(1); }
const c = out.contracts['BenchToken.sol'];
fs.writeFileSync(__dirname + '/build.json', JSON.stringify(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { abi: v.abi, bytecode: '0x' + v.evm.bytecode.object }]))));
console.log('ok', Object.keys(c));
