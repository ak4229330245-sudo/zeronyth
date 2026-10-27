# Security

ZERONYTH L1 Developer Kit is an unaudited developer product, not production infrastructure.

## Local-dev protections in this package

- Only node1 JSON-RPC and the explorer are bound to the host, and both bind to `127.0.0.1`.
- Validator P2P ports are not published to the host.
- Validator nodes 2–4 do not expose JSON-RPC by default.
- The faucet has no host port; nginx proxies only `/health` and `/claim`.
- The dashboard uses a restrictive Content Security Policy and no inline JavaScript.
- Generated validator private keys and generated genesis/static-node files are excluded from release packages.
- The faucet validates chain ID, serializes transaction nonces, limits request size, and applies a per-address cooldown.

## Important limitations

- The default faucet private key is public and unsafe for real assets.
- Validator keys are generated to local disk for the devnet and are unsuitable for production custody.
- EVM transaction authentication remains classical unless an independently reviewed PQC verifier/precompile or
  account-abstraction validation path is integrated.
- `QuantumAccount.sol`, `MEVShield.sol`, and `PrivateCommitment.sol` are examples, not audited protocols.
- The included explorer is a lightweight local dashboard, not a production indexing explorer.
- The experimental multi-chain Security Lab only reviews pasted decoded JSON and cannot independently verify a
  blockchain state, reject wallet signature prompts, validate BTC output ownership or convert classical signatures
  into post-quantum signatures. High-risk and unknown findings require manual review; "no findings" is not "safe".
- The Guarded Wallet Handoff prototype applies only to an explicit native ZNYT-devnet transfer initiated through this
  dashboard. It never intercepts transactions on other websites, cannot guarantee the wallet's actual signed bytes,
  and depends on the integrity of this same web page and the injected wallet provider. It is not a defense against
  a compromised web frontend or wallet. Do not deploy for mainnet custody without independent design and audit.
- Localhost binding reduces network exposure but does not replace host security.

## Reporting

Security reports should be sent through the private support/contact channel identified in the product listing, invoice,
or purchase-delivery message. Sellers should keep that channel current and avoid requesting sensitive exploit details
through public comments or issue threads.

## Production checklist

Use HSM/KMS-backed validator keys, sentry/RPC nodes, TLS/authentication/allowlists, rate limiting, monitoring, backups,
reproducible builds, vulnerability management, independent smart-contract review, incident procedures, and an
independent infrastructure/security audit.
