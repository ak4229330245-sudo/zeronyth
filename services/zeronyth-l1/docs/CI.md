# GitHub Actions verification

The repository includes `.github/workflows/e2e.yml`. No paid external service or repository secret is required for the
bundled local-devnet configuration.

The workflow runs on GitHub-hosted **Ubuntu 24.04** with **Python 3.13.16**. Critical checkout/setup actions are pinned to immutable commit SHAs; the artifact uploader is pinned to the exact v7.0.2 release.

On every push and pull request, the workflow:

1. validates static configuration and unit/package tests;
2. compiles all bundled Solidity examples with `ethereum/solc:0.8.24`;
3. generates a fresh four-validator QBFT genesis and fresh validator identities;
4. starts all four Besu validators, the faucet, and the explorer with Docker Compose;
5. verifies chain ID, network ID, block progress, four validators, and peer connectivity;
6. verifies explorer security headers and the browser RPC proxy;
7. claims 100 ZNYT through the faucet, waits for a **successful** transaction receipt, verifies the exact balance delta, and checks cooldown plus JSON content-type enforcement;
8. builds the deterministic resale ZIP, checks generated validator material/`.env` are absent, validates archive safety/executable bits, and rebuilds it to prove the SHA-256 is reproducible;
9. uploads non-secret diagnostic logs on success or failure, then destroys the test stack.

## How to use it without a Docker-capable PC

Create a GitHub repository, upload this kit, and open the **Actions** tab. The workflow named **ZERONYTH Full E2E**
runs automatically. A green `4-validator E2E` job is the live Docker verification for that exact commit.

Before advertising a build as "CI verified", make sure the workflow for the exact version/tag you are selling is green.
A workflow file existing in the ZIP is not itself proof that a run passed.

## Optional badge

After the repository exists, GitHub can render the workflow badge at:

`https://github.com/OWNER/REPOSITORY/actions/workflows/e2e.yml/badge.svg`

Replace `OWNER/REPOSITORY` with the actual repository path before putting the badge on a storefront or README.
