// Standalone reference policy. NOT wired into the live gateway or faucet.
export class AdmissionPolicy {
  constructor({ origin, maxClients = 1000, requestsPerMinute = 30, enableFaucet = false } = {}) {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.username || parsed.password)
      throw Error('HTTPS_ORIGIN_REQUIRED');
    for (const n of [maxClients, requestsPerMinute])
      if (!Number.isSafeInteger(n) || n < 1 || n > 10000) throw Error('INVALID_LIMIT');
    this.origin = origin; this.maxClients = maxClients; this.requestsPerMinute = requestsPerMinute;
    this.enableFaucet = enableFaucet === true; this.clients = new Map();
    this.readMethods = new Set(['eth_chainId','eth_blockNumber','eth_getBalance',
      'eth_getBlockByNumber','eth_getTransactionReceipt','eth_getCode']);
  }
  admit({ path, method, origin, clientId, bytes, rpcMethod, authenticated = false, chainId }, now) {
    if (!Number.isSafeInteger(now) || now < 0) return { allowed: false, status: 400, code: 'BAD_CLOCK' };
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 65536)
      return { allowed: false, status: 413, code: 'BODY_LIMIT' };
    if (origin && origin !== this.origin) return { allowed: false, status: 403, code: 'ORIGIN_DENIED' };
    if (typeof clientId !== 'string' || !/^[a-zA-Z0-9:.-]{1,80}$/.test(clientId))
      return { allowed: false, status: 400, code: 'TRUSTED_CLIENT_ID_REQUIRED' };
    if (method !== 'POST' || !['/rpc','/faucet'].includes(path))
      return { allowed: false, status: 404, code: 'ROUTE_DENIED' };
    if (path === '/rpc' && !this.readMethods.has(rpcMethod))
      return { allowed: false, status: 403, code: 'READ_ONLY_RPC' };
    if (path === '/faucet' && (!this.enableFaucet || authenticated !== true || chainId !== 9127))
      return { allowed: false, status: 403, code: 'FAUCET_DISABLED_OR_UNAUTHORIZED' };
    for (const [key, row] of this.clients)
      if (now - row.lastSeen >= 3600000) this.clients.delete(key);
    let row = this.clients.get(clientId);
    if (!row) {
      if (this.clients.size >= this.maxClients) return { allowed: false, status: 503, code: 'CLIENT_CAPACITY' };
      row = { window: now, count: 0, lastSeen: now, lastClaim: null };
      this.clients.set(clientId, row);
    }
    if (now < row.lastSeen) return { allowed: false, status: 503, code: 'CLOCK_ROLLBACK' };
    row.lastSeen = now;
    if (now - row.window >= 60000) { row.window = now; row.count = 0; }
    if (row.count >= this.requestsPerMinute) return { allowed: false, status: 429, code: 'REQUEST_RATE' };
    row.count++;
    if (path === '/faucet') {
      if (row.lastClaim !== null && now - row.lastClaim < 3600000)
        return { allowed: false, status: 429, code: 'CLAIM_COOLDOWN' };
      row.lastClaim = now;
    }
    return { allowed: true, status: 200, code: 'ADMITTED_NOT_EXECUTED' };
  }
}
