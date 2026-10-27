# ZERONYTH v1.8.5: PC / Server / Phone / Tablet Node Model

**Research status:** all device roles below are protocol-admission simulations;
no public P2P network, installed native mobile client, real node discovery,
persisted registry, measured hardware, actual consensus vote, or token payout.

The participation rules in `device-policy.mjs` are dependency-free JavaScript
usable for future web/desktop/mobile client ports. ML-DSA-65 signing and local
registry persistence in this kit are still **Node.js 24+ research tooling**.
Using a browser or a mobile app for real ML-DSA signing requires a separate,
audited device-compatible crypto implementation. A browser tab **cannot** be
represented as a server that runs Linux VPS workloads while suspended.

## Platform roles

| Device | Allowed lab participation | Do not promise |
|---|---|---|
| Linux/Windows/macOS desktop | Signed registration; light/relay; bounded opt-in compute; fixed-genesis validator if explicitly authorized | 24/7 uptime from consumer PC |
| Linux/Windows/macOS server | Signed registration; light/relay; bounded opt-in compute; fixed-genesis validator if explicitly authorized | Any new validator can vote without governance |
| Android phone | Foreground light/relay; short opt-in work ONLY when charging, on unmetered network, not hot, and battery ≥40% | Unrestricted background execution or unrestricted CPU use |
| Android tablet | Same as Android phone, with a slightly larger job budget | Continuous validator status or background rewards |
| iPhone / iPad | Foreground light/relay only; can later receive receipts and verify records | Continuous full node, rewarded local hash mining, or resident VPS |

**Apple:** iOS/iPadOS commonly suspend apps after backgrounding except within
approved modes. App Review guideline 3.1.5(ii) restricts on-device crypto mining,
so this research version rejects the `compute` role on iOS/iPadOS. A future
legitimate app may implement permitted lightweight verification and content
distribution, subject to review—not background crypto mining.

**Android:** WorkManager can constrain future tasks by charger, network and
battery status, but that does not guarantee always-on execution. Long-lived
foreground services have notification and background-start restrictions.

## Signed identity and anti-drain checks

1. Each physical device must have its own ML-DSA key identity. `DEVICE`
   signatures lock down `deviceClass`, `platform`, `runtime`, `role`, maximum
   CPU share (≤50%) and required foreground behavior to `chainId`.
2. `HEARTBEAT` messages sign the specific device ID, increasing sequence,
   simulated chain height, active foreground, power, unmetered network, battery
   and thermal readings. Tampering and replaying the signature are rejected.
3. The optional `ComputeMarket({deviceRegistry})` filter admits only providers
   whose signed profile and recent heartbeat meet their job-size requirements.
   For Android phones, at most 256 SHA-256 iterations in a job; tablets at
   most 512. Desktop 2,000, server 10,000. Only the 95/5 prefunded
   DEV-CREDIT settlement from v1.8.4 exists; no money is generated.
4. A device advertising `validator` must already own one of the **four fixed
   genesis validator keys**. A mobile/browser node cannot become a consensus
   validator by setting a flag. The real 4-validator local process demo is
   unchanged and not connected to this device registry.
5. Device readings are **self-reported** and may be forged by the owner. The
   registry proves key ownership, not actual possession of specific hardware,
   network location, energy readings or work execution on that hardware.

## Run verification

```bash
node pq-native/device-network-demo.mjs
node --test pq-native/device-registry.test.mjs
node --test pq-native/*.test.mjs pq-native/test.mjs
```

## Remaining to make it an actual decentralized multi-device network

- Native Android and iOS/iPadOS client implementations, explicit owner opt-in,
  sandboxing, OS permission review and hardware-level test coverage.
- Modern, audited cross-platform ML-DSA signing / verification, key protection,
  hardware-backed storage where available and safe device migration/recovery.
- Real authenticated P2P/relay protocol (outbound connections for NAT/mobile),
  discovery, disconnections, deadlines, receipt proofs and offline rescheduling.
- On-chain, audited roles/staking, Sybil resistance, slash evidence and dispute
  resolution; independent validators and a public testnet are NOT enabled.
- Scheduling backed by **measured**, independently attested capacity; verified
  benchmark proofs, consumption reporting and real-world compute service APIs.
- Signed batched light proofs for phones, minimizing data transfer and battery
  impact. Light-participation incentives must be verified contribution rewards,
  not payments for self-reported idle uptime or fake heartbeat traffic.

Sources: [Apple background execution](https://developer.apple.com/documentation/Xcode/configuring-background-execution-modes),
[Apple App Review cryptocurrencies](https://developer.apple.com/app-store/review/guidelines/),
[Android WorkManager constraints](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work),
[Web service-worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope).
