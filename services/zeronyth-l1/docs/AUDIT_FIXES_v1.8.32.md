# ZERONYTH v1.8.32 — audit fixes and validation scope

## Fixed in this pass

4. **Idempotent network startup:** routine `start.sh` no longer tears down the Compose project or rotates validator keys. `init-network.sh` reuses and validates complete generated state, refuses to overwrite partial state, and no longer deletes node data during initialization. The destructive reset remains an explicit `reset-network.sh` operation. The dashboard HTML no longer briefly displays a misleading localhost RPC before JavaScript initializes.

1. **Wallet RPC on remote/mobile browsers:** removed the fallback that pointed every non-`localhost` browser to `http://127.0.0.1:8545`. Remote sites now show that RPC is unconfigured unless the operator explicitly injects `window.ZERONYTH_CONFIG.rpcUrl`. Local loopback development retains a local endpoint fallback.
2. **Node runtime diagnostics:** added `pq-native/check-node-version.mjs` as the PQ lab `pretest` guard. Running tests on Node older than 24 now exits with a clear runtime message instead of emitting a large set of misleading ML-DSA key-type failures.
3. **Documentation:** README now distinguishes the local dashboard proxy from the wallet's RPC endpoint and reiterates that a public RPC/testnet is not implied by the starter kit.

## Validation performed

- ZIP integrity: original archive entries passed `zipfile.testzip()` before editing; the patched archive is rechecked separately when packaged.
- Static checks: `dashboard/assets/app.js` was checked for JavaScript syntax; the Node version guard was executed with the available runtime.
- Full PQ tests: **not certified in this environment unless Node.js 24+ is available**. The environment's Node.js 22 runtime does not support the `ml-dsa-65` key type used by this experimental lab. Run `cd pq-native && npm test` on Node.js 24+ before relying on the results.

## Known limits that remain intentional

- EVM chain ID `9127` (`0x23a7`) is a development-chain ID, not proof of a public network.
- No public RPC, public faucet, token contract, bridge/conversion, real validator rewards, remote GPU/VPS marketplace, or real AI billing is created by this ZIP alone.
- The Besu/EVM network still uses ECDSA; `pq-native/` is a separate ML-DSA research lab, not quantum-safe EVM consensus.
- The faucet's local development identity/credits must never be funded with real assets or reused as a production key.

## Operator configuration for remote wallet use

Before deploying a remote dashboard, provide a real, reachable, secured RPC endpoint through the deployment's configuration bootstrap, for example:

```js
window.ZERONYTH_CONFIG = { rpcUrl: 'https://YOUR-OPERATOR-CONTROLLED-RPC-ENDPOINT' };
```

Replace the example with an endpoint you operate and have tested; do not publish the placeholder. Inject this before `dashboard/assets/app.js` loads. Ensure CORS, TLS, chain ID, rate limiting, and RPC method exposure are configured appropriately. If the RPC is not live, leave it unset.
