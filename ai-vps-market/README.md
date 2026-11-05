# AI VPS Market — ZERONYTH VPS rental service

The ZERONYTH AI VPS rental service is an **order market** served by the production
site gateway. A customer orders a VPS plan on the web page, pays with a **native
post-quantum transaction** on chain 912701, and the operator provisions the server
off-band and activates the lease. Tenant workloads never run on the validator host.

- Live page: https://zeronyth.dpdns.org/vps.html
- Current plan: `ai-vps-starter` — **100 ZNYT / 10 days** (ZNYT is a test coin with no monetary value)

## Files in this directory

| File | Role |
|---|---|
| `vps.html` | The public order page (served as `/vps.html` by the site gateway). |
| `gateway-only.mjs` | The production site gateway. It hosts the VPS market APIs (order intake, payment watcher, admin fulfill/cancel) alongside the gateway's other duties (Quantum Wallet `zny_*` adapter, AI-worker attestation verification, binary download route). State is kept in `site/vps-market.json` on the host (atomic tmp+rename writes). |
| `vps-admin.mjs` | Operator CLI (`fulfill <id> <accessText>` / `cancel <id>`). Signs each request with the operator's ML-DSA-65 key on the host and posts to the gateway's loopback port. |
| `notify-vps.mjs` | Discord notification poster used with the existing ZERONYTH Discord bot. Every message carries an ML-DSA-65-signed `attestation.json` attachment. |
| `pq-lib/` | Shared post-quantum library (vendored `@noble/post-quantum` ML-DSA-65 + keccak wrappers and the identity key generators) used by the gateway, the admin tool and the notifier. |

## Order flow

1. **Order** — `POST /api/vps/order {offer_id, customer}` creates an order
   (`ZVPS-NNNN`) with a **unique payable amount**: plan price + the order sequence
   number in wei, so each payment is unambiguous on-chain.
2. **Payment** — the customer pays that exact amount to the treasury address with a
   **native PQ transaction only** (Falcon-1024 type `0x7E` or ML-DSA-65 type `0x7F`)
   from the ordering address. ECDSA payments are not accepted for orders.
3. **Detection** — a block watcher in the gateway (15 s cadence, cursor persisted in
   the store) matches the incoming transfer and marks the order paid, creating a
   lease in state `provisioning`.
4. **Notification** — newly paid leases are reported to the operator and posted,
   ML-DSA-signed, to the private **#vps-orders** channel of the
   "ZERONYTH | Official Community" Discord guild.
5. **Fulfillment** — the operator provisions the server off-band, then calls the
   admin API (PQ-signed, see below) with the access details; the lease becomes
   `active` for the plan period. The operator can also cancel; cancelled leases
   are terminal.

## API surface (site gateway)

| Method & path | Purpose |
|---|---|
| `POST /api/vps/order` | Create an order; returns the order id and the exact payable amount. |
| `GET /api/vps/order?id=` | Look up one order/lease. Never returns access details — only `access_registered` (whether any are on file). |
| `POST /api/vps/order/access` | Retrieve a lease's access details with a PQ signature from the ordering address (see below). |
| `GET /api/vps/status` | Market status (live state). |
| `GET /api/vps/offers` | Current offers. |
| `GET /api/vps/rentals` | Current leases (used by the paid-order watch). |
| `GET /api/vps/pricing` | Pricing view of the offers. |
| `POST /api/vps/admin/fulfill` | Activate a paid lease with access details (PQ-signed or legacy key). |
| `POST /api/vps/admin/cancel` | Cancel an order/lease (PQ-signed or legacy key). |

### Admin authentication

Admin calls accept an ML-DSA-65 signature over

```
"ZERONYTH/VPS-ADMIN/V1" + "\n" + JSON.stringify({action, id, access: access ?? null, ts})
```

with a ±300 s timestamp window, verified against the pinned operator public key.
The legacy shared admin key is kept only as a break-glass fallback; responses
report which path authenticated (`auth: "pq"` or `"legacy"`).

### Access retrieval (customer authentication)

Lease access details are stored in the market store but are **never**
serialized by the public endpoints (order ids are sequential, so an id
cannot act as a credential). The customer retrieves them by proving
control of the ordering PQ address: `POST /api/vps/order/access` with
`{id, ts, publicKey, signature}`, where the signature covers

```
"ZERONYTH/VPS-ACCESS/V1" + "\n" + JSON.stringify({id, ts})
```

with a ±300 s timestamp window. The signer address is derived
chain-style (`keccak256(publicKey)[12:]`) and must equal the order's
customer; both ML-DSA-65 (1952-byte key) and Falcon-1024 (1793-byte
key) signatures are accepted. Every failure — unknown order, no access
registered, stale timestamp, wrong signer, bad signature — returns the
same generic `403 {"error":"forbidden"}`. (Security fix, 2026-11-05:
previously `GET /api/vps/order?id=` returned the access details of an
active lease to anyone who knew the order id.)

### Discord notification signing

`notify-vps.mjs send` signs

```
"ZERONYTH/DISCORD-NOTIFY/V1" + "\n" + JSON.stringify({content, ts})
```

and attaches the signature as `attestation.json`, so any reader can verify that a
paid-order post really came from the operator's notifier key.

## Public identities

| Role | Address | Identity published at |
|---|---|---|
| Payment treasury (ML-DSA-65, receive-only) | `0x2c311ed23ff23edfbb085744142d99944b252963` | https://zeronyth.dpdns.org/vps-treasury.json |
| Market operator / admin (ML-DSA-65) | `0xfa89abc4ae5e18ef9c2f8d4842474287be48202f` | https://zeronyth.dpdns.org/vps-admin-identity.json |
| Discord notifier (ML-DSA-65) | `0x1e3945813401a0764c2ebd150aa4095d013bd457` | https://zeronyth.dpdns.org/discord-notify-identity.json |

## Security note

**No seeds, private keys, tokens or shared secrets are in this repository — ever.**
All key material lives only on the production host, mode `0600`
(`net/secrets/*.seed`, the Discord bot's own `.env`), is generated on-host and
never leaves it. The files above reference those paths only. The addresses in
this document are public identities, published on the site itself.
