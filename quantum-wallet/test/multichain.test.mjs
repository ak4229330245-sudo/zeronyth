// Multi-chain session tests (v12): network registry invariants, remote
// EVM sends (chainId verification, EIP-155 chain binding, wZNYT token
// sends, contract-recipient detection), the session-layer PQ gate, and
// the sent-address history behind the first-send warning.
// All headless with injected fakes — no network access.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { memoryStorage } from '../src/core/storage.mjs';
import { decodeRawTransaction } from '../src/core/tx.mjs';
import {
  NETWORKS,
  DEFAULT_NETWORK_ID,
  getNetwork,
  findNetwork,
  networkPersistKey,
  schemeAllowedOn,
  WZNYT_ADDRESS,
  erc20TransferData,
  erc20BalanceOfData,
} from '../src/core/networks.mjs';
import {
  createSession,
  NETWORK_KEY,
  isFirstSendAddress,
  normalizeSentAddress,
} from '../src/app/session.mjs';
import { PASSWORD } from './fixtures.mjs';

const WZNYT = WZNYT_ADDRESS;

// ------------------------------------------------------------------ fakes

function fakeRpc({ chainIdHex = '0x14a34', code = '0x', tokenBalance = 0n } = {}) {
  const calls = [];
  const state = { chainIdHex };
  return {
    calls,
    setChainId(hex) {
      state.chainIdHex = hex;
    },
    async call(method, params = []) {
      calls.push({ method, params });
      if (method === 'eth_chainId') return state.chainIdHex;
      throw Error(`unexpected call ${method}`);
    },
    async getTransactionCount() {
      return 3;
    },
    async gasPrice() {
      return 1000000000n;
    },
    async getBalance() {
      return 5000000000000000000n;
    },
    async estimateGas(tx) {
      calls.push({ method: 'eth_estimateGas', params: [tx] });
      return 21000n;
    },
    async sendRawTransaction(raw) {
      calls.push({ method: 'eth_sendRawTransaction', params: [raw] });
      return '0x' + 'cd'.repeat(32);
    },
    async getTransactionReceipt() {
      return { status: '0x1', transactionHash: '0x' + 'cd'.repeat(32) };
    },
    async ethCall({ to, data }) {
      calls.push({ method: 'eth_call', params: [{ to, data }] });
      if (data.startsWith('0x70a08231')) {
        // balanceOf(address)
        return '0x' + tokenBalance.toString(16).padStart(64, '0');
      }
      throw Error(`unexpected eth_call data ${data}`);
    },
    async getCode(address) {
      calls.push({ method: 'eth_getCode', params: [address] });
      return code;
    },
  };
}

function makeSession(storage, rpc, extra = {}) {
  return createSession({
    storage,
    rpcFactory: () => rpc,
    sleep: async () => {},
    ...extra,
  });
}

async function walletWith(storage, rpc, schemes, extra = {}) {
  const session = makeSession(storage, rpc, extra);
  await session.create(PASSWORD, schemes[0]);
  for (const s of schemes.slice(1)) await session.addAccount(s);
  return session;
}

const byScheme = (session, scheme) => session.state.accounts.find((a) => a.scheme === scheme);
const RECIPIENT = '0x1111111111111111111111111111111111111111';

// ------------------------------------------------------- registry tests

test('registry: exactly 16 networks with unique ids', () => {
  assert.equal(NETWORKS.length, 16);
  assert.equal(new Set(NETWORKS.map((n) => n.id)).size, 16);
  assert.equal(getNetwork(DEFAULT_NETWORK_ID).chainId, 912701);
});

test('registry: EVM networks are zeronyth + the five approved remotes', () => {
  const evm = NETWORKS.filter((n) => n.kind === 'evm');
  assert.deepEqual(
    evm.map((n) => n.chainId).sort((a, b) => a - b),
    [84532, 11155111, 421614, 46630, 5042002, 912701].sort((a, b) => a - b),
  );
  const families = NETWORKS.filter((n) => n.kind !== 'evm');
  assert.equal(families.length, 10);
  for (const fam of ['solana', 'bitcoin', 'xrp', 'sui', 'aptos']) {
    assert.equal(families.filter((n) => n.kind === fam).length, 2, `${fam} mainnet+test`);
  }
});

test('registry: wZNYT rides exactly the four bridge remotes — not Arc, not ZERONYTH', () => {
  const carriers = NETWORKS.filter((n) =>
    (n.tokens ?? []).some((t) => t.address === WZNYT),
  ).map((n) => n.id);
  assert.deepEqual(carriers.sort(), [
    'arbitrum-sepolia',
    'base-sepolia',
    'ethereum-sepolia',
    'robinhood-testnet',
  ]);
  const arc = getNetwork('arc-testnet');
  assert.equal(arc.native.symbol, 'USDC');
  assert.equal(arc.native.decimals, 18);
  assert.equal(arc.tokens.length, 0);
});

test('registry: persistence round-trips (EVM by chainId, families by id)', () => {
  for (const net of NETWORKS) {
    assert.equal(findNetwork(networkPersistKey(net))?.id, net.id, net.id);
  }
  assert.equal(findNetwork('84532')?.id, 'base-sepolia');
  assert.equal(findNetwork('912701')?.id, 'zeronyth');
  assert.equal(findNetwork('nope'), null);
  assert.equal(findNetwork(null), null);
});

test('registry: scheme gating matrix', () => {
  const z = getNetwork('zeronyth');
  for (const s of ['ecdsa', 'falcon', 'mldsa']) assert.ok(schemeAllowedOn(z, s), s);
  for (const id of ['base-sepolia', 'ethereum-sepolia', 'arbitrum-sepolia', 'robinhood-testnet', 'arc-testnet']) {
    const net = getNetwork(id);
    assert.ok(schemeAllowedOn(net, 'ecdsa'), `${id} ecdsa`);
    assert.ok(!schemeAllowedOn(net, 'mldsa'), `${id} mldsa`);
    assert.ok(!schemeAllowedOn(net, 'falcon'), `${id} falcon`);
  }
  assert.ok(schemeAllowedOn(getNetwork('solana-devnet'), 'solana'));
  assert.ok(!schemeAllowedOn(getNetwork('solana-devnet'), 'ecdsa'));
  assert.ok(!schemeAllowedOn(getNetwork('bitcoin-testnet'), 'xrp'));
  assert.ok(schemeAllowedOn(getNetwork('xrp-testnet'), 'xrp'));
});

// -------------------------------------------------------- session: remote EVM

test('remote EVM: native send verifies chainId, buffers gas +20%, binds EIP-155 chain', async () => {
  const rpc = fakeRpc({ chainIdHex: '0x14a34' }); // 84532 = 0x14a34
  const session = await walletWith(memoryStorage(), rpc, ['ecdsa']);
  const acct = byScheme(session, 'ecdsa');
  session.setNetwork('base-sepolia');
  assert.equal(session.state.networkId, 'base-sepolia');

  const prepared = await session.prepareSend(acct.id, { to: RECIPIENT, value: 1000n });
  assert.equal(prepared.chainId, 84532n);
  assert.equal(prepared.estimate, 21000n);
  assert.equal(prepared.gasLimit, 25200n); // 21000 + 20%
  assert.equal(prepared.recipientIsContract, false);
  // chainId was the FIRST eth call the session made to this RPC
  assert.equal(rpc.calls[0].method, 'eth_chainId');

  const { hash, signed } = await session.executeSend(prepared);
  assert.equal(hash, '0x' + 'cd'.repeat(32));
  const decoded = decodeRawTransaction(signed.rawTx);
  assert.equal(decoded.scheme, 'ecdsa');
  assert.equal(decoded.chainId, 84532n, 'EIP-155 v binds the remote chainId');
  assert.equal(decoded.from.toLowerCase(), acct.address.toLowerCase());
  assert.equal(decoded.value, 1000n);
});

test('remote EVM: RPC chainId mismatch aborts before any signing material exists', async () => {
  const rpc = fakeRpc({ chainIdHex: '0x1' }); // mainnet answers instead
  const session = await walletWith(memoryStorage(), rpc, ['ecdsa']);
  const acct = byScheme(session, 'ecdsa');
  session.setNetwork('base-sepolia');
  await assert.rejects(
    () => session.prepareSend(acct.id, { to: RECIPIENT, value: 1n }),
    /Chain ID mismatch: RPC reports chain 1, expected 84532/,
  );
  assert.ok(!rpc.calls.some((c) => c.method === 'eth_sendRawTransaction'));
});

test('remote EVM: contract recipient is flagged via eth_getCode', async () => {
  const rpc = fakeRpc({ chainIdHex: '0x14a34', code: '0x6080604052' });
  const session = await walletWith(memoryStorage(), rpc, ['ecdsa']);
  const acct = byScheme(session, 'ecdsa');
  session.setNetwork('base-sepolia');
  const prepared = await session.prepareSend(acct.id, { to: RECIPIENT, value: 1n });
  assert.equal(prepared.recipientIsContract, true);
});

test('remote EVM: wZNYT token send builds transfer calldata and reads balanceOf', async () => {
  const rpc = fakeRpc({ chainIdHex: '0x14a34', tokenBalance: 777n });
  const session = await walletWith(memoryStorage(), rpc, ['ecdsa']);
  const acct = byScheme(session, 'ecdsa');
  session.setNetwork('base-sepolia');
  const prepared = await session.prepareSend(acct.id, {
    to: RECIPIENT,
    value: 55n,
    asset: WZNYT,
  });
  assert.equal(prepared.txTo.toLowerCase(), WZNYT.toLowerCase());
  assert.equal(prepared.txValue, 0n);
  assert.equal(prepared.data, erc20TransferData(RECIPIENT, 55n));
  assert.ok(prepared.data.startsWith('0xa9059cbb'));
  assert.equal(prepared.balance, 777n, 'token balance from balanceOf');
  assert.equal(prepared.symbol, 'wZNYT');
  // an asset that is not a known token on this network is rejected
  await assert.rejects(
    () => session.prepareSend(acct.id, { to: RECIPIENT, value: 1n, asset: RECIPIENT }),
    /Unknown token/,
  );
  // and wZNYT does not exist on Arc at all
  session.setNetwork('arc-testnet');
  rpc.setChainId('0x4cef52'); // 5042002
  await assert.rejects(
    () => session.prepareSend(acct.id, { to: RECIPIENT, value: 1n, asset: WZNYT }),
    /Unknown token/,
  );
});

// -------------------------------------------------------- session: PQ gate

test('PQ gate: ML-DSA and Falcon accounts cannot prepare sends off ZERONYTH', async () => {
  const rpc = fakeRpc({ chainIdHex: '0x14a34' });
  const session = await walletWith(memoryStorage(), rpc, ['ecdsa', 'mldsa', 'falcon']);
  const mldsa = byScheme(session, 'mldsa');
  const falcon = byScheme(session, 'falcon');
  session.setNetwork('base-sepolia');
  for (const acct of [mldsa, falcon]) {
    await assert.rejects(
      () => session.prepareSend(acct.id, { to: RECIPIENT, value: 1n }),
      /PQ accounts can only send on the ZERONYTH network/,
      acct.scheme,
    );
  }
  // chain-family networks reject PQ accounts too (family-specific error)
  session.setNetwork('solana-devnet');
  await assert.rejects(
    () => session.prepareSend(mldsa.id, { to: '6iM8qnMZEM8nRHYyX73KnB7H8Wi8o9BEM2KF3M1U1pQd', value: 1n }),
    /PQ accounts can only send|mldsa account cannot send/,
  );
  // back on ZERONYTH the same accounts prepare fine
  session.setNetwork('zeronyth');
  const ok = await session.prepareSend(mldsa.id, { to: RECIPIENT, value: 1n });
  assert.equal(ok.chainId, 912701n);
  assert.equal(ok.gasLimit, 147176n, 'ML-DSA intrinsic gas on 912701');
});

test('network selection persists: EVM by chainId string, restored on new session', async () => {
  const storage = memoryStorage();
  const rpc = fakeRpc();
  const first = await walletWith(storage, rpc, ['ecdsa']);
  first.setNetwork('ethereum-sepolia');
  assert.equal(storage.getItem(NETWORK_KEY), '11155111');
  const second = makeSession(storage, rpc);
  assert.equal(second.state.networkId, 'ethereum-sepolia');
  first.setNetwork('xrp-testnet');
  assert.equal(storage.getItem(NETWORK_KEY), 'xrp-testnet');
});

// -------------------------------------------------------- first-send history

test('first-send: pure helpers normalize EVM case; history flips after a send', async () => {
  assert.equal(normalizeSentAddress('0xABCDEF0000000000000000000000000000001234'), '0xabcdef0000000000000000000000000000001234');
  assert.equal(normalizeSentAddress('rSomeXrpAddress'), 'rSomeXrpAddress');
  assert.ok(isFirstSendAddress([], RECIPIENT));
  assert.ok(!isFirstSendAddress([RECIPIENT], RECIPIENT.toUpperCase().replace('0X', '0x')));

  const rpc = fakeRpc({ chainIdHex: '0xded3d' });
  const session = await walletWith(memoryStorage(), rpc, ['ecdsa']);
  const acct = byScheme(session, 'ecdsa');
  assert.equal(session.isFirstSendTo(RECIPIENT), true);
  const prepared = await session.prepareSend(acct.id, { to: RECIPIENT, value: 1n });
  await session.executeSend(prepared);
  assert.equal(session.isFirstSendTo(RECIPIENT), false);
  assert.equal(session.isFirstSendTo('0x2222222222222222222222222222222222222222'), true);
});

// -------------------------------------------------------- chain families

test('chain family: prepare dispatches to the injected engine client with the tag', async () => {
  const seen = [];
  const fakeChainClient = {
    async prepareSend({ from, to, amount, opts }) {
      seen.push({ from, to, amount, opts });
      return { fee: 12n, balance: 100000000n, raw: 'plan' };
    },
    async executeSend() {
      return { hash: 'ABC123TXID' };
    },
    async getTxStatus() {
      return 'success';
    },
    async getBalance() {
      return 100000000n;
    },
    async checkConnection() {
      return true;
    },
  };
  const session = await walletWith(memoryStorage(), fakeRpc(), ['ecdsa', 'xrp'], {
    chainClientFactory: (kind) => {
      assert.equal(kind, 'xrp');
      return fakeChainClient;
    },
  });
  const xrpAcct = byScheme(session, 'xrp');
  session.setNetwork('xrp-testnet');
  const prepared = await session.prepareSend(xrpAcct.id, {
    to: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
    value: 5000000n,
    destinationTag: 20261106,
  });
  assert.equal(prepared.kind, 'chain');
  assert.equal(prepared.symbol, 'XRP');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].opts.destinationTag, 20261106);
  assert.equal(seen[0].amount, 5000000n);
  const { hash } = await session.executeSend(prepared);
  assert.equal(hash, 'ABC123TXID');
  // an ECDSA account may not ride the XRP network
  const ecdsa = byScheme(session, 'ecdsa');
  await assert.rejects(
    () => session.prepareSend(ecdsa.id, { to: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', value: 1n }),
    /cannot send/,
  );
});
