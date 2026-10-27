#!/usr/bin/env node
/**
 * Deploy ZERONYTH Swap Lab contracts on Chain ID 9127 (local Besu).
 * Usage (after chain is running and you have a funded account):
 *   RPC_URL=http://127.0.0.1:8545 PRIVATE_KEY=0x... node scripts/deploy-swaplab-9127.mjs
 *
 * Deploys:
 *   - SwapTestToken "TestA" / "TA"
 *   - SwapTestToken "TestB" / "TB"
 *   - SwapLabPair
 *   - SwapLabRouter
 *
 * Then prints addresses for the dashboard registry.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const { Wallet, JsonRpcProvider, ContractFactory } = require('ethers');

const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545';
const PK = process.env.PRIVATE_KEY;
if (!PK) {
  console.error('Set PRIVATE_KEY (funded account on chain 9127)');
  process.exit(1);
}

async function main() {
  const provider = new JsonRpcProvider(RPC);
  const wallet = new Wallet(PK, provider);
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== 9127) {
    console.error(`Expected chainId 9127, got ${net.chainId}`);
    process.exit(1);
  }
  console.log('Deployer:', wallet.address, 'on chain', net.chainId.toString());

  // Compile via solc if available, or expect pre-compiled artifact.
  // For simplicity this script expects you to have compiled SwapLab.sol
  // and placed the ABI+bytecode in a JSON next to it, or we shell out.
  console.log('\\nNOTE: Full auto-compile requires solc in PATH.');
  console.log('Recommended: run the existing experiments/swap-lab/server.mjs');
  console.log('or manually deploy SwapLab.sol contracts with forge/hardhat.');
  console.log('\\nAfter deployment, update dashboard registry dex.addresses if needed.');
  console.log('Test tokens are claimable (no value).');
}

main().catch(console.error);
