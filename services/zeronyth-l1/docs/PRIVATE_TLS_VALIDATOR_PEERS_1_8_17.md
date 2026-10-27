# ZERONYTH L1 v1.8.17 — private multi-host ML-DSA validator transport (experimental)

## What is new

The **isolated** `pq-native/` laboratory can now run one validator per host over
private VPN addresses, using mutual TLS **and** a SHA-256 certificate fingerprint
pin for each of the four genesis-ordered peers. Full ML-DSA-65 transaction,
block proposal and vote verification is still mandatory at every independent
validator, and the existing vote/block journals remain fsync-backed.

No VPN, private servers, public endpoint or production network was deployed.
Four-process tests were run **only on one computer with loopback addresses**.
Node.js 24+ and manually provisioned TLS identities are required. TLS uses
conventional ECDSA/RSA certificates; this transport **is not quantum-proof**.
The private Besu/EVM/QBFT devnet still uses ECDSA for transactions.

## Private validator configuration

Each of the four independent operators needs a *unique* ML-DSA validator key
from the **same genesis**, a private VPN IP, a distinct TLS client/server
certificate issued by a dedicated *private* CA, and these files on disk:

- `/etc/zeronyth/genesis.json` — the exact same signed chain definition
- `/etc/zeronyth/validator.pem` — that node's ML-DSA private key
- `/etc/zeronyth/tls.key` — that node's TLS private key
- `/etc/zeronyth/tls.pem` — that node's TLS certificate
- `/etc/zeronyth/ca.pem` — the trusted private validator-only CA
- `/etc/zeronyth/private-peers.json` — four pinned genesis-ordered peers

Keep all files above **owner-only `0600`**, and restrict parent directories.
Keep the CA **signing private key offline**. Never distribute any validator or
TLS private key inside a release archive, screenshot, web app or Git repository.
Verify the SHA-256 fingerprint of each operator's certificate over a second
trusted channel. For example:

```bash
openssl x509 -in /etc/zeronyth/tls.pem -noout -fingerprint -sha256
```

Example config for genesis validator **index 0** (replace every sample IP,
certificate fingerprint and path with independently verified private values):

```json
{
  "kind": "ZERONYTH_PQ_PRIVATE_VALIDATORS_V1",
  "validatorIndex": 0,
  "listenAddress": "10.71.0.10",
  "port": 18080,
  "tls": {
    "certPath": "/etc/zeronyth/tls.pem",
    "keyPath": "/etc/zeronyth/tls.key",
    "caPath": "/etc/zeronyth/ca.pem"
  },
  "peers": [
    {"validatorIndex":0,"host":"10.71.0.10","port":18080,"serverName":"node-0.zeronyth.internal","certSha256":"AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA"},
    {"validatorIndex":1,"host":"10.71.0.11","port":18080,"serverName":"node-1.zeronyth.internal","certSha256":"BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB"},
    {"validatorIndex":2,"host":"10.71.0.12","port":18080,"serverName":"node-2.zeronyth.internal","certSha256":"CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC"},
    {"validatorIndex":3,"host":"10.71.0.13","port":18080,"serverName":"node-3.zeronyth.internal","certSha256":"DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD:DD"}
  ]
}
```

Each other operator must change only its own `validatorIndex`,
`listenAddress`, and local `tls` file paths. **All four peer entries and pins
must be identical and in the original genesis order**. Their TLS certificates
must carry matching DNS subjectAltName and clientAuth/serverAuth use.
Only stable private IP literals are accepted (RFC1918, loopback for testing,
100.64.0.0/10 for private overlays and IPv6 ULA). Public IPs, DNS hostnames
as transport endpoints, duplicate pins and unexpected keys are rejected.

Run on each private host (replace local paths; do not run on a public interface):

```bash
ZERONYTH_PQ_REMOTE_CONFIG_PATH=/etc/zeronyth/private-peers.json \
  node pq-native/server.mjs /etc/zeronyth/genesis.json \
  /etc/zeronyth/validator.pem 18080
```

The server only binds to `listenAddress`. Require a **VPN firewall allow-list**
for the other three validator IPs. Mutual TLS verifies that the caller owns a
CA-signed private key AND its exact certificate is one of the four pins.
Outgoing requests check DNS SAN, CA chain and the intended validator's pin.
All external RPC requests in this experimental mode also require one of the
four pinned client certificates, including `/status` and `/p2p/round`.
The ordinary local-only demo remains available separately.

## Repeatable local integration tests

The following generates a disposable private CA and four short-lived EC TLS
identities with OpenSSL, uses four independent OS processes on localhost,
preverifies *all* transaction signatures on *all four* validators, commits
sequential blocks and compares all state balances:

```bash
node pq-native/private-peer-demo.mjs 4 2
node pq-native/private-peer-demo.mjs 512 3
node --test pq-native/private-peer-transport.test.mjs
```

Deliberately swapped but still CA-signed fingerprints must abort before commit:

```bash
node pq-native/private-peer-demo.mjs 4 2 --bad-peer-pin
```

This last command **must exit with a nonzero code** and a TLS pin rejection.
Temporary demo keys are created under a unique temporary directory and
removed after the test. They are never included in the release ZIP.

### Measured single-machine examples

Short, 1,536-transfer (512 x three blocks), 32 independent sender-account
samples, four process-local validators each independently prechecking ML-DSA
transactions and fsync-persisting finalized certificates:

| Transport | Preverify + ML-DSA consensus + fsync TPS | With sequential client signing TPS |
| --- | ---: | ---: |
| v1.8.16 direct HTTP localhost, no TLS | 609.8 | 380.3 |
| Mutual TLS localhost without client connection reuse | 506.4 | 327.1 |
| Mutual TLS localhost with bounded pinned client connection reuse | 537.9 | 341.2 |

**Individual noisy one-machine results only**, not a statistically proven
optimization or a WAN-hosted/production throughput claim. The measurements
include validator crypto preverification and durability; they exclude
independent operator networks and WAN latency. The v1.8.15 ~6,197 tx/s
number measured **only asynchronous execution and WAL**, without quorum,
network or client signing. Real sustained 5,000 TPS **is not verified**.

## Important limitations

- This is explicit fixed-membership direct peer communication, **not** public
  discovery or permissionless P2P. WebRTC phone workers cannot be validators.
- No reconfiguration, safe Byzantine view change, partition repair, catch-up
  or audited certificate/token economics. The demo requires all four peers to
  respond, even though the certificate itself only needs three signatures.
- No operator deployments, public testnet or production mainnet were made.
  Multiple independent machines are necessary to measure genuine WAN TPS.
- All cryptographic transport certificates remain **classically signed**;
  the ML-DSA research ledger does not magically upgrade Besu/EVM ECDSA or TLS.
- **Do not connect real assets or internet-exposed RPC**. A complete threat
  model, remote load tests, network recovery and independent audit are still
  necessary before production use.
