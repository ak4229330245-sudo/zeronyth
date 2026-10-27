// Bridge chain registry. EVM testnet metadata (chain id, public RPC, explorer) is reused from the dashboard's
// assets/ecosystem-registry.mjs; bridge-specific settings (finality, caps, status) live here.
import { NETWORKS } from '../../dashboard/assets/ecosystem-registry.mjs';
import { parseEther } from 'ethers';

export const HOME = { id: 'zeronyth-9127', name: 'ZERONYTH Testnet', chainId: 9127, symbol: 'ZNYT',
  rpc: process.env.BRIDGE_HOME_RPC || 'http://127.0.0.1:9545', publicRpc: 'https://zeronyth.dpdns.org/rpc',
  explorerTx: 'https://zeronyth.dpdns.org/#tx=', confirmations: 2 };

/** Testnet caps (same for every chain; ZNYT and wZNYT both have 18 decimals, 1:1). */
export const CAPS = { min: parseEther('0.01'), max: parseEther('1000'), daily: parseEther('10000') };

/** Where a human can get gas for the bridge admin address (none of these work headless from a server). */
const FAUCETS = {
  'base-sepolia': ['https://portal.cdp.coinbase.com/products/faucet (Coinbase login)', 'https://faucet.quicknode.com/base/sepolia (browser check)'],
  'ethereum-sepolia': ['https://cloud.google.com/application/web3/faucet/ethereum/sepolia (Google login)', 'https://sepolia-faucet.pk910.de/ (browser PoW)'],
  'arbitrum-sepolia': ['https://www.l2faucet.com/arbitrum (browser passkey)', 'bridge Sepolia ETH via https://bridge.arbitrum.io'],
  'bnb-testnet': ['https://www.bnbchain.org/en/testnet-faucet (needs a small BSC mainnet balance)'],
  'robinhood-testnet': ['https://faucet.testnet.chain.robinhood.com/ (browser check)'],
  'monad-testnet': ['https://faucet.monad.xyz (official; needs >=0.03 ETH + 3 tx on Ethereum mainnet)', 'https://www.alchemy.com/faucets/monad-testnet (needs >=0.001 ETH on mainnet)'],
};

/** Max eth_getLogs block range accepted by each chain's public RPC (Base: 200, Monad: 100; others accept 1000). */
export const LOG_RANGE = { 84532: 200, 10143: 100 };

const REMOTE_IDS = ['base-sepolia', 'ethereum-sepolia', 'arbitrum-sepolia', 'bnb-testnet', 'robinhood-testnet', 'monad-testnet'];
export const MINTER_SALT_LABEL = 'ZERONYTH_BRIDGE_V1/minter';

/** Real EVM testnets. `finality: 'finalized'` = only act on blocks the chain reports as finalized. */
export const REMOTES = REMOTE_IDS.map((id) => {
  const n = NETWORKS.find((x) => x.id === id);
  if (!n || n.family !== 'evm') throw new Error(`registry missing ${id}`);
  return { id, name: n.name, chainId: n.chainId, rpc: n.rpcUrl, explorer: n.explorerUrl,
    gasSymbol: n.nativeAsset?.symbol || 'ETH', finality: 'finalized', standIn: false,
    faucets: FAUCETS[id] || [] };
});

/** Local Anvil chains standing in for the real testnets until their deployer address has gas (clearly labelled). */
export const STAND_INS = REMOTES.map((r, i) => ({ ...r, id: `local-${r.id}`, name: `LOCAL STAND-IN for ${r.name}`,
  chainId: 31337001 + i, rpc: `http://127.0.0.1:${18451 + i}`, explorer: null, finality: 2, standIn: true, standInFor: r.id }));

/** Non-EVM, planned: Solana Devnet would use an SPL mint + the same 2-of-3 attestation (verified by an on-chain program). */
export const PLANNED = [{ id: 'solana-devnet', name: 'Solana Devnet', bridgeChainId: 1_000_000_103, family: 'solana', status: 'planned' }];
