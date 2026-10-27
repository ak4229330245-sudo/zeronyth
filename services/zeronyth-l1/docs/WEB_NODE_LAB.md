# ZERONYTH v1.8.6 Web Node Lab

**v1.8.7 add-on:** an optional, separate WebRTC P2P signaling/data-channel
research mode now appears in this page. This document below continues to
describe the preserved v1.8.6 **local worker** behavior. For actual browser
channel boundaries and invite-room behavior, see
[`WEBRTC_P2P_LAB.md`](WEBRTC_P2P_LAB.md).

**Status: local browser computation demo only. No public network or actual ZNYT rewards.**

## Where it lives

- Existing localhost Docker explorer remains unchanged at
  `http://127.0.0.1:8080/`.
- The new **Web Node Lab** entry in the nav opens
  `http://127.0.0.1:8080/node.html`.
- Static HTML, responsive styling and dependency-free browser modules are in
  `dashboard/node.html` and `dashboard/assets/web-node*` / `node-*.mjs`.
- No account, seed phrase, wallet permission or private key is requested.
- Nginx remains explicitly bound to **127.0.0.1**. v1.8.7's additional
  `/api/p2p/` is also localhost-only and proxies to a Docker-private,
  in-memory signaling service; it is not a public network endpoint.

## Browser lifecycle

1. The user must explicitly check the CPU-use consent box and click Start.
2. A dedicated **Web Worker** hashes a cryptographically random 32-byte seed
   a bounded number of SHA-256 iterations (8 light or 12–48 browser compute).
3. The browser's main thread **independently recomputes** the expected output
   using Web Crypto before incrementing the counter.
4. The on-screen points are **local demonstration counters only**. They reset
   on reload, cannot be redeemed, have no monetary backing, and do not call
   `ComputeMarket` or mint/move ZNYT. Real ZNYT always displays **zero**.
5. A 750ms idle interval occurs after completed jobs. Only one worker/job
   operates at a time. No arbitrary user code, file access or remote script.
6. `visibilitychange` when the tab becomes hidden terminates the worker,
   discards the outstanding job and enters a paused state. Returning to a
   visible tab automatically resumes only if the user had previously opted in
   and conditions still permit. Explicit Stop/unchecking consent disables
   automatic restart; `pagehide` stops before navigation away.
7. Job IDs and results are bound to each other. Malformed or forged results
   stop the session, and stopped/hidden sessions cannot collect late rewards.

## Platform policy and limitations

- iOS/iPadOS: `LIGHT VERIFY` only. Browser compute role is disabled. A mobile
  web app is not a 24/7 validator, not a VPS and cannot guarantee work after
  locking the screen.
- Android: `LIGHT VERIFY` is default. Compute demo additionally requires
  detectable **charging, at least 40% battery, and positively identified Wi-Fi**.
  Browser APIs may not expose this data; if missing, the UI refuses compute
  but still allows light mode.
- Desktop: light or conservative browser compute demo; still not a reliable
  full validator or always-on hosting.
- Browsers can be suspended or killed without notice; the application cannot
  guarantee immediate `visibilitychange` handling or background execution.
- `crypto.subtle`, cryptographically secure randomness and Web Workers require
  a sufficiently modern, secure browser context. Use HTTPS or `localhost`.
- This route is locally available on the Docker host only. **To use from an
  actual phone**, an operator must separately configure an audited and access-
  controlled HTTPS endpoint. No public deployment is performed by this release.
- The main chain remains existing **ECDSA-signed Besu**; the isolated PQ lab
  uses native Node 24+ ML-DSA. **Browser ML-DSA signing and authenticated real
  distributed node workloads have not been implemented**.

## Verification

```bash
node --test tests/web-node.test.mjs
node --test pq-native/*.test.mjs pq-native/test.mjs tests/*.test.mjs
python3 -m unittest discover -s tests -q
```

## Next work before claiming real participants

- Authenticated node onboarding with audited browser-compatible ML-DSA
  signature support and phishing-resistant identity display.
- Server-issued, rate-limited and signed work receipts checked by independent
  nodes. Real challenge freshness, anti-Sybil design, retries and disputes.
- A secure HTTPS origin accessible from phones; explicit operator authorization
  and independently monitored abuse/DoS controls.
- On-chain reward economics, independent network validation, persistence,
  availability proofs, slashing conditions, wallet opt-in, security audit.

Do not equate local demo points with the DEV-CREDIT accounting lab or ZNYT.
