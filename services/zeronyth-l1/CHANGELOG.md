# v1.8.32-safetyfix-znyt — preserve chain state on restart

- Fixed routine startup so it no longer tears down running containers or rotates validator keys.
- Made network initialization idempotent for complete state and fail-closed for partial state; no existing node data is silently deleted.
- Added a separate, explicit reset confirmation before destructive local-chain reset.
- Corrected the dashboard's initial RPC label so it does not briefly imply localhost RPC is configured.
- Added regression checks for startup preservation and reset safeguards.

# v1.8.32-safetyfix-znyt — RPC safety and runtime diagnostics

- Fixed remote/mobile wallet network configuration so an unconfigured hosted dashboard no longer points wallets at the visitor device's `127.0.0.1`.
- Added explicit operator-provided `window.ZERONYTH_CONFIG.rpcUrl` support and a clear missing-RPC error.
- Added a Node.js 24+ pretest check for the experimental ML-DSA lab to prevent misleading failures under unsupported Node versions.
- Documented validation scope and intentionally local-only / non-production components in `docs/AUDIT_FIXES_v1.8.32.md`.
- Existing features and legacy QTM/QSH references were retained; no asset conversion or deployment was performed.

# Changelog

## 1.8.28-ai-local-testnet-lab — real local model adapter and signed AI ledger

- Add an optional mobile-first ZERONYTH AI portal and a locally bound
  operator-token-protected chat API, user test-payment mode and provider
  free-inference entitlement mode.
- Execute an explicitly allowlisted localhost Ollama model only after strict
  chain-bound ML-DSA rental permits and signed customer work orders; return a
  provider-signed output commitment, bounded prompt/response and anti-replay
  usage counter. No physically attested GPU usage is asserted.
- Plug AI receipts into existing v1.8.24 ZNYT-LAB simulated escrow. Settlement
  is blocked before verified output and still requires both simulated
  provider and customer approvals. No actual testnet or mainnet funds move.
- Allow mock-bonded, eligible node-provider free AI usage, consuming the
  existing 20 requests/epoch quota only on successful local model response.
- Build ephemeral in-memory ZNYT testnet demonstration with explicit test
  balances; preserve every v1.8.27 and older function. External AI prompt
  forwarding requires user approval and is intentionally not included.

## 1.8.27-opt-in-node-discovery — opt-in signed elastic node discovery

- Add real volunteer-host hardware inventory with host-local CPU/RAM and
  best-effort NVIDIA GPU discovery, bounded CPU-load sampling and explicit
  L1/AI/VPS-GPU capacity shares (default 20/20/60).
- Add chain-bound, nonce-protected ML-DSA-65 join/heartbeat records with
  signed private identity, 0600 append-only journal/replay verification and
  online freshness monitoring; no configured global node-count cap.
- Add an operator-only localhost enrollment HTTP service with mobile-first
  dashboard, 32+ character admin bearer token, CSRF-resistant authenticated
  read APIs and never-public raw node inventories.
- Provide Linux CLI onboarding and operator instructions for running on an
  existing VPS while provider volunteers operate their own opt-in machines.
- **Security/status:** all resource claims remain unverified and unenforced.
  Enrollment does not create a real blockchain validator, actual ZNYT income,
  cloud VM/GPU rental or generative AI entitlement. No remote deployment.
- Preserve all v1.8.26 and older implementation, demos and tests.

## 1.8.26-hosted-vps-gpu-ai-pilot — opt-in Docker and local AI backends

- Add signed node-hosting operation kinds with provider-side Docker container
  creation/removal, operator-allowlisted GPU UUID allocation and bounded
  localhost Ollama generative response. The provider owns all images,
  device choices and model selection; no arbitrary tenant shell commands.
- Docker backend enforces pinned offline images, rootless Linux/cgroup v2,
  limited CPU/RAM/pids, read-only filesystem, network isolation, capability
  removal, non-root execution and no privilege elevation.
- Add signed host service receipt verification bound to research rental and
  ZNYT-LAB escrow release, plus fake-adapter adversarial tests and provider
  launch configuration / safety documentation.
- No Docker/GPU/Ollama installed for actual physical execution in this build
  environment. ZNYT remains simulated. Real VPS tenant access, microVMs,
  durable metering and on-chain money are not implemented.

## 1.8.25-signed-real-cpu-worker-pilot — signed node CPU execution and ZNYT-LAB settlement gate

- Add research `LeaseCpuNode` provider agent: real SHA-256 work in bounded
  worker threads, localhost-only HTTP, ML-DSA provider work permits, renter
  orders and independently reproducible provider-signed work receipts.
- Strict replay, per-permit budget, deadline, job count, signature, chain,
  customer, provider and rental checks; restrict worker concurrency and
  prevent arbitrary rented host-code execution.
- Add opt-in `znyt.requireExecutionProof` settlement gate: record verified
  work attached to a ZNYT-LAB VPS reservation before paying its provider on
  mutually approved meter readings. Preserve prior ZNYT gas and rewards.
- Add explicit research key-generation CLI, loopback node agent CLI, real
  socket demonstration, adversarial integration tests, and security docs.
- No physical VPS provisioning, exposed internet service, real token
  transfer, executable renter code, actual AI model or audited billing.

## 1.8.24-unified-znyt-economy-lab — one simulated ZNYT balance for fees, rentals and rewards

- Add opt-in `ComputeMarket.znyt` research mode with a single balance map
  shared by signed VPS/GPU rental payment, hypothetical gas fees and
  quorum-signed validator incentives. Gas retains configurable default 20%
  burn with 80% allocated to a validator reward pool; no implicit mint.
- Maintain node-provider mock AI access entitlement and preserve old
  GOV-LAB, GAS-LAB and DEV-CREDIT research demos as legacy test variants,
  without implying separate real-world ZNYT tokens exist.
- Add integrated adversarial tests for signed gas claims, single-ledger
  double-spend prevention, rental settlement, validator rewards, burn and
  exact supply conservation, plus a self-contained demo and scope guide.
- No actual ZNYT issuance, on-chain gas metering/burning, voting, live
  VPS, model inference or public mainnet is introduced in this release.

## 1.8.23-gas-fee-partial-burn-lab — signed hypothetical gas split and supply conservation

- Add isolated ML-DSA-65 signed GAS-LAB fee accounting proof: payer signs a
  unique operation, nonce and gas price/limit maximum; at least
  `floor(2N/3)+1` distinct genesis validators must sign the same hypothetical
  usage, price and height for it to be charged.
- Default model burns 20% of the hypothetical fee, adds 80% to a separate
  network reward pool and tracks remaining circulating simulation units.
  Burn fraction is configurable, with integer rounding down and supply
  conservation checked after every test settlement.
- Test forged signatures, double-charge replay, too-few/duplicate validators,
  divergent usage, excess customer authorization, gas budget insufficiency,
  expiry and zero/100% burn bounds.
- **No actual gas accounting is yet connected to the native ML-DSA transfer
  pipeline; the Besu EVM devnet remains zero-base-fee and unchanged. No ZNYT,
  real governance token or on-chain money is burned.**
  [Implementation boundary](docs/GAS_FEE_BURN_1_8_23.md).

## 1.8.22-node-provider-ai-access-lab — signed AI access for bonded node operators

- Add separate ML-DSA-65 chain-bound, nonce-protected `AI_ACCESS` requests and
  mock non-billable AI service entitlement for active, validator-capacity-
  countersigned native server/desktop compute providers, even when the provider
  has not chosen to contribute its node to community AI training.
- Research access is 20 signed mock requests per 10 simulated block heights.
  Reject duplicate request IDs, expired/ineligible providers, offline devices,
  forged signatures, replayed nonces and exhausted per-provider quota.
- Show eligibility, remaining quota and `realInferenceAvailable:false` in a
  read-only status API. Add adversarial/renewal tests, include entitlement demo
  and preserve the separate GOV-LAB rental and DEV-CREDIT hash-work ledgers.
- **No model inference, actual generated answers, live node provisioning,
  decentralized quota storage or real token rewards** are activated.
  [Design and limits](docs/NODE_PROVIDER_AI_ACCESS_1_8_22.md).

## 1.8.21-node-resource-split-lab — opt-in L1 acceleration and community AI resource budgets

- Extend signed node-provider resource commitments with independent L1
  transaction preverification/relay and generative-AI-training budgets.
  Suggested initial per-node allocation: 20% chain + 20% AI + 60% remaining
  for VPS/GPU marketplace offers; the signed shares are configurable,
  time-limited, and never exceed 100% together.
- Quantify claimed CPU in millicores, RAM in MiB and theoretical GPU allocation
  in thousandths. Prevent active rental/job overbooking when signed allocations
  change; prevent new whole-GPU bookings from overlapping partial AI GPU
  commitments without enough remaining whole GPUs.
- Add opt-in provider share/status APIs, test coverage for capacity isolation,
  signature replay, unauthorized changes, combined percentage limits and
  expiry; preserve independent governance GOV-LAB and legacy DEV accounting.
- **No measured speed increase, external node worker execution, actual
  generative-AI model training, GPU partitioning or validator quorum changes**
  occur in this release. [Scope and production plan](docs/CHAIN_AI_RESOURCE_SPLIT_1_8_21.md).

## 1.8.20-vps-ai-gpu-rental-market-lab — VPS/AI GPU bookings and GOV-LAB research rewards

- Add chain-scoped ML-DSA-65 signed `vps` CPU/RAM/disk and `ai-gpu`
  CPU/RAM/GPU/VRAM rental offers to the isolated native research compute market.
  Only bonded, multi-validator capacity-countersigned, registered native
  desktop/server providers with eligible heartbeat may publish offers.
- Add customer-signed reservation, provider capacity overbooking rejection,
  separate pre-funded **GOV-LAB** test-balance escrow, dual-signed usage
  settlement with 5% simulated treasury fee, unused-token refund, early customer
  cancellation and automatic full refund after term expiration. Legacy
  non-transferable DEV-CREDIT hash jobs and rewards retain their own ledger.
- Add genesis-validator ML-DSA-signed **mock** round rewards from an explicitly
  pre-funded GOV-LAB reserve (no unbounded minting). Quorum, duplicate identity,
  round replay, mismatched block ID and exhausted reserve are rejected. Mock
  certificates do not independently prove real block finalization.
- Preserve all existing compute job paths and accounting; check conservation
  over both job and rental escrow. Add adverse signature/replay/availability
  and clock-drift tests plus two-service repeatable local demonstration.
- Bound active offers per provider and concurrent research rentals. Provider
  enrollment itself retains no fixed global node-count cap.
- **No actual governance token, decentralized governance voting, VM provisioning,
  GPU execution, independently verified physical capacity/usage/consensus,
  production rental tenancy, real payments, or public release.**
  [Details and requirements](docs/RESOURCE_RENTALS_1_8_20.md).

## 1.8.19-elastic-node-membership-lab — variable-genesis quorum and elastic device registration

- Generalize the native ML-DSA-65 research genesis committee from exactly
  four to size `N>=4`, bounded by total 1 MiB genesis bytes, with correct
  `floor(2N/3)+1` independent quorum signatures in consensus, order logs and
  DEV-CREDIT capacity registration. Keep all signatures, state transitions,
  journal durability and anti-equivocation checks unchanged.
- Generalize localhost direct-peer and mutual-TLS private validator config to
  genesis-ordered variable member counts; disposable process benchmark supports
  `--validators 4..16` (bounded to prevent uncontrolled local process spawning).
- Remove 128 device/64 compute-provider enrollment ceilings in research maps.
  Add signed device leave/rejoin with replay-safe advancing nonces and bounded
  paginated membership listing; schedule providers in linear time without
  allocating and sorting all providers on every request.
- New adversarial and scalability tests for 7-validator/5-signature ordering,
  14-validator/10-signature transaction finality, 129 signed devices, 65 bonded
  providers, forged leave rejection and dynamic private TLS peer pin lists.
- Explicitly **do not** claim live validator additions, epoch reconfiguration,
  permissionless public P2P, persistent device membership or sustained 5,000
  TPS. The old four-validator Besu/EVM network and bounded WebRTC room remain.
- [Details, demonstrations and safety boundaries](docs/ELASTIC_NODES_1_8_19.md).

## 1.8.18-quorum-single-pass-fast-path-lab — verified TLS quorum fast path

- Add an optional `--single-pass` fast path to the private mutual-TLS
  four-validator laboratory: omit redundant separate pre-admission HTTP calls,
  **not** independent ML-DSA verification or signed quorum voting.
- Reuse the proposer-only exact previously fully authenticated and serially
  executed block candidate when its signed bytes, parent height/head and state
  root match the sealed block proposal. Invalidate on every commit; preserve
  peer verification, anti-equivocation and all-four fsync receipt requirements.
- Add phase timing, fair alternating three-run quorum benchmark, invalid ML-DSA
  transaction rejection, mutated block and forged root regression tests.
- On one host over three short runs, old preverification + quorum measured
  **642.8 TPS median** versus **755.5 TPS median** with the optional fast path
  (~1.18x). Sequential client signing was not included in those two metrics.
  Fully distributed, sustained 5,000 TPS is **not** achieved; no safety audit,
  public deployment or genuine four-VPS benchmark is claimed.
- Detailed results: [docs/QUORUM_FAST_PATH_1_8_18.md](docs/QUORUM_FAST_PATH_1_8_18.md).

## 1.8.17-private-tls-validator-peers-lab — private-address mutual TLS transport

- Preserve every v1.8.16 and older Besu/EVM, ML-DSA ordering, wallet,
  WebRTC/browser nodes, signature worker, reward and safety-lab feature.
- Add **opt-in** fixed-genesis private-VPN validator communication over TLS 1.3
  with mandatory mutual client authentication, per-genesis validator certificate
  pins, verified DNS SAN and exact private IP listener/peer allow-list.
  TLS key/CA/config files must be absolute, regular, bounded 0600 files,
  opened without following symlinks. Private and localhost modes conflict.
- Keep independently verified ML-DSA proposer/transaction/vote signatures,
  canonical account state checks, 3-of-4 quorum certificates, fsync journals,
  four matching durable commit receipts and clean error handling unchanged.
- Add disposable four-process OpenSSL certificate benchmark, TLS keep-alive,
  private endpoint and duplicate identity rejection tests, plus intentionally
  swapped (but CA-signed) peer certificate rejection. No keys packaged.
- A single 1,536-tx one-machine TLS sample gave ~537.9 validator admission+
  consensus+fsync tx/s versus ~506.4 without client TLS connection reuse.
  These samples do not verify a general speedup or 5,000 TPS. No independent
  remote hosts, public P2P/testnet, view change, secure post-quantum TLS or
  production deployment have been provided.


## 1.8.16-loopback-validator-peer-lab — direct four-validator local ML-DSA quorum

- Add opt-in direct validator-to-validator localhost messaging: the rotating
  elected proposer sends a complete ML-DSA block to three independent peers;
  each independently stages, checks the full state transition and returns an
  fsync-protected signature vote. The proposer authenticates identities,
  verifies the signatures and sends a 3-of-4 certificate to every validator.
- Require all four independent durable commit acknowledgements to match before
  reporting success, preserving strict per-validator anti-equivocation vote
  journals, canonical serial checks and verified block replay on restart.
- Bind only to loopback, hard-check four unique genesis-ordered ports and keep
  peer endpoints **disabled by default**. No public P2P, production BFT view
  changes, independent operator hosting or safe remote transport is added.
- Add full local two-block/restart regression and negative peer-config test;
  compare measured end-to-end local consensus with the preexisting coordinator.
  One 1,536-transfer sample measured 609.8 vs 597.6 local tx/s with independent
  admission and fsync, too little evidence to claim a stable speedup. Optional
  redundant worker execution can be slower. The separately demonstrated ~6,197
  execution-only tx/s is **not** consensus/network throughput; 5,000 public
  network TPS remains unverified.


## 1.8.15-cpu-aware-fast-path-lab — bounded worker tuning + cheaper replay key

- Preserve the full v1.8.14 native ML-DSA 3-of-4 ordering, separate deferred
  execution and WAL, strict signature prefetch, canonical state cross-check,
  along with all previous private Besu/EVM, wallet and P2P/browser features.
- Default to a bounded hardware-informed native-lab worker count (up to 4,
  based on `os.availableParallelism()`); manual 0–8 worker settings are kept.
- Eliminate an extra per-transaction JSON hash for *in-batch replay* by using
  the fully verified sender/nonce tuple. Strict cryptographic signed-byte
  fingerprints, nonce transitions, signature checks and state roots stay.
- Emit separate local execution/verification versus durable state-write
  timings. Support optional `1`–`8` worker benchmarking without touching
  production network code or relaxing Byzantine safety requirements.
- Add conflicting signed nonce and auto-worker-budget regression tests.
  Three measured 4-worker **execution-only** 1,536-transfer local runs on a
  9-logical-CPU environment yielded median ~6,196.8 executed tx/s versus
  ~3,381.2 serial, all with exact state-root equality. No sustained real
  distributed/public L1 TPS assertion is made.

## 1.8.14-signature-prefetch-pipeline-lab — signed crypto worker pipeline

- Preserve every v1.8.13 and earlier function: private Besu/EVM/QBFT,
  security modules, WebRTC/browser P2P, native ML-DSA-65 order quorum,
  deferred execution, delta WAL and recovery, and transaction-level workers.
- Extend the isolated asynchronous execution lab with 0–8 bounded ML-DSA
  signature workers. Full cryptographic verification, chain ID and exact
  signed sender/nonce/value binding still precede executable state changes.
  Bad signatures, modified signed fields and worker errors fail closed.
- Run speculative account-disjoint worker execution concurrently with the
  mandatory canonical sequential state calculation and verify exact roots
  before fsync. Add opt-in pool readiness (`prepareExecution`) and a bounded
  one-certified-height signature prefetch overlapping earlier execution;
  state and finality remain one-height-at-a-time.
- Add corrupt-worker, invalid-signature and future-block prefetch tests plus
  disposable single-block and three-block speed demonstrations. Three
  1,536-transfer local execution-only repetitions showed ~4,882.4 median
  warmed-prefetch tx/s vs ~3,411.0 median serial tx/s, with variation.
  No public P2P, real EVM, production BFT or 5,000 TPS achievement is claimed.

## 1.8.13-parallel-transaction-lab — bounded, conflict-aware execution workers

- Keep v1.8.12's independent ML-DSA 3-of-4 ordering, fsync order/state
  journals and full signed-transaction recovery, plus all previous Besu/EVM,
  wallet, browser P2P, security, and node participation features.
- Execute disjoint sender/recipient transfer groups concurrently inside the
  native lab's `executeNext()` using two lazy worker threads by default for
  batches of at least 32 transactions. Keep dependent transfers serial and
  nonce-ordered. Configure 0–8 workers and 2–1536 min-batch threshold.
- Require every speculative worker result to match a separate canonical
  sequential state-root calculation BEFORE any durable state or height change.
  Reject forged roots, worker errors and concurrent ordering/execution writes.
  Always persist only changed accounts and re-verify on restart.
- Add 64-transaction real-worker and 32-transaction conflict-fallback tests,
  forged worker-root detection, bounded-setting tests, documentation and an
  optional disposable serial-vs-parallel timing demo. No production EVM/P2P
  change or claimed TPS improvement; small measured batches can be slower.

## 1.8.12-async-ordering-delta-state-lab — two durable research lanes

- Preserve every v1.8.11 feature, the ordinary Besu/EVM/QBFT chain, all
  wallet/security modules, WebRTC P2P and optional 10-block preview.
- Add isolated ML-DSA-65 ordering certificates with 3-of-4 distinct validator
  votes, per-validator durable anti-equivocation journals and a chained
  fsync-backed **ordering-only** log. Ordering height can safely advance
  ahead of executed height without modifying account balances.
- Add a separate bounded changed-account write-ahead log; verify signatures,
  chain ID, balances and nonces in the original sequential execution engine,
  then fsync account deltas before publishing state.
- On restart, revalidate every ordering signature and independently re-execute
  each certified completed order from genesis, checking all saved state roots.
  Reject malformed data, fraudulent rehashed state, conflicts, concurrency
  and WAL truncation. Include nine targeted security tests and a five-block
  restart-and-catch-up demonstration.
- Do not enable this unfinished BFT research as production consensus. No
  multi-host transport/view-change, real EVM execution, MonadDb replacement or
  sustained 5,000 TPS claim. Document liveness/invalid ordered-tx limitations.

## 1.8.11-pipelined-execution-lab — fail-closed, opt-in ten-block state lookahead

- Preserve v1.8.10 performance work, every current private Besu/EVM feature,
  browser P2P, security module, signed device accounting and ML-DSA quorum.
- Extend the bounded pre-admission queue with an optional two-worker
  non-authoritative state preview of up to ten signed, ordered candidate
  blocks on a separate in-memory ledger fork.
- On every predicted height, independently calculate the serial state root
  and compare against speculative parallel account execution. Queue/head
  mutation, invalid signatures, invalid nonce or a mismatched root fail
  closed. Forecasts are never used to authorize a vote or skip block checks.
- Add a reproducible ten-block demonstration and tests for 10-height replay,
  diverging real head, invalid signed bytes, low-quorum non-commit and
  independent-account parallel execution. Keep one-block-at-a-time real
  finality and full durable state validation. No public EVM/P2P performance
  increase or actual asynchronous consensus/execution is claimed.
- Document the missing prerequisites for true optimistic transaction OCC,
  deferred execution BFT safety and storage-engine profiling.

## 1.8.10-pq-keypath-optimization — verified public-key path speedup

- Preserve all v1.8.9 research profiler, existing Besu/EVM private-chain
  functionality, browser P2P, safety checks, node rewards lab, durable ML-DSA
  block journals and the independently verified 3-of-4 validator quorum.
- Reuse the deterministic public address only after its canonical ML-DSA SPKI
  has passed full type/encoding validation; retain bounded key cache eviction.
  Cryptographic signature checks, nonce/replay, balances and signatures on
  votes/proposals are unchanged and never omitted.
- Cache PUBLIC SPKI for already validated in-memory private signer KeyObjects
  with weak references, avoiding repeat public-key derivation on each signed
  transfer/vote. Do not cache private key bytes or signed verdicts.
- Reuse an already calculated full-signed-transaction fingerprint on a positive
  signature cache miss, instead of hashing the same signed bytes again.
- Final local two-run sample showed median 599 TPS sequential and 656 TPS
  optional parallel with serial cross-check. A separate three-run sequential
  two-worker comparison yielded median 761 TPS. Values varied substantially
  and are **not** a sustained or independent
  distributed network benchmark, nor 5,000 TPS. Default execution and worker
  configuration stay unchanged pending controlled multi-host testing.

## 1.8.9-pq-performance-profiler — bounded four-process research phase measurements

- Preserve v1.8.8 independent-host Besu setup, v1.8.7 WebRTC browser P2P,
  all wallet/security and local explorer functions, plus every ML-DSA quorum,
  signed accounting and durability invariant.
- Add a fail-closed reproducible four-process localhost benchmark runner that
  compares sequential execution versus parallel account execution guarded by
  a full serial state cross-check, across bounded repeated trials.
- Report median inclusive local research TPS, client-signing-inclusive TPS,
  signed mempool verification/proposal/stage/vote/fsync-commit phase timing
  and the variability of samples. Refuse forged/malformed benchmarks, claims
  of 5,000TPS verification, or unsafe unbounded workload sizes.
- On the observed two-sample 1,152-transaction workload, measured ~562 TPS
  sequential and ~598 TPS parallel locally; another sample favored sequential.
  Do not enable the optional parallel path by default based on this noise.
  No public/multi-host benchmark, real Besu/EVM TPS or 5,000/10,000 TPS claim.

## 1.8.8-independent-validators-lab — four host private VPN QBFT topology

- Preserve every existing local v1.8.7 explorer/faucet/wallet/security feature,
  WebRTC browser P2P transport, and isolated ML-DSA research/reward modules.
- Add an explicit 4-host private IPv4 validator exporter that uses the *same*
  generated genesis and distinct Besu keys, with one sealed private bundle per
  assigned operator, and static enodes for the other three hosts.
- Each independent-host Docker Compose configuration binds P2P TCP to its VPN
  address and JSON-RPC to localhost only; disables discovery, pins Besu version,
  persists chain data and restarts on non-user-initiated host/container reboot.
- Add local read-only 3-of-4 QBFT liveness checks and regression tests for
  key isolation, output overwrite prevention, address validation, and rollback
  safety. Release builder/verifier now exclude/reject all generated operator
  private bundle directories.
- No public deployment, real 4-host runtime benchmark, dynamic validator
  admission, smart contract ZNYT payment, or replacement of ECDSA with ML-DSA.

## 1.8.7-browser-webrtc-p2p-lab — invitation-based direct browser connections

- Preserve the existing v1.8.6 foreground Web Node Lab, local private EVM/Besu
  explorer/faucet/wallet, and all native ML-DSA transaction, validator and
  research-reward experiments without replacing or disabling them.
- Add a small, in-memory Docker-private SDP/ICE signaling service, temporary
  authenticated room memberships, bounded queues, leases and rate limits.
  The browser endpoints are exposed only through the existing localhost-bound
  Explorer at `/api/p2p/`; no public hosted service has been deployed.
- Add opt-in WebRTC `RTCDataChannel` to the Web Node Lab. It negotiates an
  encrypted peer channel with room participants, sends tiny SHA-256 challenges,
  independently verifies returned proofs, and shows *actual connected peer*
  counts separate from room membership. Hidden tabs and revoked consent stop
  participation. Real ZNYT remains zero.
- This is a transport demonstration, NOT blockchain node P2P, consensus,
  ML-DSA authenticated browser peer identities, network rewards, or a
  geographically distributed network. Cross-network traversal may require an
  optional operator-managed STUN/TURN arrangement; no TURN is bundled.

## 1.8.6-browser-node-demo-lab — mobile-first opt-in foreground Web Node screen

- Preserve the prior local Besu QBFT explorer/faucet/wallet and all isolated
  v1.8.0–1.8.5 ML-DSA, testnet node and reward research functionality.
- Add a responsive Japanese-language `/node.html` Web Node Lab entry in the
  existing Explorer, with start/stop, consent gate, desktop/mobile detected
  presets, active/paused/failure state and compact performance/reward readouts.
- Implement bounded Web Worker SHA-256 demo jobs and **independent Web Crypto
  verification** in the main thread. Only verified outputs increment clearly
  labeled **local simulation points**. Real ZNYT is always zero; no wallet
  connection, actual remote work, private keys or server-side payout API.
- Stop foreground worker upon tab visibility loss, explicit Stop, consent
  withdrawal or page navigation. Discard late asynchronous work on stop,
  and automatically resume only previously opted-in visible sessions.
- Keep iOS light-only; Android browser compute requires supported charging,
  sufficient battery and positively verified Wi-Fi. Limit job/CPU effort and
  preserve localhost-only Docker bind and restrictive CSP with worker-src.
- Add Web Node hash/session lifecycle tests and updated build documentation.

## 1.8.5-pq-multidevice-node-lab — signed four-class device participation

- Preserve all prior ZERONYTH v1.6–1.8.4 modules and completed releases.
- Add dependency-free policy engine for four device classes (server, desktop,
  phone, tablet), signed ML-DSA device enrollment and replay-resistant, bounded
  availability heartbeats. A device must opt into a role; capacity and device
  status are explicitly **untrusted self-reports** pending independent attestation.
- Add optional device-aware rewards scheduler: mobile hash simulation requires
  Android, foreground, charging, unmetered network, sufficient battery, safe
  temperature and a small bounded job. iOS/iPadOS may join light/relay simulations
  but local rewarded compute stays disabled due to Apple platform policy.
- Enforce fixed-genesis validator identities: enrolling a phone or unknown
  desktop never grants consensus voting rights. Background service/VM/P2P/mobile
  apps remain unimplemented. Existing v1.8.4 clients retain legacy behavior
  unless explicit device-aware scheduling is enabled.

## 1.8.4-pq-node-rewards-lab — verified development-credit rewards and ten-candidate admission

- Preserve all previous versions and existing Besu/EVM, Security Lab, native
  ML-DSA signatures, 3/4 quorum and fsync-journal features unchanged.
- Add isolated **signed node registration**, 3-of-4 unique ML-DSA validator
  **claim attestations**, locked stake, non-transferable prefunded DEV-CREDIT
  job escrow, independent deterministic SHA-256 proof verification, 95/5 reward
  split, fraudulent-result stake penalties, expiry refunds, and total-funds
  conservation auditing. Reject unverified or cross-chain signatures.
- Add capped **10-candidate ML-DSA admission queue** with two signature workers;
  certified block execution/finality remains strictly sequential. No 10-block
  simultaneous commitment and no new achieved network TPS are claimed.
- This is an in-memory local simulation with no real CPU/GPU leasing,
  no on-chain ZNYT rewards, no public validator onboarding and no mainnet-ready
  slashing/governance. Hardware attestation is validator-signed *claims only*.

## 1.8.3-pq-durable-parallel-lab — fsync-certified chain recovery and shadow-checked execution

- Retain prior v1.6 Besu/EVM/Security Lab and v1.8.0–1.8.2 experimental PQ functions; preserve past ZIPs.
- Add exclusive-writer, append-only SHA-256-linked block journal (512MiB research bound),
  fsync before applying a certified commit, owner-only files and strict startup
  recovery that revalidates every transaction/proposer/vote ML-DSA signature,
  current nonce, balance, chain ID, previous block and state root.
- Fail closed on truncated/corrupt/wrong-genesis records and concurrent journal access.
  Clean shutdown removes the owner lock; after an abrupt crash, a stale lock
  must be reviewed manually before recovery (not an automatic unlock).
- Add opt-in worker-thread account execution with deterministic conflict
  components. Any shared sender/recipient remains serialized in original order.
  **Both leader and validator always compare speculative state with full serial
  execution before treating it as valid.** This safety gate can cost more CPU.
- Add a four-process test that restarts all validators after the first certified
  block and proves identical resumed state and subsequent leader progression.
- Add explicit BFT leader view-change safety requirements; **unsafe timeout
  rotation and production P2P are NOT enabled** pending persistent locks,
  authenticated transport, adversarial network simulation and external audit.
- Extend ZIP content checks to forbid PQ block journals, lock files and keys.
  Observed ~507 local TPS (4,000 transfers, 4 blocks, fsync persistence and
  prior signature admission counted), compared with ~581 in the older volatile
  v1.8.2 lab. No 5,000 TPS or independent distributed BFT claim.

## 1.8.2-pq-parallel-security-lab — independent parallel verification and staged quorum

- Keep every v1.6 EVM/Besu/security feature and the v1.8.0/v1.8.1 isolated PQ lab unchanged in released ZIPs.
- Add bounded, CPU-parallel ML-DSA-65 signature preverification with strict per-validator
  signed-byte binding; no peer may import another node's verification result.
- Cache only independently verified exact signed transactions, retaining fresh nonce,
  balance, state-root and proposer/certificate validation at block execution.
- Stage at most one fully verified signed block per height and then reference its hash
  for 3-of-4 validator votes and commits; refuse unstaged, divergent, or tampered blocks.
- Add optional `--preverify`, `--compact`, and `--blocks` modes to an honest localhost
  multi-block load test, with separate signature, proposal, stage, vote and commit times.
- Added security tests for forged cached transactions, invalid worker signatures,
  worker recovery, conflicting proposals, and incomplete quorum certificates.
- Observed on one machine: roughly 601 local TPS for one 1,500-tx compact block;
  581 local TPS across 4 blocks of 1,000 with parallel preverification included.
  **5,000 TPS was not reached or certified; neither path is production consensus.**

## 1.8.1-pq-perf-security-lab — bounded workload / fail-closed validator journal

- Preserve all v1.6 app/chain features and all v1.8 PQ experimental modules.
- Extend the isolated PQ-native lab capacity from 32 to at most 1,536 transactions per block,
  with a strict 16 MiB canonical body cap and bounded localhost HTTP input sizes.
- Cache only validated ML-DSA keys and exact prior-state-matched proposal verdicts;
  changed transaction bytes, proposer signatures, domain or chain head always trigger revalidation.
- Add `fsync`-backed per-validator vote journal to reject conflicting proposals/votes across local process restarts.
- Parallelize localhost vote collection/commit broadcast, add independent negative-security tests,
  in-memory CPU benchmarks and local four-process load test capability.
- Actual observed local batch throughput is below the aspirational 5,000 TPS goal.
  No production BFT, EVM-native PQ conversion or sustained TPS claim.

## 1.8.0-pq-lab — ML-DSA-only transfer and validator certificate research

- Preserve the v1.6 Besu, EVM, explorer, faucet, security scanners and guarded wallet features.
- Add separate `pq-native/` with real NIST ML-DSA-65 signed transfers,
  deterministic in-memory balance transitions, signed leaders, and 3-of-4 ML-DSA votes.
- Four individual loopback validator processes demonstrate successful cryptographic agreement.
- Not a Besu/EVM or QBFT fork, not a public network and not a security audit.

## 1.6.0 — Safe signature defense prototype / guarded wallet handoff

- Flag Safe EIP-712 `SafeTx` DELEGATECALL, recipient/domain mismatches, unverified nested contract calls,
  unknown Safe operations and unsigned/domain-incomplete previews.
- Add a synthetic Safe signing attack demo to the local security panel.
- Add an explicit, opt-in wallet handoff for plain native ZNYT transfers on local chain 9127, blocking
  mismatched requested/independently verified recipients, form/account/chain changes, non-empty calldata
  and known contract destinations before opening the wallet prompt.
- Preserve existing chain, faucet, explorer, contracts and v1.5.0 preview functionality; no automatic
  signature or broadcast is triggered without an explicit user click.
- Add offline tests for fail-closed behaviour, simulated wallet providers, and SafeTx malicious operation detection.

## 1.5.0 — Additive multi-chain Security Lab prototype

- Add an entirely client-side, read-only decoded-transaction preview for EVM/BNB/ZNYT, Solana, and Bitcoin.
- Flag unlimited ERC20/BEP20 allowances, NFT operator approvals, unexpected token/coin recipients, SOL authority changes and delegates, unknown instructions, BTC extra outputs and excessive fee shares.
- Keep undecoded calldata, typed signatures, change ownership, and absent context explicitly unresolved rather than implying they are safe.
- Add sample transactions, responsive UI, Node.js offline tests and an honest security roadmap.
- Preserve existing local Besu/QBFT chain, explorer, developer faucet, and all contracts; do not modify native transaction signature rules.

## 1.4.0 — Release reproducibility and safety pass

- Prevent validator identity deletion/regeneration while the Compose project is running; safe restart now stops the stack before reinitialization.
- Add `scripts/doctor.sh` preflight checks for Docker/Compose, required tools, and localhost port conflicts.
- Remove fixed `container_name` values so multiple projects/environments do not collide by container name.
- Add `no-new-privileges` hardening and an init process for the faucet container.
- Upgrade the faucet to ethers 6.17.0 and add a checked-in npm lockfile; Docker builds now use `npm ci`.
- Validate the configured faucet private key/address pair, bound the transaction queue, require JSON content type, emit Retry-After on cooldown, and add graceful shutdown.
- Add nginx request limiting and Permissions-Policy/form-action CSP hardening.
- Strengthen faucet E2E to require a successful transaction receipt and test content-type rejection.
- Enforce owner/guardian role separation in `QuantumAccount` and rotate the PQC key commitment atomically on ownership transfer/recovery.
- Pin GitHub checkout/setup actions by immutable SHA, pin Ubuntu 24.04 and Python 3.13.16, and use an exact artifact-uploader release.
- Replace rsync/zip packaging with a deterministic Python ZIP builder and verify reproducible SHA-256, unsafe paths, symlinks, generated secrets, and executable bits.
- Improve Windows Git Bash discovery for common per-user and x86 install locations.

## 1.3.0 — Automated full-stack verification

- Add GitHub Actions full E2E verification on push, pull request, and manual dispatch.
- Compile all Solidity examples with the pinned `ethereum/solc:0.8.24` container.
- Boot fresh four-validator Besu/QBFT networks in CI and verify block progress, validator count, and peer connectivity.
- Exercise explorer security headers and the nginx JSON-RPC proxy.
- Send a real 100 ZNYT faucet transaction, wait for mining, verify the exact balance delta, and confirm cooldown enforcement.
- Verify all six Compose services are running during E2E.
- Add release ZIP inspection to reject generated validator material, `.env`, generated genesis/static-node metadata, and caches.
- Upload non-secret CI diagnostics on all runs and tear down test volumes afterward.
- Add CI operating documentation and accurate marketplace wording for the `CI verified` claim.

## 1.2.0 — Hardening and correctness pass

- Correct QBFT `mixHash` to the Besu-required Istanbul/QBFT value.
- Activate Shanghai at genesis and pin Solidity examples to 0.8.24 for opcode compatibility.
- Enable `zeroBaseFee` explicitly and replace the extreme block gas limit with a 30,000,000 devnet limit.
- Keep validator P2P ports private to Docker; publish only node1 JSON-RPC on localhost.
- Remove host RPC exposure from validators 2–4 and use the Besu enterprise/private profile + FULL sync.
- Generate per-node static peer lists that exclude self-peering and emit validator metadata.
- Replace macOS-incompatible `mapfile` usage and add real Windows Git Bash/WSL launch paths.
- Add RPC readiness waiting before live smoke tests and portable SHA-256 release generation on macOS/Linux.
- Harden faucet request parsing, chain validation, nonce handling, cooldown races, memory cleanup, and exposure model.
- Refactor dashboard to external JS/CSS, safe DOM updates, timeouts, and a restrictive Content Security Policy.
- Fix stale social-recovery takeover risk by invalidating recoveries across owner/guardian configuration epochs.
- Domain-separate commit/reveal and commitment helpers by chain and contract address.
- Clarify ML-DSA adapter hashing and algorithm-availability checks.
- Replace the placeholder resale license with a concrete commercial source-license text.
- Expand offline package tests and documentation.

## 1.1.0 — Explorer + faucet

- Add local explorer, wallet onboarding, faucet, logo, and storefront preview assets.

## 1.0.0 — Buyer-ready starter kit

- Pin Hyperledger Besu to a fixed release.
- Add bootstrap/reset/status/validation helpers, optional prefunding, docs, security notice, packaging, and tests.

