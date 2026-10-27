# ZERONYTH L1 v1.8.25 — Opt-in real CPU worker pilot

## What is real in this release

- A node provider can run `LeaseCpuNode` as an **actual Node.js process**.
  It listens **only on 127.0.0.1**, with an optional operator-controlled
  SSH tunnel for access from another machine. It accepts ML-DSA-65-signed
  permits and renter work orders and launches a separate Node worker thread.
- The worker really computes a bounded series of SHA-256 hashes and returns
  a provider-signed receipt. The renter/coordinator independently recomputes
  the deterministic output before recording it in `ComputeMarket`.
- `znyt.requireExecutionProof:true` makes successful **research VPS rental
  settlement** contingent on at least one verified receipt in that rental.
  The existing ZNYT-LAB escrow then pays the provider on mutual signed usage
  approval and returns unused funds to the renter.
- A permit binds **exact chain, provider, customer and rental ID**, plus job
  count, total iterations and wall-clock expiry. Every order has per-permit
  nonce, job ID and bounded input. The agent enforces replay/aggregate quotas,
  bounded SHA-256 work (max 10,000 iterations/job and 320,000/permit),
  maximum four concurrent workers and a 5-second thread timeout.
- The agent refuses arbitrary code execution, shell commands, host file
  access, Docker commands or network operations requested by renters.

## Important distinction

**This is real bounded CPU processing, not a real remotely rented VPS.**
There are no private virtual machines, independent renter filesystems,
tenant shell, GPU service, model inference or real blockchain payment.
`ZNYT_LAB_NOT_REAL_TOKEN` remains an in-memory **simulation** and cannot be
deposited, traded or withdrawn. Signed work receipts show *reproducible
results*, not tamperproof hardware utilization or physical machine identity.
The server does not expose TLS; binding directly to the public internet is
prohibited in this pilot. The node still uses local-only, transient replay
protection; restart-safe durable billing, global rate limits and provider
admission control must be implemented before an external beta.

## How to test end-to-end in one terminal

Requires Node.js 24+ with native ML-DSA support.

```bash
node --test pq-native/lease-cpu-node.test.mjs
node pq-native/lease-cpu-demo.mjs
```

The demo creates short-lived keys, registers an eligible server provider,
escrows simulated ZNYT, connects to an actual loopback HTTP listener, runs a
real worker thread, independently verifies the signed result, and only then
releases ZNYT-LAB payment after both rental parties approve usage.

## Running a separate provider node manually

Generate a **new research-only** key **outside** the project tree in a
secure directory you own. Do not generate a new key if you need to reuse
an already-registered provider identity.

```bash
node pq-native/lease-node-keygen.mjs /absolute/secure/path/provider-key.pem
node pq-native/lease-node-agent.mjs /absolute/secure/path/provider-key.pem 19127 18888
```

The agent refuses non-owned/symlinked or group/world-readable key files.
The generated provider's public key must be used for the signed chain
device/provider registration and rental offer; otherwise work proofs cannot
unlock the correct reservation. The server accepts only:

```text
GET  http://127.0.0.1:18888/health
POST http://127.0.0.1:18888/v1/lease/execute
Content-Type: application/json
{"permit": <signed provider WORK_PERMIT>, "order": <signed renter WORK_ORDER>}
```

Never expose port 18888 directly on a public interface. An operator can use
an authenticated SSH port-forward to the same localhost listener, subject
to normal SSH host verification and account security. There is no public
onboarding, job marketplace UI or persistent metering endpoint yet.

## Gaps before real VPS / AI / ZNYT rollout

1. Real ZNYT balance, on-chain settlement and actual execution-derived gas;
   audited escrow, staking, governance voting, arbitration and slash rules.
2. Provider network identities, worker registration, real machine attestation,
   durable nonce/quota state, availability proofs and protection from collusion.
3. Isolated per-tenant rootless containers or microVMs, CPU/memory/network/disk
   quotas, resource admission, secure encrypted volumes, controlled lifecycle,
   authentication, abuse prevention and metered usage.
4. Real GPU scheduling and verified AI inference with model runtimes, secure
   prompts and capacity/billing measurements. The 20% chain / 20% AI / 60%
   rental claim stays a research reservation, not scheduler enforcement.
5. Signed usage dispute resolution and public/internet-facing API security
   review. The current pilot does not meet production hosting requirements.

This iteration is intentionally small enough to test real CPU work without
exposing infrastructure or real customer funds to unaudited remote code.
