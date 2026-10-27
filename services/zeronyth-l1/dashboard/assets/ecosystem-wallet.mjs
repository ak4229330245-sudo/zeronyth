const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;

function providerLabel(info, index) {
  return info?.name || info?.rdns || `Injected wallet ${index + 1}`;
}

export async function discoverEvmWallets(host = window, waitMs = 250) {
  const found = new Map();
  const add = (provider, info = {}) => {
    if (!provider || typeof provider.request !== 'function') return;
    const key = info.rdns || info.uuid || provider;
    if (!found.has(key)) found.set(key, { provider, info, label: providerLabel(info, found.size) });
  };
  const announce = (event) => add(event.detail?.provider, event.detail?.info);
  host.addEventListener?.('eip6963:announceProvider', announce);
  try {
    host.dispatchEvent?.(new Event('eip6963:requestProvider'));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    const known = [
      ['isMetaMask', 'MetaMask'],
      ['isOkxWallet', 'OKX Wallet'],
      ['isBitKeep', 'Bitget Wallet'],
      ['isKrakenWallet', 'Kraken Wallet'],
      ['isRabby', 'Rabby'],
      ['isCoinbaseWallet', 'Coinbase Wallet'],
    ];
    function labelFor(provider) {
      for (const [flag, name] of known) if (provider?.[flag]) return name;
      return undefined;
    }
    const injected = host.ethereum;
    if (Array.isArray(injected?.providers)) {
      injected.providers.forEach((provider, index) => add(provider, { name: labelFor(provider) || `Injected wallet ${index + 1}` }));
    } else if (injected) {
      add(injected, { name: labelFor(injected) || (injected.isMetaMask ? 'MetaMask' : undefined) });
    }
    if (host.okxwallet) add(host.okxwallet, { name: 'OKX Wallet' });
    if (host.bitkeep?.ethereum) add(host.bitkeep.ethereum, { name: 'Bitget Wallet' });
  } finally {
    host.removeEventListener?.('eip6963:announceProvider', announce);
  }
  return [...found.values()];
}

export async function connectEvmWallet(provider) {
  if (!provider || typeof provider.request !== 'function') throw new Error('Choose a detected EVM wallet');
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const address = Array.isArray(accounts) ? accounts[0] : null;
  if (typeof address !== 'string' || !EVM_ADDRESS.test(address)) throw new Error('The wallet did not return a valid account');
  return { provider, address, kind: 'evm' };
}

export async function switchEvmNetwork(provider, network) {
  if (!provider || typeof provider.request !== 'function') throw new Error('Connect an EVM wallet first');
  if (network.family !== 'evm' || !network.chainHex) throw new Error('This network does not use EVM chain switching');
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: network.chainHex }],
    });
  } catch (error) {
    if (Number(error?.code) !== 4902) throw error;
    if (!network.rpcUrl) throw new Error('This private network cannot be added automatically. Use its operator-provided wallet settings.');
    const addParams = {
      chainId: network.chainHex,
      chainName: network.name,
      nativeCurrency: {
        name: network.nativeAsset.label,
        symbol: network.nativeAsset.symbol,
        decimals: network.nativeAsset.decimals,
      },
      rpcUrls: [network.rpcUrl],
    };
    if (network.explorerUrl?.startsWith('https://')) addParams.blockExplorerUrls = [network.explorerUrl];
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [addParams],
    });
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: network.chainHex }],
    });
  }
  const actualChainHex = await provider.request({ method: 'eth_chainId' });
  if (String(actualChainHex).toLowerCase() !== network.chainHex.toLowerCase()) {
    throw new Error('Wallet did not switch to the selected chain');
  }
  return { chainId: network.chainId };
}

export function discoverSolanaWallet(host = window) {
  const candidates = [
    ['Phantom', host.phantom?.solana],
    ['Solflare', host.solflare],
    ['Injected Solana wallet', host.solana],
  ];
  const seen = new Set();
  return candidates
    .filter(([, provider]) => provider && typeof provider.connect === 'function')
    .filter(([, provider]) => !seen.has(provider) && seen.add(provider))
    .map(([label, provider]) => ({ label, provider }));
}

export async function connectSolanaWallet(provider) {
  if (!provider || typeof provider.connect !== 'function') throw new Error('No compatible injected Solana wallet was detected');
  const response = await provider.connect();
  const publicKey = response?.publicKey || provider.publicKey;
  const address = typeof publicKey === 'string' ? publicKey : publicKey?.toBase58?.();
  if (typeof address !== 'string' || address.length < 32 || address.length > 44) {
    throw new Error('The Solana wallet did not return a valid public key');
  }
  return { provider, address, kind: 'solana' };
}

export function shortAddress(address) {
  return typeof address === 'string' && address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address || '';
}


// WalletConnect support (optional, requires @walletconnect/ethereum-provider or similar at runtime)
export async function connectWalletConnect(projectId) {
  if (!projectId) throw new Error('WalletConnect projectId is required');
  // Dynamic import so the bundle stays light if WC is not used
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
  const provider = await EthereumProvider.init({
    projectId,
    chains: [11155111, 84532, 421614, 97, 9127], // testnets only
    showQrModal: true,
    optionalChains: [10143, 46630],
  });
  await provider.connect();
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const address = accounts?.[0];
  if (!address) throw new Error('WalletConnect did not return an account');
  return { provider, address, kind: 'walletconnect' };
}

export function isWalletConnectAvailable() {
  return typeof window !== 'undefined';
}
