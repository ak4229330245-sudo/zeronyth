import test from 'node:test';
import assert from 'node:assert/strict';
import { BRIDGE_ROUTES, NETWORKS, getNetwork, validateNetworkRegistry } from '../dashboard/assets/ecosystem-registry.mjs';
import { lookupTransaction, probeNetwork } from '../dashboard/assets/ecosystem-rpc.mjs';
import { connectEvmWallet, connectSolanaWallet, discoverSolanaWallet, switchEvmNetwork } from '../dashboard/assets/ecosystem-wallet.mjs';

const jsonResponse = (result, status = 200) => new Response(JSON.stringify({
  jsonrpc: '2.0', id: 1, result,
}), { status, headers: { 'content-type': 'application/json' } });

function mockFetch(results) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const request = JSON.parse(options.body);
    calls.push({ url, request });
    const response = results[request.method];
    if (response instanceof Error) throw response;
    if (response?.rpcError) {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { message: response.rpcError } }), { status: 200 });
    }
    return jsonResponse(typeof response === 'function' ? response(request) : response);
  };
  return { fetchImpl, calls };
}

test('registry contains exactly the requested eight testnet profiles', () => {
  assert.equal(validateNetworkRegistry(), true);
  assert.deepEqual(NETWORKS.map((network) => network.id), [
    'ethereum-sepolia', 'base-sepolia', 'arbitrum-sepolia', 'bnb-testnet',
    'solana-devnet', 'robinhood-testnet', 'monad-testnet', 'zeronyth-9127',
  ]);
  assert.ok(NETWORKS.every((network) => network.capabilities.swap === false && network.capabilities.lp === false));
  assert.equal(getNetwork('robinhood-testnet').chainId, 46630);
  assert.equal(getNetwork('robinhood-testnet').nativeAsset.symbol, 'ETH');
  assert.deepEqual(getNetwork('robinhood-testnet').officialTestTokens, []);
  assert.equal(getNetwork('robinhood-testnet').faucetUrl, null);
  assert.equal(BRIDGE_ROUTES.length, 1);
  assert.equal(BRIDGE_ROUTES[0].mode, 'external-handoff');
});

test('registry rejects mainnet entries and unverified swap or LP capability', () => {
  const original = NETWORKS[0];
  assert.throws(() => validateNetworkRegistry([
    ...NETWORKS.slice(0, 7),
    { ...original, id: 'unsafe-mainnet', chainId: 1 },
  ]), /Mainnet Chain ID/);
  assert.throws(() => validateNetworkRegistry([
    ...NETWORKS.slice(0, 7),
    { ...original, id: 'unverified-lp', capabilities: { connect: true, swap: false, lp: true } },
  ]), /Unverified swap\/LP/);
});

test('EVM probe checks expected chain ID and does not treat a mismatch as online', async () => {
  const network = getNetwork('robinhood-testnet');
  const ok = mockFetch({ eth_chainId: '0xb626' });
  assert.equal((await probeNetwork(network.id, { fetchImpl: ok.fetchImpl })).state, 'online');
  assert.equal(ok.calls.length, 1);

  const mismatch = mockFetch({ eth_chainId: '0x1' });
  assert.deepEqual(
    await probeNetwork(network.id, { fetchImpl: mismatch.fetchImpl }),
    { state: 'mismatch', expected: 46630, observed: 1, rpcUrl: network.rpcUrl },
  );
});

test('Solana probe requires a version response from the configured Devnet endpoint', async () => {
  const response = mockFetch({ getVersion: { 'solana-core': '4.4.0-beta.1' } });
  const result = await probeNetwork('solana-devnet', { fetchImpl: response.fetchImpl });
  assert.equal(result.state, 'online');
  assert.equal(result.cluster, 'devnet');
});

test('EVM lookup confirms only an included receipt and reports block evidence', async () => {
  const hash = `0x${'a'.repeat(64)}`;
  const response = mockFetch({
    eth_chainId: '0x14a34',
    eth_getTransactionReceipt: { status: '0x1', blockNumber: '0x64' },
    eth_blockNumber: '0x6f',
  });
  const result = await lookupTransaction('base-sepolia', hash, { fetchImpl: response.fetchImpl });
  assert.equal(result.state, 'confirmed');
  assert.equal(result.blockNumber, 100);
  assert.equal(result.confirmations, 12);
  assert.equal(result.explorerUrl, `https://sepolia.basescan.org/tx/${hash}`);
  assert.deepEqual(response.calls.map((call) => call.request.method), [
    'eth_chainId', 'eth_getTransactionReceipt', 'eth_blockNumber',
  ]);
});

test('EVM lookup distinguishes pending from RPC-not-found and rejects wrong-chain responses', async () => {
  const hash = `0x${'b'.repeat(64)}`;
  const pending = mockFetch({
    eth_chainId: '0xaa36a7',
    eth_getTransactionReceipt: null,
    eth_getTransactionByHash: { hash },
  });
  assert.equal((await lookupTransaction('ethereum-sepolia', hash, { fetchImpl: pending.fetchImpl })).state, 'pending');

  const absent = mockFetch({
    eth_chainId: '0xaa36a7',
    eth_getTransactionReceipt: null,
    eth_getTransactionByHash: null,
  });
  assert.equal((await lookupTransaction('ethereum-sepolia', hash, { fetchImpl: absent.fetchImpl })).state, 'not-found');

  const wrongChain = mockFetch({ eth_chainId: '0x1' });
  await assert.rejects(lookupTransaction('ethereum-sepolia', hash, { fetchImpl: wrongChain.fetchImpl }), /did not match/);
  await assert.rejects(lookupTransaction('ethereum-sepolia', 'not-a-hash', { fetchImpl: wrongChain.fetchImpl }), /32-byte/);
});

test('Solana lookup maps RPC status to included, pending, and failed states', async () => {
  const signature = '5'.repeat(88);
  const confirmed = mockFetch({
    getSignatureStatuses: { value: [{ slot: 77, confirmations: null, confirmationStatus: 'finalized', err: null }] },
  });
  const result = await lookupTransaction('solana-devnet', signature, { fetchImpl: confirmed.fetchImpl });
  assert.equal(result.state, 'confirmed');
  assert.equal(result.blockNumber, 77);
  assert.match(result.explorerUrl, /cluster=devnet$/);

  const failed = mockFetch({ getSignatureStatuses: { value: [{ slot: 78, err: { InstructionError: [0, 'Custom'] } }] } });
  assert.equal((await lookupTransaction('solana-devnet', signature, { fetchImpl: failed.fetchImpl })).state, 'failed');

  const missing = mockFetch({ getSignatureStatuses: { value: [null] } });
  assert.equal((await lookupTransaction('solana-devnet', signature, { fetchImpl: missing.fetchImpl })).state, 'not-found');
});

test('EVM wallet connect requests account access only and validates returned address', async () => {
  const methods = [];
  const provider = {
    request: async ({ method }) => {
      methods.push(method);
      if (method === 'eth_requestAccounts') return ['0x1111111111111111111111111111111111111111'];
      throw new Error(`Unexpected method: ${method}`);
    },
  };
  const result = await connectEvmWallet(provider);
  assert.equal(result.kind, 'evm');
  assert.deepEqual(methods, ['eth_requestAccounts']);
  await assert.rejects(connectEvmWallet({ request: async () => ['invalid'] }), /valid account/);
});

test('wallet switching adds only a configured testnet and verifies the selected chain', async () => {
  const requests = [];
  let added;
  const provider = {
    request: async ({ method, params }) => {
      requests.push(method);
      if (method === 'wallet_switchEthereumChain' && requests.filter((item) => item === method).length === 1) {
        const error = new Error('Unknown chain'); error.code = 4902; throw error;
      }
      if (method === 'wallet_addEthereumChain') { added = params[0]; return null; }
      if (method === 'eth_chainId') return '0xb626';
      return null;
    },
  };
  const result = await switchEvmNetwork(provider, getNetwork('robinhood-testnet'));
  assert.equal(result.chainId, 46630);
  assert.equal(added.chainId, '0xb626');
  assert.equal(added.rpcUrls[0], 'https://rpc.testnet.chain.robinhood.com');
  assert.deepEqual(requests, [
    'wallet_switchEthereumChain', 'wallet_addEthereumChain',
    'wallet_switchEthereumChain', 'eth_chainId',
  ]);

  // ZERONYTH Testnet is public now: it is added with its public HTTPS RPC (never a localhost URL).
  let zAdded; let zSwitches = 0;
  const zeronythProvider = {
    request: async ({ method, params }) => {
      if (method === 'wallet_switchEthereumChain') { zSwitches++; if (zSwitches === 1) { const error = new Error('Unknown'); error.code = 4902; throw error; } return null; }
      if (method === 'wallet_addEthereumChain') { zAdded = params[0]; return null; }
      if (method === 'eth_chainId') return '0x23a7';
      throw new Error(`Must not call ${method}`);
    },
  };
  const z = await switchEvmNetwork(zeronythProvider, getNetwork('zeronyth-9127'));
  assert.equal(z.chainId, 9127);
  assert.equal(zAdded.rpcUrls[0], 'https://zeronyth.dpdns.org/rpc');
});

test('Solana wallet connect uses an explicit injected-wallet connect and does not sign', async () => {
  const methods = [];
  const provider = {
    connect: async () => {
      methods.push('connect');
      return { publicKey: { toBase58: () => '1'.repeat(44) } };
    },
  };
  const detected = discoverSolanaWallet({ phantom: { solana: provider } });
  assert.equal(detected.length, 1);
  assert.equal(detected[0].label, 'Phantom');
  assert.equal((await connectSolanaWallet(provider)).kind, 'solana');
  assert.deepEqual(methods, ['connect']);
});
