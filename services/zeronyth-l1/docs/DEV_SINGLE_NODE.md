# Single-Node / No Pre-existing Validator Mode

## Purpose
Allow local development and UI testing without a pre-provisioned 4-validator set.

## Reality of QBFT
- QBFT requires at least one validator to produce blocks.
- "No validators at all" cannot produce a progressing chain.
- This mode reduces the requirement to **1 validator** generated on the fly.

## Usage
```bash
./scripts/start-dev-single.sh
```
Then complete Besu genesis generation (needs Docker) and start the node.

## Limits
- Not fault-tolerant
- For local testing only
- Testnet / private chain only
- Quantum-resistant research path is separate
