# Validator join flow (ZERONYTH)

1. Applicant runs a synced full node (`launch/public/fullnode-join.md`), gets its enode (`admin_nodeInfo`).
2. Applicant fills `dashboard/validator-apply.html` (Japanese-first). The page runs only in the browser, stores/sends nothing,
   derives the validator address = keccak256(enode pubkey)[12:], and produces `zeronyth-validator-application.json`.
   No private key is ever requested.
3. Operator: `node launch/validator/review-application.mjs app.json --rpc <rpc> [--admin <admin-rpc>]`
   checks schema, address derivation, "not already a validator", and (with --admin) that the node is an RLPx-connected peer.
   It only PRINTS the `qbft_proposeValidatorVote` calls — it never votes.
4. More than 50% of current validators vote (4 validators -> 3 votes; 5 -> 3). Then each voter runs `qbft_discardValidatorVote`.

Caution: adding a validator raises the quorum. Adding an offline node to a 4-validator set makes quorum 4 of 5, so one more
outage halts the chain. Vote in only synced, online nodes. Votes on the LIVE chain are a user/operator decision.

`rehearse-validator-join.mjs` — LOCAL ONLY (loopback ports 12541-12545 / 34301-34305, throwaway keys, data deleted afterwards):
application -> review -> 2/4 votes not enough -> 3/4 adds -> new validator proposes a block -> 3/5 removes -> chain continues.
Result: `rehearsal-result.txt` (all PASS on 2026-10-27 13:45 JST).
