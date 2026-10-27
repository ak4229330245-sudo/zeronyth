# Detailed Reward Logic (Testnet Simulation)

## Formula
- AI use: fee = 0.50 ZNYT → 70% to providers
- VPS use: fee = 1.20 ZNYT → 60% to providers
- Provider share = (my verified jobs / total jobs) × total rewards distributed

## Implementation
- `dashboard/assets/reward-logic.mjs` — RewardEngine class
- Integrated into node page UI
- Updates on simulated AI/VPS use and periodically from job count

## Constraints
- Local simulation only
- No real transfers
- No mainnet assets
- No real value
- Quantum resistance and privacy unchanged
