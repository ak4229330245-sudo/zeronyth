# ZERONYTH L1 v1.8.26 — Provider-hosted container/GPU/AI integration (opt-in pilot)

## Precise implementation status

| Feature | Code available | Verified with physical hardware in this environment? |
| --- | --- | --- |
| Provider-owned container workspace | Rootless Docker adapter with pinned preloaded image, start/inspect and remove, strict CPU/RAM/pid/read-only/network-none limits | **No** — no Docker installed; adversarial fake-runner tests passed |
| GPU device allocation | Provider-signed, allowlisted NVIDIA GPU UUID handed to Docker `--gpus device=...`; exclusive reservation in one agent process | **No** — no NVIDIA GPU/Container Toolkit installed |
| Generative AI | Local-only Ollama `/api/generate` call with fixed allowlisted model, signed bounded prompt and token limit | **No** — no local Ollama/model installed; mock HTTP response validated |
| ZNYT payment | Same simulated ZNYT-LAB escrow; opt-in rental settlement requires signed, verified service receipt plus both parties' usage approval | **Research simulation only**; no on-chain ZNYT transfer |
| Remote customer API | ML-DSA signed tenant/provider bound requests to loopback HTTP server | Tested on local socket; **never published to the internet** |

The code can invoke real Docker/Ollama **when an operator installs those
services on a separate permitted machine**. This environment lacked all of
Docker, `nvidia-smi` and Ollama, so this package must not be described as
a demonstrated live VPS/GPU/AI rental service. A Docker container is not
a full virtual machine. This pilot does not provide tenant shell access,
persisted volumes, public IPs, firewall isolation for interactive tenants,
GPU memory isolation, independent metering or uptime guarantees.

## Resource protection

- User never chooses shell commands, Docker images, host paths, kernel
  options or devices. Only provider-approved images pinned to SHA-256 digest
  may run; image pulls are disabled.
- Docker must report **Linux rootless** mode, **cgroup v2** and **systemd**.
  An operator must still verify delegated resource controllers on the host.
- Container options prohibit outbound networking, drop Linux capabilities,
  enable no-new-privileges, restrict root filesystem to read-only, run as
  non-root UID/GID, and limit CPU, RAM, swap, processes and temporary files.
- Approved NVIDIA GPU UUID may be assigned to one active rental per
  agent process. This check is **not** durable across crashes, multiple
  agents or hosts. GPU memory partitioning and actual GPU utilization are
  **not proven** by the Docker device assignment alone.
- Local Ollama model names are allowlisted by node operator; requests use
  a bounded prompt, no streamed generations and a max output-token cap.
  Do not expose Ollama's port to customers or the public internet.
- Provider-signs a scoped permit for one chain, rental, service and
  customer, with expiry and maximum requests. Renter signs each request
  with monotonic nonce. Provider returns its signed service receipt.
- The market checks rental, identities, request IDs, response hash and
  signatures before accepting **research accounting evidence**. Proofs
  attest provider signatures, not cryptographic proof of physical GPU/VM
  execution or third-party billing honesty.

## Try without hardware (adapter integration tests)

```bash
node --test pq-native/hosted-services-node.test.mjs
node --test pq-native/unified-znyt.test.mjs pq-native/lease-cpu-node.test.mjs
```

The tests check Docker argument hardening, fail-closed rootful daemon
rejection, GPU device selection, signed order/replay protection, AI API
shape, signed result and ZNYT-LAB rental settlement. Docker and AI calls
are intentionally mocked because they cannot run in this test environment.

## Provider host setup (operator-controlled beta only)

1. Use a Linux machine dedicated to the experiment. Install and configure
   **rootless Docker**, kernel cgroup v2/systemd delegation, and pre-load
   two pinned images with an appropriate `sleep` binary. Replace example
   placeholder digests with verified local image digests. GPU nodes also
   need NVIDIA drivers and the NVIDIA Container Toolkit configured with
   rootless Docker; obtain exact GPU UUIDs from `nvidia-smi -L`.
2. Install Ollama locally on the same provider host, load an authorized
   local model, and keep port 11434 accessible only from localhost. Whether
   it uses the GPU is an independent runtime check, **not guaranteed** by
   a reserved GPU container in this pilot.
3. Use the **same provider ML-DSA private key** already registered in
   `DeviceNodeRegistry` / `ComputeMarket`, in a regular file owned by the
   process user with permissions `0600`. Never put a private key inside the
   ZIP or a public repository.
4. Copy `config/hosted-node.example.json` **outside the repository** and
   edit key path, two image digests, device IDs, allowed models and local
   resource limits. The all-zero example digests are deliberate placeholders;
   no container will start with them unless an exact local image exists.
5. Start the loopback service:

```bash
node pq-native/hosted-node-agent.mjs /absolute/path/operator-config.json
```

The listener is at `http://127.0.0.1:18889`. Operator and renter must
exchange valid `SERVICE_PERMIT` and `SERVICE_REQUEST` signatures; POST
`{"permit":{...},"request":{...}}` to `/v1/hosted/execute` for `create`,
`generate` (GPU rental only), or `stop`. The signed receipt/AI response
returns only to that caller; record it with `market.recordVerifiedHostedService`
and settle only after both rental parties' independently signed meters.
Provider may choose an authenticated SSH tunnel for a remote administrator;
no direct public port exposure is implemented or authorized.

## Remaining non-negotiable milestones

1. Actual native ZNYT balances, escrow and settlement written into consensus
   state, measured gas charges, governance and auditor-reviewed incentives.
2. Durable node/lease/nonce state, crash recovery, rental lifetimes and
   cleanup, cross-node GPU locks, usage evidence, watchdogs and dispute
   resolution. Today a process restart can forget active reservations.
3. Tenant-safe microVMs or equivalent hardened isolation, tenant access
   gateway, network/firewall policy, encrypted volumes, logging/abuse controls
   and operational security review. Docker alone is not production multi-
   tenant VPS isolation.
4. Actual GPU scheduling and per-device metering; GPU-backed model runtime
   tied to the assigned lease, independently verifiable inference credits.
5. Public marketplace UI, verified provider capacity and a payment layer.
   Do not accept deposits or rent publicly until these are complete.

Reference implementation source behavior tracks Docker's officially
documented resource limits, `--gpus` and rootless caveats and Ollama's
local generate endpoint. Physical execution must be tested on the provider
machine before making availability promises.
