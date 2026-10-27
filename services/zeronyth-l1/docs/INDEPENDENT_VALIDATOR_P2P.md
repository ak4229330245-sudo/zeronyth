# ZERONYTH v1.8.8: independent-host QBFT P2P (private experimental mode)

**Status:** Generates configurations for four separate operators with direct
Besu P2P over a pre-existing **private VPN**. The network is **not deployed**
by this release. It remains a classical ECDSA/QBFT devnet; it does not turn the
isolated ML-DSA research ledger into an interoperable EVM consensus engine.

## Goal: the founder's PC can be off

Each validator runs on its **own physical or virtual host**, preferably with
separate operators, cloud accounts, power supplies and network providers.
With four configured QBFT validators, a healthy 3-of-4 set can maintain quorum
after **one** validator goes offline, subject to actual latency, network
connectivity and safe consensus configuration. Two offline validators will
normally stop new block finalization. If all four validators run only on the
founder's PC, switching it off still stops the network.

The browser WebRTC research client (`node.html`) is **separate** from these
validator P2P connections. Mobile web participants are not consensus validators.

## Prerequisites and security

1. Four machines, each with Docker Engine + Compose v2 and enough persistent
   storage. Start with an **isolated testnet containing zero real assets**.
2. A preconfigured, access-controlled VPN (e.g. WireGuard) so each machine
   has a unique, stable RFC1918 IPv4 address accessible to the other three.
3. Firewall: allow **TCP 30303 only between the other validator VPN addresses**.
   Never put the validator private keys, P2P port or host's localhost JSON-RPC
   endpoint on public websites. Docker publishes RPC only to `127.0.0.1`.
4. One trusted initial administrator creates the four validator identities and
   genesis **once** using the existing local initialization procedure on an
   offline/controlled computer. Do not do this on a chain that contains assets
   or existing live operator state. Never send one operator another operator's
   private key.
5. Besu's static peer configuration periodically reconnects to a configured
   peer even after failures, but it is not permissionless node discovery. The
   initial four validators remain fixed unless separately governed and changed.

## Offline preparation on the trusted setup machine

Inside the unmodified starter kit, first generate fresh devnet validator data
using the existing `./scripts/init-network.sh` (requires Docker, creates keys,
and **resets** the local devnet; only use in an initial disposable environment).

Run a second, explicit export step with the *actual assigned* VPN IPv4s:

```bash
python3 scripts/prepare-remote-validators.py \
  --hosts 10.17.0.11 10.17.0.12 10.17.0.13 10.17.0.14
```

Replace these four **example** addresses with the VPN IPs belonging to
operators 1..4. All must already be allocated and reachable. The exporter:

- Validates source genesis/chain ID, four distinct public/private key files,
  four distinct private IPv4 addresses and the *absence* of any prior output.
- Creates a new **`network-hosts/`** directory with permission `0700`, and
  four `node1` .. `node4` directories. Each has its exact genesis file,
  `compose.yaml`, `.env` containing the assigned VPN IP,
  `data/static-nodes.json` for the **other three** nodes and its **one** Besu
  `data/key` (`0600` permission).
- Writes a public `manifest.json` containing chain identity and enodes, but
  does **not** print or package keys. If output already exists, it fails without
  altering any previous deployment. It never contacts servers.
- Excludes the *entire* `network-hosts/` directory from Git and release ZIPs.
  Treat the directory as sensitive and transfer each bundle individually over
  a verified encrypted channel to its corresponding independent operator.

**Never run `scripts/start.sh` on an existing distributed chain.** That local
development launcher calls the initializer and recreates all validator keys.
Use the generated per-host Compose file on each assigned remote host instead.

## Per-operator startup

After securely transferring exactly that operator's node directory:

```bash
cd node1
docker compose -f compose.yaml config --quiet
docker compose -f compose.yaml up -d
docker compose -f compose.yaml logs -f validator
```

Repeat independently for node2, node3, and node4 on different hosts. The
Docker published TCP P2P port binds only to the operator's assigned **VPN IP**;
if the VPN IP is not present on the host, Compose startup should fail. RPC is
only mapped to the operator's own localhost (`127.0.0.1:8545`), not the VPN or
public interface. TCP static peers work without UDP discovery; the generated
command deliberately sets `--discovery-enabled=false`,
`--static-nodes-file=/data/static-nodes.json`, `--nat-method=NONE` and
`--sync-min-peers=1` for this small private network.

**Data persistence:** `./data/` stores the validator's key, static peers and
database. The Compose service uses `restart: unless-stopped` but the operator
must independently maintain host availability, OS updates, disk health and
encrypted backups. Never duplicate an active validator key across two hosts.

## Safe liveness and one-host-off test

The bundle contains a **read-only** local JSON-RPC health checker in the kit:

```bash
python3 scripts/check-remote-consensus.py --seconds 7
```

Run it on an operator machine with its local `127.0.0.1:8545` RPC, or copy the
checker script there. It verifies chain ID 9127, four distinct QBFT validators,
at least two connected peers, and an advancing block height over the sample.
These conditions demonstrate **observed liveness**, not Byzantine correctness.

For a supervised disposable testnet rehearsal only:

1. Bring up all four hosts, compare genesis SHA-256 and block heights.
2. Explicitly stop **one chosen** validator via its own operator; the other
   three remain running. Confirm height still advances on two surviving peers.
3. Restart the stopped node; verify its peers reconnect and its height
   catches up. Keep the three-node quorum online during this test.
4. Do not simulate two failures in a live network, regenerate keys, or wipe
   chain data as part of this process.

This release includes only **configuration generation and offline safety/unit
tests**. Four independently hosted Docker validators, network partitions and
failover have **not** been run from this ChatGPT environment, which has no
external operator access. Public testnet, reward settlement, dynamic onboarding,
ML-DSA-native validator authentication, audited internet-facing RPC, and a
measured 5,000 TPS remain future work.
