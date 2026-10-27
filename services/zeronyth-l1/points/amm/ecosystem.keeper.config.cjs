// pm2: ZERONYTH testnet AMM price keeper (real BNB/USD for zBNB pools). Key: ~/.zeronyth-secrets/amm-keeper-key.json (0600, not in git).
module.exports = { apps: [{ name: 'zeronyth-amm-keeper', script: __dirname + '/price-keeper.mjs', cwd: __dirname, interpreter: 'node', max_memory_restart: '150M', env: { ZERONYTH_RPC: 'http://127.0.0.1:9545' } }] };
