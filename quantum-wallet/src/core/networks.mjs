// Network registry (multi-chain v12).
//
// One entry per selectable network. Two kinds:
//   - "evm":   EVM JSON-RPC networks. ZERONYTH (912701) is the home
//              network — all three schemes operate there. The remote EVM
//              networks are ECDSA-only: the PQ transaction types 0x7E /
//              0x7F exist only on 912701, so the session refuses PQ sends
//              anywhere else (see session.mjs).
//   - chain families ("solana" | "bitcoin" | "xrp" | "sui" | "aptos"):
//              non-EVM networks served by the engines in src/core/chains/.
//              Only accounts of the matching family operate there.
//
// `api` is the canonical public endpoint. `corsProxy` names a same-origin
// gateway path (pinned upstream in gateway-only.mjs) used ONLY when the
// wallet runs on the production origin and the upstream sends no CORS
// headers for it — verified 2026-11-05: Arbitrum Sepolia and both XRP
// servers send no Access-Control-Allow-Origin; everything else here is
// CORS-usable from https://zeronyth.dpdns.org directly.
//
// Every endpoint + explorer below was probed live on 2026-11-05; see
// evidence/multichain/ENDPOINTS.md for the probe log.

/** Gen2 bridge wZNYT (same address on all four bridge remote chains). */
export const WZNYT_ADDRESS = '0xe2c03e92e5850375aE5c563CbB2C1Fdc99A3E8e2';

const ZERONYTH = Object.freeze({
  id: 'zeronyth',
  kind: 'evm',
  name: 'ZERONYTH',
  testnet: false,
  chainId: 912701,
  api: 'https://zeronyth.dpdns.org/rpc',
  corsProxy: null,
  native: Object.freeze({ symbol: 'ZNYT', decimals: 18 }),
  explorerTx: 'https://scan.zeronyth.dpdns.org/tx/{hash}',
  schemes: Object.freeze(['ecdsa', 'falcon', 'mldsa']),
  faucet: true,
  tokens: Object.freeze([]),
});

function evmRemote({ id, name, chainId, api, explorerTx, corsProxy = null, tokens = [], native }) {
  return Object.freeze({
    id,
    kind: 'evm',
    name,
    testnet: true,
    chainId,
    api,
    corsProxy,
    native: Object.freeze(native ?? { symbol: 'ETH', decimals: 18 }),
    explorerTx,
    schemes: Object.freeze(['ecdsa']),
    faucet: false,
    tokens: Object.freeze(tokens),
  });
}

const WZNYT_TOKEN = Object.freeze([
  Object.freeze({ address: WZNYT_ADDRESS, symbol: 'wZNYT', decimals: 18 }),
]);

const BASE_SEPOLIA = evmRemote({
  id: 'base-sepolia',
  name: 'Base Sepolia',
  chainId: 84532,
  api: 'https://sepolia.base.org',
  explorerTx: 'https://sepolia.basescan.org/tx/{hash}',
  tokens: WZNYT_TOKEN,
});

const ETHEREUM_SEPOLIA = evmRemote({
  id: 'ethereum-sepolia',
  name: 'Ethereum Sepolia',
  chainId: 11155111,
  api: 'https://ethereum-sepolia-rpc.publicnode.com',
  explorerTx: 'https://sepolia.etherscan.io/tx/{hash}',
  tokens: WZNYT_TOKEN,
});

const ARBITRUM_SEPOLIA = evmRemote({
  id: 'arbitrum-sepolia',
  name: 'Arbitrum Sepolia',
  chainId: 421614,
  // The JSON-RPC endpoint lives at /rpc (the bare host answers 404,
  // verified live 2026-11-06); the CSP origin is the bare host.
  api: 'https://sepolia-rollup.arbitrum.io/rpc',
  explorerTx: 'https://sepolia.arbiscan.io/tx/{hash}',
  // No CORS headers from this endpoint (verified) → same-origin proxy.
  corsProxy: '/remote-rpc/421614',
  tokens: WZNYT_TOKEN,
});

const ROBINHOOD = evmRemote({
  id: 'robinhood-testnet',
  name: 'Robinhood Testnet',
  chainId: 46630,
  api: 'https://rpc.testnet.chain.robinhood.com',
  // Explorer verified live 2026-11-05 (200 on / and /tx/<hash>).
  explorerTx: 'https://explorer.testnet.chain.robinhood.com/tx/{hash}',
  tokens: WZNYT_TOKEN,
});

const ARC = evmRemote({
  id: 'arc-testnet',
  name: 'Arc Testnet',
  chainId: 5042002, // verified via eth_chainId (0x4cef52)
  api: 'https://rpc.testnet.arc.network',
  // testnet.arcscan.app redirects here; canonical base verified (200).
  explorerTx: 'https://explorer.testnet.arc.io/tx/{hash}',
  // Circle's chain: USDC is the native gas token, 18 decimals in its
  // native representation (chainid.network registry, verified 2026-11-05).
  native: { symbol: 'USDC', decimals: 18 },
});

function chainNet({ id, family, name, testnet, api, explorerTx, native, corsProxy = null }) {
  return Object.freeze({
    id,
    kind: family,
    name,
    testnet,
    chainId: null,
    api,
    corsProxy,
    native: Object.freeze(native),
    explorerTx,
    schemes: Object.freeze([family]),
    faucet: false,
    tokens: Object.freeze([]),
  });
}

const SOLANA_MAINNET = chainNet({
  id: 'solana-mainnet', family: 'solana', name: 'Solana', testnet: false,
  api: 'https://api.mainnet-beta.solana.com',
  explorerTx: 'https://solscan.io/tx/{hash}',
  native: { symbol: 'SOL', decimals: 9 },
});
const SOLANA_DEVNET = chainNet({
  id: 'solana-devnet', family: 'solana', name: 'Solana Devnet', testnet: true,
  api: 'https://api.devnet.solana.com',
  explorerTx: 'https://solscan.io/tx/{hash}?cluster=devnet',
  native: { symbol: 'SOL', decimals: 9 },
});
const BITCOIN_MAINNET = chainNet({
  id: 'bitcoin-mainnet', family: 'bitcoin', name: 'Bitcoin', testnet: false,
  api: 'https://blockstream.info/api',
  explorerTx: 'https://blockstream.info/tx/{hash}',
  native: { symbol: 'BTC', decimals: 8 },
});
const BITCOIN_TESTNET = chainNet({
  id: 'bitcoin-testnet', family: 'bitcoin', name: 'Bitcoin Testnet', testnet: true,
  api: 'https://blockstream.info/testnet/api',
  explorerTx: 'https://blockstream.info/testnet/tx/{hash}',
  native: { symbol: 'BTC', decimals: 8 },
});
const XRP_MAINNET = chainNet({
  id: 'xrp-mainnet', family: 'xrp', name: 'XRP Ledger', testnet: false,
  api: 'https://s1.ripple.com:51234',
  corsProxy: '/remote-rpc/xrp-mainnet', // no CORS from rippled (verified)
  explorerTx: 'https://xrpscan.com/tx/{hash}',
  native: { symbol: 'XRP', decimals: 6 },
});
const XRP_TESTNET = chainNet({
  id: 'xrp-testnet', family: 'xrp', name: 'XRP Testnet', testnet: true,
  api: 'https://s.altnet.rippletest.net:51234',
  corsProxy: '/remote-rpc/xrp-testnet',
  explorerTx: 'https://testnet.xrpscan.com/tx/{hash}',
  native: { symbol: 'XRP', decimals: 6 },
});
const SUI_MAINNET = chainNet({
  id: 'sui-mainnet', family: 'sui', name: 'Sui', testnet: false,
  // Sui JSON-RPC on public fullnodes is deprecated/dead (verified
  // 2026-11-05); the GraphQL endpoint is the live public interface.
  api: 'https://graphql.mainnet.sui.io/graphql',
  explorerTx: 'https://suiscan.xyz/mainnet/tx/{hash}',
  native: { symbol: 'SUI', decimals: 9 },
});
const SUI_TESTNET = chainNet({
  id: 'sui-testnet', family: 'sui', name: 'Sui Testnet', testnet: true,
  api: 'https://graphql.testnet.sui.io/graphql',
  explorerTx: 'https://suiscan.xyz/testnet/tx/{hash}',
  native: { symbol: 'SUI', decimals: 9 },
});
const APTOS_MAINNET = chainNet({
  id: 'aptos-mainnet', family: 'aptos', name: 'Aptos', testnet: false,
  api: 'https://fullnode.mainnet.aptoslabs.com/v1',
  explorerTx: 'https://explorer.aptoslabs.com/txn/{hash}?network=mainnet',
  native: { symbol: 'APT', decimals: 8 },
});
const APTOS_TESTNET = chainNet({
  id: 'aptos-testnet', family: 'aptos', name: 'Aptos Testnet', testnet: true,
  api: 'https://fullnode.testnet.aptoslabs.com/v1',
  explorerTx: 'https://explorer.aptoslabs.com/txn/{hash}?network=testnet',
  native: { symbol: 'APT', decimals: 8 },
});

export const NETWORKS = Object.freeze([
  ZERONYTH,
  BASE_SEPOLIA,
  ETHEREUM_SEPOLIA,
  ARBITRUM_SEPOLIA,
  ROBINHOOD,
  ARC,
  SOLANA_MAINNET,
  SOLANA_DEVNET,
  BITCOIN_MAINNET,
  BITCOIN_TESTNET,
  XRP_MAINNET,
  XRP_TESTNET,
  SUI_MAINNET,
  SUI_TESTNET,
  APTOS_MAINNET,
  APTOS_TESTNET,
]);

export const DEFAULT_NETWORK_ID = 'zeronyth';
const BY_ID = new Map(NETWORKS.map((n) => [n.id, n]));
const BY_CHAIN_ID = new Map(
  NETWORKS.filter((n) => n.chainId != null).map((n) => [String(n.chainId), n]),
);

export function getNetwork(id) {
  return BY_ID.get(id) ?? null;
}

/**
 * Resolve a persisted network selector value. EVM networks persist by
 * chainId (e.g. "84532"); chain-family networks persist by id slug.
 * Accepts either form; returns null for unknown values.
 */
export function findNetwork(persisted) {
  if (persisted == null) return null;
  const text = String(persisted);
  return BY_ID.get(text) ?? BY_CHAIN_ID.get(text) ?? null;
}

/** The value to persist for a network: chainId for EVM, id otherwise. */
export function networkPersistKey(network) {
  return network.kind === 'evm' ? String(network.chainId) : network.id;
}

/** True when the account's scheme may operate on this network. */
export function schemeAllowedOn(network, scheme) {
  return network.schemes.includes(scheme);
}

/** Explorer URL for a transaction hash/digest/signature on a network. */
export function explorerTxUrlFor(network, hash) {
  if (!network.explorerTx) return null;
  return network.explorerTx.replace('{hash}', hash);
}

/** ERC-20 transfer(address,uint256) calldata (EVM token sends). */
export function erc20TransferData(to, amount) {
  const addr = String(to).toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(addr)) throw Error('Invalid address');
  const value = typeof amount === 'bigint' ? amount : BigInt(amount);
  if (value < 0n) throw Error('amount cannot be negative');
  return '0xa9059cbb' + addr.padStart(64, '0') + value.toString(16).padStart(64, '0');
}

/** balanceOf(address) calldata for eth_call. */
export function erc20BalanceOfData(owner) {
  const addr = String(owner).toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(addr)) throw Error('Invalid address');
  return '0x70a08231' + addr.padStart(64, '0');
}
