import { getNetwork } from './ecosystem-registry.mjs';

const RPC_TIMEOUT_MS = 8_000;
const EVM_HASH = /^0x[0-9a-f]{64}$/i;
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;

async function postJson(url, payload, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    method: 'POST',
    credentials: 'omit',
    redirect: 'error',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message || 'RPC request failed');
  if (!Object.hasOwn(body, 'result')) throw new Error('RPC response is missing result');
  return body.result;
}

function rpcUrlFor(network, pageUrl = globalThis.location?.href || 'https://localhost/') {
  if (network.id === 'zeronyth-9127') return new URL('./rpc', pageUrl).href;
  if (!network.rpcUrl) throw new Error('No public RPC is configured for this network');
  return network.rpcUrl;
}

export async function probeNetwork(networkId, { fetchImpl = fetch, pageUrl } = {}) {
  const network = getNetwork(networkId);
  if (!network) throw new Error('Unknown network profile');
  const rpcUrl = rpcUrlFor(network, pageUrl);
  if (network.family === 'evm') {
    const chainHex = await postJson(rpcUrl, {
      jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [],
    }, fetchImpl);
    if (typeof chainHex !== 'string' || !/^0x[0-9a-f]+$/i.test(chainHex)) {
      throw new Error('RPC returned an invalid chain ID');
    }
    const chainId = Number(BigInt(chainHex));
    if (chainId !== network.chainId) {
      return { state: 'mismatch', expected: network.chainId, observed: chainId, rpcUrl };
    }
    return { state: 'online', expected: network.chainId, observed: chainId, rpcUrl };
  }
  const version = await postJson(rpcUrl, {
    jsonrpc: '2.0', id: 1, method: 'getVersion', params: [],
  }, fetchImpl);
  if (typeof version?.['solana-core'] !== 'string') throw new Error('Solana RPC returned an invalid version');
  return { state: 'online', cluster: network.cluster, version: version['solana-core'], rpcUrl };
}

export async function lookupTransaction(networkId, hash, { fetchImpl = fetch, pageUrl } = {}) {
  const network = getNetwork(networkId);
  if (!network) throw new Error('Choose a supported testnet first');
  if (network.family === 'evm') {
    if (!EVM_HASH.test(hash)) throw new Error('Enter a 32-byte EVM transaction hash');
    const rpcUrl = rpcUrlFor(network, pageUrl);
    const chainHex = await postJson(rpcUrl, {
      jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [],
    }, fetchImpl);
    if (Number(BigInt(chainHex)) !== network.chainId) throw new Error('RPC chain ID did not match the selected testnet');
    const receipt = await postJson(rpcUrl, {
      jsonrpc: '2.0', id: 2, method: 'eth_getTransactionReceipt', params: [hash],
    }, fetchImpl);
    if (!receipt) {
      const transaction = await postJson(rpcUrl, {
        jsonrpc: '2.0', id: 3, method: 'eth_getTransactionByHash', params: [hash],
      }, fetchImpl);
      return {
        chain: network.name,
        hash,
        state: transaction ? 'pending' : 'not-found',
        type: 'EVM transaction lookup',
        explorerUrl: network.explorerUrl ? `${network.explorerUrl}/tx/${hash}` : null,
        blockNumber: null,
        confirmations: null,
      };
    }
    if (receipt.status !== '0x0' && receipt.status !== '0x1') {
      throw new Error('RPC returned a transaction receipt without a valid status');
    }
    const latestHex = await postJson(rpcUrl, {
      jsonrpc: '2.0', id: 4, method: 'eth_blockNumber', params: [],
    }, fetchImpl);
    const blockNumber = Number(BigInt(receipt.blockNumber));
    const latest = Number(BigInt(latestHex));
    return {
      chain: network.name,
      hash,
      state: receipt.status === '0x1' ? 'confirmed' : 'failed',
      type: 'EVM transaction lookup',
      explorerUrl: network.explorerUrl ? `${network.explorerUrl}/tx/${hash}` : null,
      blockNumber,
      confirmations: Math.max(0, latest - blockNumber + 1),
    };
  }
  if (!SOLANA_SIGNATURE.test(hash)) throw new Error('Enter a valid Solana transaction signature');
  const rpcUrl = rpcUrlFor(network, pageUrl);
  const result = await postJson(rpcUrl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'getSignatureStatuses',
    params: [[hash], { searchTransactionHistory: true }],
  }, fetchImpl);
  if (!Array.isArray(result?.value) || result.value.length !== 1) {
    throw new Error('Solana RPC returned an invalid signature status response');
  }
  const status = result?.value?.[0];
  if (!status) {
    return {
      chain: network.name,
      hash,
      state: 'not-found',
      type: 'Solana signature lookup',
      explorerUrl: network.explorerUrl ? `https://explorer.solana.com/tx/${hash}?cluster=devnet` : null,
      blockNumber: null,
      confirmations: null,
    };
  }
  const state = status.err ? 'failed'
    : status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized' ? 'confirmed'
      : 'pending';
  return {
    chain: network.name,
    hash,
    state,
    type: 'Solana signature lookup',
    explorerUrl: network.explorerUrl ? `https://explorer.solana.com/tx/${hash}?cluster=devnet` : null,
    blockNumber: status.slot ?? null,
    confirmations: status.confirmations ?? null,
  };
}

export function isValidTransactionId(networkId, value) {
  const network = getNetwork(networkId);
  if (network?.family === 'evm') return EVM_HASH.test(value);
  return network?.family === 'solana' && SOLANA_SIGNATURE.test(value);
}
