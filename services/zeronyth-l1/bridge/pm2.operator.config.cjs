// pm2 app for an OUTSIDE / second-machine bridge operator (used on the ABLENET VPS). Keys are generated ON this machine:
//   node script/operator-keygen.mjs --count=2          (writes ~/.zeronyth-relayer/operator-keys.json, chmod 600)
//   BRIDGE_MACHINE=vps BRIDGE_OPERATOR_LABEL="ZeroLayer vps" pm2 start pm2.operator.config.cjs
// Talks to 9127 through THIS machine's own node RPC (BRIDGE_HOME_RPC, default 127.0.0.1:8545) and to the remote chains
// through their public RPCs. Lean: ~100 MB heap cap. No API, no admin key, no guardian key.
const path = require('node:path');
const os = require('node:os');
const cwd = __dirname;
module.exports = { apps: [{
  name: process.env.BRIDGE_PM2_NAME || 'zeronyth-bridge-operator', cwd, script: 'relayer.mjs',
  interpreter: 'nice', interpreter_args: '-n 10 node',
  env: { BRIDGE_OPERATOR_KEYS: process.env.BRIDGE_OPERATOR_KEYS || path.join(os.homedir(), '.zeronyth-relayer', 'operator-keys.json'),
    RELAYER_NAME: process.env.RELAYER_NAME || 'operator', BRIDGE_MACHINE: process.env.BRIDGE_MACHINE || os.hostname(),
    BRIDGE_OPERATOR_LABEL: process.env.BRIDGE_OPERATOR_LABEL || `operator@${os.hostname()}`, BRIDGE_NETWORK: 'main', BRIDGE_API: '0',
    BRIDGE_POLL_MS: '6000', BRIDGE_HOME_RPC: process.env.BRIDGE_HOME_RPC || 'http://127.0.0.1:8545',
    NODE_OPTIONS: '--max-old-space-size=96' },
  max_memory_restart: '150M', restart_delay: 10000, out_file: path.join(cwd, 'logs', 'operator.out.log'),
  error_file: path.join(cwd, 'logs', 'operator.err.log'), merge_logs: true, time: false,
}] };
