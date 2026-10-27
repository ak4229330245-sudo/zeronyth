export const NETWORKS = Object.freeze([
  {
    id: 'ethereum-sepolia',
    environment: 'testnet',
    name: 'Ethereum Sepolia',
    family: 'evm',
    chainId: 11155111,
    chainHex: '0xaa36a7',
    nativeAsset: { symbol: 'ETH', label: 'Sepolia test ETH', decimals: 18 },
    tokenStandard: 'ERC-20',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    rpcProvider: 'PublicNode (independent public RPC; not an Ethereum Foundation endpoint)',
    explorerUrl: 'https://sepolia.etherscan.io',
    docsUrl: 'https://ethereum.org/developers/docs/networks/',
    faucetUrl: 'https://ethereum.org/developers/docs/networks/',
    capabilities: { connect: true, swap: true, lp: true, bridge: true },
    dex: {
      name: 'Uniswap V3 / Universal Router',
      factory: '0x0227628f3F023bb0B980b67D528571c95c6DaC1c',
      swapRouter02: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
      docs: 'https://docs.uniswap.org/contracts/v3/reference/deployments'
    },
    statusNote: 'Official Uniswap V3 deployments on Sepolia. Swap & LP via SwapRouter02 / PositionManager. Test tokens only; liquidity is sparse.',
  },
  {
    id: 'base-sepolia',
    environment: 'testnet',
    name: 'Base Sepolia',
    family: 'evm',
    chainId: 84532,
    chainHex: '0x14a34',
    nativeAsset: { symbol: 'ETH', label: 'Base Sepolia test ETH', decimals: 18 },
    tokenStandard: 'ERC-20',
    rpcUrl: 'https://sepolia.base.org',
    rpcProvider: 'Base public testnet RPC',
    explorerUrl: 'https://sepolia.basescan.org',
    docsUrl: 'https://docs.base.org/get-started/connect-to-base',
    faucetUrl: 'https://docs.base.org/get-started/connect-to-base',
    capabilities: { connect: true, swap: true, lp: true, bridge: true },
    dex: {
      name: 'Uniswap V3',
      factory: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
      swapRouter02: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
      docs: 'https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments'
    },
    statusNote: 'Uniswap V3 factory & SwapRouter02 deployed on Base Sepolia. External bridge handoff also available. Test assets only.',
  },
  {
    id: 'arbitrum-sepolia',
    environment: 'testnet',
    name: 'Arbitrum Sepolia',
    family: 'evm',
    chainId: 421614,
    chainHex: '0x66eee',
    nativeAsset: { symbol: 'ETH', label: 'Arbitrum Sepolia test ETH', decimals: 18 },
    tokenStandard: 'ERC-20',
    rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    rpcProvider: 'Arbitrum Sepolia public RPC',
    explorerUrl: 'https://sepolia.arbiscan.io',
    docsUrl: 'https://docs.arbitrum.io/arbitrum-bridge',
    faucetUrl: 'https://docs.arbitrum.io/arbitrum-bridge',
    capabilities: { connect: true, swap: true, lp: true, bridge: true },
    dex: {
      name: 'Camelot (Algebra)',
      swapRouter: '0x171B925C51565F5D2a7d8C494ba3188D304EFD93',
      factory: '0xaA37Bea711D585478E1c04b04707cCb0f10D762a',
      docs: 'https://docs.camelot.exchange/contracts/arbitrum/sepolia-testnet/'
    },
    statusNote: 'Camelot documents AMMv3 SwapRouter and NonfungiblePositionManager on Arbitrum Sepolia. Test tokens only.',
  },
  {
    id: 'bnb-testnet',
    environment: 'testnet',
    name: 'BNB Smart Chain Testnet',
    family: 'evm',
    chainId: 97,
    chainHex: '0x61',
    nativeAsset: { symbol: 'tBNB', label: 'BNB testnet gas token', decimals: 18 },
    tokenStandard: 'BEP-20',
    rpcUrl: 'https://bsc-testnet-dataseed.bnbchain.org',
    rpcProvider: 'BNB Chain public testnet RPC',
    explorerUrl: 'https://testnet.bscscan.com',
    docsUrl: 'https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/',
    faucetUrl: 'https://docs.bnbchain.org/bnb-smart-chain/developers/faucet/',
    capabilities: { connect: true, swap: true, lp: true, bridge: true },
    dex: {
      name: 'PancakeSwap V2/V3',
      v2Router: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1',
      v2Factory: '0x6725F303b657a9451d8BA641348b6761A6CC7a17',
      docs: 'https://developer.pancakeswap.finance/contracts/v2/addresses'
    },
    statusNote: 'Official PancakeSwap V2 router/factory on BSC Testnet. V3 also documented. Use tBNB and test tokens only.',
  },
  {
    id: 'solana-devnet',
    environment: 'testnet',
    name: 'Solana Devnet',
    family: 'solana',
    cluster: 'devnet',
    nativeAsset: { symbol: 'SOL', label: 'Devnet SOL', decimals: 9 },
    tokenStandard: 'SPL Token',
    rpcUrl: 'https://api.devnet.solana.com',
    rpcProvider: 'Solana public Devnet RPC',
    explorerUrl: 'https://explorer.solana.com/?cluster=devnet',
    docsUrl: 'https://solana.com/docs/references/clusters',
    faucetUrl: 'https://solana.com/docs/references/clusters',
    capabilities: { connect: true, swap: true, lp: true, bridge: true },
    dex: {
      name: 'Raydium / Jupiter (limited)',
      note: 'Devnet pools are sparse; users typically create own SPL tokens and pools via Raydium SDK.',
      docs: 'https://docs.raydium.io'
    },
    statusNote: 'Raydium SDK supports Devnet. Liquidity is very limited; most practical path is self-created test pools. Devnet may reset.',
  },
  {
    id: 'robinhood-testnet',
    environment: 'testnet',
    name: 'Robinhood Chain Testnet',
    family: 'evm',
    chainId: 46630,
    chainHex: '0xb626',
    nativeAsset: { symbol: 'ETH', label: 'Robinhood Chain testnet gas ETH', decimals: 18 },
    tokenStandard: 'ERC-20',
    rpcUrl: 'https://rpc.testnet.chain.robinhood.com',
    rpcProvider: 'Robinhood Chain documented testnet RPC',
    explorerUrl: 'https://explorer.testnet.chain.robinhood.com',
    docsUrl: 'https://docs.robinhood.com/chain/connecting',
    faucetUrl: null,
    officialTestTokens: [],
    capabilities: { connect: true, swap: true, lp: false, bridge: true },
    dex: {
      name: 'Uniswap V4 (limited on testnet)',
      note: 'Some sources note Uniswap V4 activity on Robinhood testnet; V3 may be absent. Liquidity extremely sparse.',
      docs: 'https://hood.dev/docs/chain'
    },
    statusNote: 'Limited Uniswap V4 presence reported on Robinhood Chain testnet. No reliable public LP routes confirmed; treat as experimental.',
  },
  {
    id: 'monad-testnet',
    environment: 'testnet',
    name: 'Monad Testnet',
    family: 'evm',
    chainId: 10143,
    chainHex: '0x279f',
    nativeAsset: { symbol: 'MON', label: 'Monad testnet MON', decimals: 18 },
    tokenStandard: 'ERC-20',
    rpcUrl: 'https://testnet-rpc.monad.xyz',
    rpcProvider: 'Monad Foundation testnet RPC',
    explorerUrl: 'https://testnet.monadvision.com',
    docsUrl: 'https://docs.monad.xyz/developer-essentials/testnet',
    faucetUrl: 'https://faucet.monad.xyz',
    capabilities: { connect: true, swap: true, lp: true, bridge: true },
    dex: {
      name: 'Uniswap V4 / V3 (testnet)',
      note: 'Monad docs reference Uniswap V4 PoolManager, PositionManager, Universal Router on testnet (chain 10143).',
      docs: 'https://docs.monad.xyz/guides/uniswap-v4-hooks'
    },
    statusNote: 'Uniswap deployments documented on Monad Testnet. Use official faucet tokens only. Pools are user-created.',
  },
  {
    id: 'zeronyth-9127',
    environment: 'testnet',
    name: 'ZERONYTH Testnet',
    family: 'evm',
    chainId: 9127,
    chainHex: '0x23a7',
    nativeAsset: { symbol: 'ZNYT', label: 'Public testnet token; no monetary value', decimals: 18 },
    tokenStandard: 'EVM / ERC-20-compatible',
    rpcUrl: 'https://zeronyth.dpdns.org/rpc',
    rpcProvider: 'ZERONYTH public RPC gateway (rate-limited)',
    explorerUrl: 'https://scan.zeronyth.dpdns.org',
    docsUrl: '/',
    faucetUrl: '/#faucetPanel',
    capabilities: { connect: true, swap: true, lp: true, bridge: true },
    dex: {
      name: 'ZERONYTH AMM (testnet)',
      note: 'Swap and liquidity for testnet z-tokens on Chain ID 9127.',
      docs: '/amm.html'
    },
    statusNote: 'Public testnet only. Native swap/bridge requires ML-DSA verification (quantum-resistant). External testnet routes are ECDSA and labeled non-PQ. No mainnet assets.',
  },
]);

export const BRIDGE_ROUTES = Object.freeze([
  {
    id: 'sepolia-to-base-sepolia',
    source: 'ethereum-sepolia',
    destination: 'base-sepolia',
    asset: 'ETH',
    mode: 'external-handoff',
    documentation: 'https://docs.base.org/base-chain/network-information/ecosystem-bridges',
    providers: [
      {
        name: 'Superbridge',
        url: 'https://superbridge.app/?fromChainId=11155111&toChainId=84532',
      },
      {
        name: 'Brid.gg',
        url: 'https://testnet.brid.gg/?fromChainId=11155111&toChainId=84532',
      },
    ],
  },
]);

const MAINNET_CHAIN_IDS = new Set([1, 56, 137, 8453, 42161, 10, 143]);

export function getNetwork(id) {
  return NETWORKS.find((network) => network.id === id) || null;
}

export function getNetworkByChainId(chainId) {
  return NETWORKS.find((network) => network.family === 'evm' && network.chainId === Number(chainId)) || null;
}

export function validateNetworkRegistry(networks = NETWORKS) {
  const ids = new Set();
  for (const network of networks) {
    if (!network.id || ids.has(network.id)) throw new Error('Duplicate or missing network ID');
    ids.add(network.id);
    if (network.environment !== 'testnet') throw new Error(`Only explicit testnet entries are allowed: ${network.id}`);
    if (network.family === 'evm' && MAINNET_CHAIN_IDS.has(network.chainId)) {
      throw new Error(`Mainnet Chain ID is not allowed: ${network.chainId}`);
    }
    if ((network.capabilities?.swap || network.capabilities?.lp) && !network.dex) {
      throw new Error(`Swap/LP enabled without documented DEX reference: ${network.id}`);
    }
    if (network.rpcUrl && !network.rpcUrl.startsWith('https://') && network.id !== 'zeronyth-9127') {
      throw new Error(`External RPC must use HTTPS: ${network.id}`);
    }
  }
  if (networks.length !== 8) throw new Error('Exactly eight requested testnet profiles are required');
  return true;
}

validateNetworkRegistry();
