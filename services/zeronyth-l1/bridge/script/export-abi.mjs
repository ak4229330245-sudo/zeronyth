// Copy forge build output (abi + creation bytecode) to abi/ so the relayer/deployer run without forge.
import { readFileSync, writeFileSync } from 'node:fs';
for (const n of ['ZnytBridgeVault', 'BridgeMinter', 'WrappedZnyt', 'BridgeAttestationBoard', 'BridgeTimelock']) {
  const j = JSON.parse(readFileSync(`out/${n}.sol/${n}.json`, 'utf8'));
  writeFileSync(`abi/${n}.json`, JSON.stringify({ contractName: n, abi: j.abi, bytecode: j.bytecode.object }) + '\n');
  console.log(n, (j.bytecode.object.length - 2) / 2, 'bytes');
}
