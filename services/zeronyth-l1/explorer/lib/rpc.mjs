// Loopback JSON-RPC client (read-only methods only; the explorer never forwards client RPC).
const ALLOWED = new Set(['eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getBlockReceipts', 'eth_getTransactionByHash',
  'eth_getTransactionReceipt', 'eth_getBalance', 'eth_getTransactionCount', 'eth_getCode', 'eth_call', 'eth_gasPrice', 'eth_chainId',
  'qbft_getValidatorsByBlockNumber', 'net_peerCount']);
export function makeRpc(url) {
  const h = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(h)) throw new Error('explorer RPC must be loopback');
  let id = 0;
  async function post(body, timeout = 15000) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    if (!r.ok) throw new Error(`rpc http ${r.status}`);
    return r.json();
  }
  const rpc = async (method, params = []) => {
    if (!ALLOWED.has(method)) throw new Error('method not allowed');
    const j = await post({ jsonrpc: '2.0', id: ++id, method, params });
    if (j.error) throw Object.assign(new Error(j.error.message || 'rpc error'), { rpc: j.error });
    return j.result;
  };
  rpc.batch = async (calls) => {
    if (!calls.length) return [];
    for (const [m] of calls) if (!ALLOWED.has(m)) throw new Error('method not allowed');
    const base = id; id += calls.length;
    const res = await post(calls.map(([method, params], i) => ({ jsonrpc: '2.0', id: base + i + 1, method, params })), 60000);
    const byId = new Map((Array.isArray(res) ? res : [res]).map((r) => [r.id, r]));
    return calls.map((_, i) => { const r = byId.get(base + i + 1); if (!r || r.error) throw new Error(r?.error?.message || 'rpc batch error'); return r.result; });
  };
  return rpc;
}
