// Minimal JSON-RPC client for a Besu node (chain 912701 / test chains).
//
// fetch-based (browser + Node >= 20), no dependencies. Quantities are
// returned as BigInt (balances, gas price, estimates) or Number (counts,
// block numbers); hashes, receipts and eth_call results pass through as
// the node returns them. JSON-RPC errors throw RpcError carrying the
// node's code and message verbatim — several flows (and tests) depend on
// node messages such as "Nonce too low" or the -32000 PQ gate error.

export class RpcError extends Error {
  constructor(message, code, data) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }
}

/** BigInt / number -> JSON-RPC quantity hex ("0x0" for zero). */
export function quantityHex(v) {
  const b = typeof v === 'bigint' ? v : BigInt(v);
  if (b < 0n) throw Error('quantity cannot be negative');
  return '0x' + b.toString(16);
}

function toBigInt(hex) {
  if (typeof hex !== 'string') throw Error(`expected hex quantity, got ${typeof hex}`);
  return BigInt(hex);
}

export function createRpcClient(url, { fetchImpl, timeoutMs = 30000 } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw Error('no fetch implementation available');
  let nextId = 1;

  async function call(method, params = []) {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new RpcError(`HTTP ${res.status} from ${url}`, -32000);
    const j = await res.json();
    if (j.error) throw new RpcError(j.error.message || 'JSON-RPC error', j.error.code, j.error.data);
    return j.result;
  }

  return {
    url,
    call,

    /** Transaction count (nonce) for an address; Number. */
    async getTransactionCount(address, blockTag = 'latest') {
      return Number(toBigInt(await call('eth_getTransactionCount', [address, blockTag])));
    },

    /** Balance in wei; BigInt. */
    async getBalance(address, blockTag = 'latest') {
      return toBigInt(await call('eth_getBalance', [address, blockTag]));
    },

    /** Current gas price in wei; BigInt. */
    async gasPrice() {
      return toBigInt(await call('eth_gasPrice', []));
    },

    /** Current block number; Number. */
    async blockNumber() {
      return Number(toBigInt(await call('eth_blockNumber', [])));
    },

    /**
     * Gas estimate for a call object { from, to, value, data, gasPrice }
     * (values passed through verbatim — use quantityHex for bigints).
     * Returns BigInt.
     */
    async estimateGas(tx, blockTag = 'latest') {
      return toBigInt(await call('eth_estimateGas', [tx, blockTag]));
    },

    /** Submit a signed raw transaction; returns the transaction hash. */
    async sendRawTransaction(rawTx) {
      return call('eth_sendRawTransaction', [rawTx]);
    },

    /** Receipt object, or null while the tx is not yet mined. */
    async getTransactionReceipt(hash) {
      return call('eth_getTransactionReceipt', [hash]);
    },

    /** eth_call; returns the raw return-data hex string. */
    async ethCall(tx, blockTag = 'latest') {
      return call('eth_call', [tx, blockTag]);
    },

    /** Code at an address ("0x" when empty). */
    async getCode(address, blockTag = 'latest') {
      return call('eth_getCode', [address, blockTag]);
    },
  };
}
