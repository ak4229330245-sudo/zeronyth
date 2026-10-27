# Run a ZERONYTH bridge relayer (testnet)

Testnet only. wZNYT and ZNYT have no value; "bond" and "slashing" below are in **testnet points**, not money.

## What a relayer does

1. Watches `Locked` on the ZERONYTH vault (9127) and `Burned` on each live BridgeMinter, waiting for finality
   (9127: 2 blocks; remote chains: the `finalized` tag).
2. Signs the transfer digest with its ECDSA key (checked on-chain) and its ML-DSA-65 key (public audit log only,
   **not verified on-chain**), and posts both to the public **BridgeAttestationBoard** on 9127
   (`0x4a337b749c2c973C6f9e47e97A4E0247544a81D1`). The poster must be the ECDSA signer, so every attestation is attributable.
3. Reads everyone's attestations from the board. Once `threshold` valid signatures from the current on-chain relayer set exist,
   **any** relayer submits `mint` / `release` with its own gas. Relayers take turns by a deterministic rank
   (`(srcChainId + nonce) % n`, 45 s stagger) and always `staticCall` + check `processed` first, so double submits are
   harmless. There is no coordinator and the admin wallet is not involved.

## Requirements

- Linux box with Node 20+, pm2, ~150 MB RAM for the relayer process.
- Your **own** ZERONYTH node RPC (join kit: `zeronyth-join-kit.zip`, or `docs/` node setup). Use your own node, not the
  public gateway, so nobody else can feed you fake `Locked` events.
- Public RPCs for the remote chains (already in `deployments/main.json` / ecosystem registry).
- A little test gas on 9127 (faucet) and on each live chain (no-login faucets).

## Steps

```bash
# 1. Get the kit (built by the bridge maintainer with script/operator-bundle.sh; contains no keys)
mkdir -p ~/zeronyth-bridge-relayer && tar xzf zeronyth-relayer-kit.tar.gz -C ~/zeronyth-bridge-relayer
cd ~/zeronyth-bridge-relayer/bridge && npm ci --omit=dev

# 2. Generate keys ON THIS MACHINE (file is chmod 600; only public data is printed). Never copy keys between machines.
node script/operator-keygen.mjs --count=1

# 3. Start (registers your address + ML-DSA public key on the board automatically)
BRIDGE_PM2_NAME=zeronyth-bridge-relayer BRIDGE_MACHINE=<your-host> BRIDGE_OPERATOR_LABEL="<your name>" \
BRIDGE_HOME_RPC=http://127.0.0.1:8545 pm2 start pm2.operator.config.cjs
```

4. Send the printed **address** and **ML-DSA public-key hash** to the maintainer (never a private key or seed phrase).
   Until you are added to the on-chain set, your attestations are public but are not counted.
5. Being added: the owner schedules `setRelayers(newSet, newThreshold)` on the vault and each minter through the
   **24 h timelock** (`node script/timelock.mjs` lists queued operations; anyone can execute once ready). The schedule is
   public for 24 h, so existing operators and users can object or exit before it takes effect.

## Threshold scaling

```
threshold = max( floor(2n/3) + 1 ,  (largest number of keys held by one operator) + 1 )
```

| keys (n) | example split | threshold |
|---|---|---|
| 4 (today) | ZeroLayer box 2 + ZeroLayer VPS 2 | 3 (no single *machine* can sign; one *operator* still can) |
| 5 | ZeroLayer 4 + outside A 1 | 5 → outside operator required |
| 6 | ZeroLayer 2 + A 2 + B 2 | 5 |
| 7 | ZeroLayer 2 + A 2 + B 2 + C 1 | 5 |

Goal: once two independent operators hold keys, cut ZeroLayer to ≤ ⌊n/3⌋ keys so no single operator can sign.

## Bond and slashing (testnet design: points, not value)

- **Bond:** to be added to the set an operator stakes testnet points (proposal: 1,000 pts) in the points ledger.
- **Slashable, objectively provable faults** (anyone can prove them from board events):
  - signing a digest that does not match any finalized `Locked`/`Burned` event (forged transfer) → full bond + removal;
  - signing two different digests for the same `(srcChainId, nonce)` (equivocation) → full bond + removal.
- **Liveness:** missing > 20 % of finalized transfers over 7 days → 10 % of bond and a timelocked removal proposal.
- **Rewards:** points per attestation that ends up in a submitted mint/release, plus a bonus for the submitter.
- Not yet implemented on-chain: today slashing would be applied by the points service from public board data, then a
  timelocked `setRelayers` removal. A contract-level bond is future work.

## Admin rights and the timelock

- Vault (9127) and every BridgeMinter are owned by a 24 h OpenZeppelin `TimelockController`.
  `setRelayers`, `setGuardian`, `unpause`, `setChain`, `setLimits` and ownership changes all wait 24 h.
- Proposer: the bridge admin. Cancellers: admin and guardian. Executor: anyone (after the delay).
- **Pause stays instant:** the guardian key (or the invariant monitor) can pause any contract immediately.
- `node script/timelock.mjs` lists queued ops with their ready time; `--execute` runs those that are ready.

## Honest limits today

- Both machines (box, ABLENET VPS) are run by the same operator, ZeroLayer.
- The admin key is still the sole proposer (but every change is visible 24 h ahead and cancelable).
- The public API, invariant monitor and guardian run on the box.
- Liveness trade-off of 3-of-4 over 2 machines: one stopped box relayer is fine (r0 + VPS k0 + k1 = 3), but if a whole
  machine (box or VPS) or the VPS's node4 goes down, only 2 signatures remain and transfers wait (funds stay safe in
  the vault / unminted) until it is back. More outside operators fix this.
- ML-DSA-65 signatures are logged and cross-checked off-chain only.
- 9127 validators are mostly on the box, so the home chain itself is not yet decentralized.
