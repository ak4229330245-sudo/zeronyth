# Production Hardening Guide

This starter kit is intentionally optimized for a local buyer demo. A public network is a separate engineering and
security project. Before any public deployment:

1. Design validator topology, operators, regions, failure domains, and quorum assumptions.
2. Put sentry/RPC nodes in front of validators; never publish validator RPC/P2P indiscriminately.
3. Use TLS, authentication, allowlists, WAF/rate limiting, DDoS controls, and protected administrative paths.
4. Move validator keys to HSM/KMS-grade custody or a reviewed Besu security-module integration.
5. Define validator onboarding/removal, governance, upgrades, emergency procedures, backups, and restore drills.
6. Design native-token issuance, fees, incentives, staking/slashing (if applicable), and economic security.
7. Use a real indexed explorer and production-grade RPC scaling/observability stack.
8. Remove the bundled faucet identity and build a rate-limited, abuse-resistant testnet faucet if one is needed.
9. Audit every smart contract and treat bridges, oracles, custody, and cross-chain messaging as independent high-risk
   systems.
10. Implement and independently audit the actual PQC authentication/verification path before making quantum-resistance
    claims.
11. Run load tests, fault-injection tests, validator-loss tests, upgrade rehearsals, and an adversarial public testnet.
12. Establish vulnerability disclosure, incident response, dependency patching, logging/metrics, and 24/7 ownership.

Do not treat the local Docker Compose topology as a production deployment blueprint.
