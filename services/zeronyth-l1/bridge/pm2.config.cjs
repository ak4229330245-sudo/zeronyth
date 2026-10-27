// pm2 apps for the 2 BOX bridge relayers (r0, r1). The relayer set is 3-of-4: r0 + r1 here, 2 keys on the ABLENET VPS
// (pm2.operator.config.cjs) => neither machine alone can sign. r0 also serves the API / indexer / invariant guardian.
// Every relayer posts its signatures to the public BridgeAttestationBoard on 9127 and any of them submits mint/release
// with its own gas. Low priority (nice 10), API on 127.0.0.1 only. Start from the deployed tree:
//   pm2 startOrRestart bridge/pm2.config.cjs --update-env && pm2 save
const path = require('node:path');
const cwd = __dirname;
const app = (i) => ({
  name: `zeronyth-bridge-relayer-${i}`, cwd, script: 'relayer.mjs', interpreter: 'nice', interpreter_args: '-n 10 node',
  env: { RELAYER_INDEX: String(i), RELAYER_NAME: `r${i}`, BRIDGE_API: i === 0 ? '1' : '0', BRIDGE_SUBMITTER: '0',
    BRIDGE_MACHINE: 'box', BRIDGE_OPERATOR_LABEL: `ZeroLayer box r${i}`, BRIDGE_NETWORK: 'main', BRIDGE_API_PORT: '9811',
    BRIDGE_POLL_MS: '4000', BRIDGE_HOME_RPC: 'http://127.0.0.1:9545', NODE_OPTIONS: '--max-old-space-size=160' },
  max_memory_restart: '220M', restart_delay: 5000, out_file: path.join(cwd, 'logs', `relayer-${i}.out.log`),
  error_file: path.join(cwd, 'logs', `relayer-${i}.err.log`), merge_logs: true, time: false,
});
module.exports = { apps: [app(0), app(1)] };
