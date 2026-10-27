# ZERONYTH v1.8.22 — AI usage rights for node providers

**Status: private Node.js/ML-DSA-65 access-control simulation.** No actual
ChatGPT-like model, AI inference API, hosted prompt endpoint, message delivery
or third-party node deployment exists in this release.

## User-facing product intent

An operator who contributes a working ZERONYTH compute node should also
be allowed to **use the ZERONYTH community AI**. Its basic inference
entitlement should not require additional governance-token payment. An
operator may separately opt into the default 20% L1/20% AI/60% rental
resource split, but **the basic AI access right does not depend on offering
AI-training resources**. Customers renting VPS/AI GPU remain on the distinct
GOV-LAB escrow research path, and future paid AI inference can have its own
clearly priced governance-token path.

## Implemented signed access checks

- `ComputeMarket.aiProviderAccess(address)` returns `eligible`, `used`,
  `remaining`, epoch and `realInferenceAvailable:false`. No AI prompt or
  simulated message is returned as though it came from a model.
- `ComputeMarket.requestProviderAi(signedRequest)` requires a domain-separated
  `AI_ACCESS` ML-DSA-65 signature by the provider over its exact chain ID,
  market nonce and 64-hex request identifier. No access without authorization.
- The provider must already have bonded the minimum DEV-CREDIT, registered
  validator-countersigned claimed compute capacity and registered a native
  server/desktop compute device with a sufficiently fresh, eligible,
  unmetered heartbeat at the same simulated height.
- Every eligible provider may consume up to **20 simulated requests in each
  ten-block test epoch** (heights 0–9, 10–19, etc.). A unique request ID may
  be used once per epoch. Neither rejected nor forged requests advance the
  signed nonce or spend the quota. Once spent, access fails closed until the
  next epoch and a valid provider heartbeat.
- Requests **do not** burn/spend governance tokens or create an AI-generated
  answer. Records are in-memory; a process restart resets this lab's quota
  state. This is **not** an economic guarantee or Sybil-resistant public
  rate-limit system.

## Test

```bash
node pq-native/resource-rental-demo.mjs
node --test pq-native/resource-rental.test.mjs pq-native/compute-market.test.mjs
```

The demo confirms that the pre-registered CPU node has signed AI access,
consumes one quota slot and still participates in VPS rental revenue and the
20/20/60 capacity-budget research flow. Tests cover signature tampering,
forgery, replay, duplicate request IDs, quotas, height epoch rollover,
stale node heartbeat and offline revocation.

## Before connecting a real model

1. Create a real model-serving service using a model with a valid license,
   operator consent and bounded compute costs. Never return an invented AI
   response in the absence of actual model inference.
2. Use a challenge-response ML-DSA login to create short-lived server-side
   sessions; do not upload or disclose node private keys to a chat frontend.
   Separate the login and billing identities from arbitrary customer prompts.
3. Persist quotas and identities in a durable, multi-node-safe datastore.
   Implement Sybil abuse controls, transparent rate limits, revocation,
   deterministic billing records, privacy protections, model moderation and
   denial-of-service defense.
4. Keep basic provider access available even without voluntary AI share,
   while higher reward tiers require objectively verified *actual service*
   rather than a provider's self-declared claimed hardware or percentage.

Nothing in v1.8.22 launches an actual user-facing AI chat. The deliverable is
only the signed entitlement and quota foundation for that future product.
