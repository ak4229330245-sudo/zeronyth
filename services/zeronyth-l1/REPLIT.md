# ZERONYTH local testnet on Replit

The original starter-kit explorer is served by the `artifacts/zeronyth: web`
workflow at `/`. Its UI files remain in `dashboard/`; the React scaffold is
not the running UI. The workflow supplies the required `PORT`.

## Runtime setup

The installed standard JDK is too old for Besu 26.9.0. The native launcher uses
the official Besu 26.9.0 distribution and a checksum-verified Temurin Java 25
runtime, stored outside Git and deployment files.

If those downloaded runtimes are missing:

```sh
bash services/zeronyth-l1/scripts/setup-replit-runtime.sh
pnpm install
```

Then start the managed `artifacts/zeronyth: web` workflow. It starts four native
Besu processes with private loopback P2P ports, a loopback-only RPC, faucet and
WebRTC signaling service, plus the explorer gateway. No Docker is needed.
The original Docker bridge setup could not establish inter-container
connections in this environment.

## State and verification

- Existing validator identities and chain data are reused, never automatically
  deleted. A partial generated network fails closed.
- A fresh workspace initializes a new disposable development chain. Validator
  keys, `.env`, generated network files and node databases are ignored by Git
  and excluded from deployment output. Back them up separately if needed.
- The gateway starts only after blocks advance and all three peers connect.
- Runtime logs are in `generated-artifacts/zeronyth-logs/`.
- To check liveness through the shared proxy:

```sh
cd services/zeronyth-l1
RPC_URL=http://localhost:80/rpc bash scripts/smoke-test.sh
```

## Boundaries

This is a local, experimental development network, not a public chain.
The example faucet account is a publicly known test fixture; never send real
assets to it or reuse it on another network. Development ZNYT has no asserted
real-world value.

The preview `/rpc` gateway allows read-only methods only. Direct validator RPC
and P2P listen on loopback. The explorer supports EIP-6963/EIP-1193 browser
extensions (including MetaMask/Rabby) and injected wallets in mobile in-app
browsers, without QR or a WalletConnect Project ID. Use the wallet panel to
select a wallet, connect an address, then explicitly switch/add chain 9127.
An unknown chain can be added with the existing page-origin read-only `/rpc`
endpoint only after a cookie-free chain-ID probe succeeds. An operator may
override this with `window.ZERONYTH_CONFIG.rpcUrl`, an accessible HTTPS RPC.
No RPC write methods or CORS permissions were enabled for this feature.
If the preview requires login, blocks external callers or changes URL, external
wallet RPC access may fail even though browser account connection succeeds;
the UI reports this separately. No public-RPC availability guarantee is made.
Open the page in a separate browser tab for extensions, or use the official
MetaMask app deeplink / open the URL inside another compatible wallet app.
Local disconnect clears this page's state, not the wallet's granted site
permissions. A page reload requires connecting again; no account or key is
persisted by the explorer. Connection requests no signature or transfer.
The existing guarded-send UI uses the selected provider and invalidates review
when provider, account or chain changes. Its devnet/unaudited limitations remain.
Static dashboard edits are served immediately. Do not restart the coupled
web workflow merely to apply these files: that launcher also owns validators.
The separate PQ/AI research labs are included but are not started by this
workflow. Public deployment is intentionally not configured.

## Offline backup and isolated cryptography research

Owner-only backup/restore tools and the ML-DSA compatibility, rotation and
microbenchmark lab are documented in
`experiments/crypto-migration/README.ja.md`. The lab does not change Besu's
transaction signatures, QBFT seals or RLPx transport. Private backup archives
are not served by the dashboard and must never be published.
