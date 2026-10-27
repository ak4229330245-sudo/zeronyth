# ZERONYTH v1.8.7 — consent-gated browser WebRTC P2P transport

**Status: runnable local transport research. NOT a distributed L1 or real paid node network.**

## What it does

1. Open `http://127.0.0.1:8080/node.html` after launching the existing
   Docker Compose developer stack. The old local Web Node demo is unchanged.
2. In **03 / WEBRTC P2P EXPERIMENT**, generate a random 32-hex invite code.
3. In a second secure-context browser/desktop on the same available site, enter
   the same code. Both participants must explicitly agree to direct networking
   and processing, then press **ルームに参加**.
4. Nginx proxies the **only** SDP/ICE signaling to the private `p2p-signal`
   Node service. It does not carry computation, state or browser channel data.
5. When WebRTC `RTCDataChannel` opens, **接続済み相手** becomes > 0. The peers
   exchange bounded SHA-256 demo requests and cryptographically verify any
   returned hash before incrementing a demo-only verified count.
6. Unchecking consent, leaving, hiding the browser/tab or navigating away
   closes connections. A page becoming visible again does not silently rejoin.

> Joining an invite room does not guarantee successful P2P connectivity.
> With no STUN servers configured, ICE connectivity across different NATs is
> not reliable. For controlled environments operators may set
> `ZERONYTH_STUN_URLS=stun:hostname.example:3478` before starting Compose.
> STUN reveals IP addresses to network peers and the selected provider; TURN
> may be required for harder NATs, but no TURN server/relay is included.
> HTTPS, valid certificates, network routing and participant consent are needed
> to use a separately hosted origin on actual smartphones.

## Security boundaries

- 128-bit invite room code; randomly assigned 128-bit participant identity and
  256-bit per-join bearer token. Short 30s roster lease, 6 peers/room,
  16 rooms/server and bounded SDP/ICE queues and signaling rate. The registry
  holds these in RAM and loses them on restart.
- Other room members are untrusted; a room code is an invitation, **not**
  trustworthy authentication, Sybil protection, or persistent identity.
- WebRTC data channels use DTLS encryption but **not** ZERONYTH ML-DSA
  identities. No wallet signing, private key access, blockchain consensus,
  block distribution, native token transfer, gas subsidies, rewards or slashing.
- Only a fixed bounded hash operation is accepted from remote clients; **no**
  arbitrary shell/script execution or actual CPU/VPS leasing is possible.
- A page visibility transition is a best-effort stop signal. Mobile OS may
  suspend the process and interrupt connectivity before the handler runs.
- All Docker externally published ports remain localhost-bound. This release
  does **not** make the browser lab publicly available nor deploy anywhere.
- An isolated native Node `pq-native/` lab retains its ML-DSA four-validator
  research. The underlying existing Besu/QBFT EVM devnet still uses classical
  ECDSA and four statically configured Docker validators on one host.

## Does the founder need their own always-on PC?

**Not in a *future* independently hosted network**, but somebody must operate
actual hardware/services continuously. Currently this release is a local-only
demo: if the sole host PC powers off, its local signaling page and four devnet
validators stop. To make the founder's PC unnecessary:

1. Arrange an independently hosted, audited HTTPS app origin, signaling
   bootstrap/discovery and uptime monitoring (run by other operators).
2. Distribute **actual L1 validator/archival node software** to unrelated
   trusted operators on separate networks with secure multi-operator key
   custody, durable synchronization, abuse defenses and governance.
3. Provide mobile **light client** access; browsers may contribute transient
   foreground tasks, not 24/7 validator consensus.
4. Add genuinely authenticated PQ peer identities, persistent block transport,
   validated work receipts, audited reward accounting and sybil/DoS resistance.

Simply running a WebRTC signaling server or multiple tabs **does not** achieve
chain decentralization, unlock real ZNYT or the 5,000 TPS target.

## Verification

```bash
node --test p2p-signal/registry.test.mjs tests/web-p2p.test.mjs
node --check dashboard/assets/web-p2p.mjs
node --check dashboard/assets/p2p-ui.mjs
```

The registry test covers real local HTTP signaling; JavaScript tests use a
minimal mock peer connection for life-cycle checks. Browser-to-browser WebRTC
handshakes, iOS background behavior, NAT penetration and simultaneous users
**must still be tested** in a controlled HTTPS integration environment before
public use.
