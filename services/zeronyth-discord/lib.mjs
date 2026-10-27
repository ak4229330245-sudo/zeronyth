// ZERONYTH Discord bot: data sources (no secrets here).
export const RPC_URL = process.env.ZERONYTH_RPC_URL || 'http://127.0.0.1:8545';
export const GATEWAY = process.env.ZERONYTH_GATEWAY || 'http://127.0.0.1:22673';
export const FAUCET_URL = process.env.ZERONYTH_FAUCET_URL || 'http://127.0.0.1:8797';
export const EXPLORER = process.env.ZERONYTH_EXPLORER || 'https://scan.zeronyth.dpdns.org';
export const SITE = process.env.ZERONYTH_SITE || 'https://zeronyth.dpdns.org';
const TIMEOUT_MS = 5000;

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

let rpcId = 1;
async function rpc(method, params = []) {
  const { status, body } = await fetchJson(RPC_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
  });
  if (status !== 200 || !body || body.error) throw new Error(body?.error?.message || `HTTP ${status}`);
  return body.result;
}

const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e: String(e?.message || e) }));

export async function fetchStatus() {
  const [chainId, block, peers, gasPrice, syncing, validators, latestBlock, pq, faucet, p2p] = await Promise.all([
    settle(rpc('eth_chainId').then((x) => Number(BigInt(x)))),
    settle(rpc('eth_blockNumber').then((x) => Number(BigInt(x)))),
    settle(rpc('net_peerCount').then((x) => Number(BigInt(x)))),
    settle(rpc('eth_gasPrice').then((x) => BigInt(x))),
    settle(rpc('eth_syncing')),
    settle(rpc('qbft_getValidatorsByBlockNumber', ['latest']).then((v) => v.length)),
    settle(rpc('eth_getBlockByNumber', ['latest', false]).then((b) => ({ timestamp: Number(BigInt(b.timestamp)), txs: b.transactions.length }))),
    settle(fetchJson(`${GATEWAY}/api/pq/finality/latest?summary=1`).then(({ status, body }) => { if (status !== 200 || !body) throw new Error(`HTTP ${status}`); return body; })),
    settle(fetchJson(`${FAUCET_URL}/health`).then(({ status, body }) => { if (status !== 200 || !body?.ok) throw new Error(body?.error || `HTTP ${status}`); return body; })),
    settle(fetchJson(`${GATEWAY}/api/p2p/health`).then(({ status, body }) => { if (status !== 200 || !body) throw new Error(`HTTP ${status}`); return body; })),
  ]);
  return { chainId, block, peers, gasPrice, syncing, validators, latestBlock, pq, faucet, p2p, at: Date.now() };
}

const NA = '取得できません';
const jstFmt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
export const jst = (ms) => `${jstFmt.format(new Date(ms))} JST`;
const num = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
function gwei(wei) { const g = Number(wei) / 1e9; return wei === 0n ? '0 (無料)' : `${g.toLocaleString('en-US', { maximumFractionDigits: 4 })} gwei`; }

// Plain field list (used for the embed and for local tests).
export function statusFields(s) {
  const f = [];
  const add = (name, r, fmt) => f.push({ name, value: r.ok ? fmt(r.v) : NA, inline: true });
  add('⛓️ チェーンID', s.chainId, (v) => `${v}`);
  add('📦 ブロック高', s.block, (v) => `#${num(v)}`);
  add('🕒 最新ブロック', s.latestBlock, (v) => `${Math.max(0, Math.round(s.at / 1000 - v.timestamp))} 秒前 (${v.txs} tx)`);
  add('🤝 ピア数', s.peers, (v) => `${v}`);
  add('🛡️ バリデータ', s.validators, (v) => `${v} 台 (QBFT)`);
  add('⛽ ガス価格', s.gasPrice, gwei);
  add('🔄 同期', s.syncing, (v) => (v === false ? '同期済み' : '同期中'));
  add('🔐 PQファイナリティ', s.pq, (v) => `#${num(v.height)} ・ 署名 ${v.signers}（必要 ${v.quorum}） (${v.scheme})`);
  add('📡 P2Pシグナリング', s.p2p, (v) => `${v.status} (ルーム ${v.rooms ?? 0})`);
  f.push({ name: '🚰 Faucet', inline: false, value: s.faucet.ok
    ? `残高 ${num(s.faucet.v.balanceZNYT)} ZNYT ・ 1回 ${s.faucet.v.dripZNYT} ZNYT ・ 本日 ${s.faucet.v.claimsToday ?? '?'}/${s.faucet.v.dailyCap ?? '∞'} 回`
    : `${NA}（faucetが一時停止中の可能性）` });
  return f;
}

export function overallOk(s) { return s.block.ok && s.latestBlock.ok && (s.at / 1000 - s.latestBlock.v.timestamp) < 60; }

export const isAddress = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);

// Faucet claim. Returns { kind, ... } for the bot to render; never throws.
export async function claimFaucet(address, userId) {
  let r;
  try {
    r = await fetchJson(`${FAUCET_URL}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zeronyth-client-ip': `discord-${userId}`.slice(0, 45) },
      body: JSON.stringify({ address }),
    });
  } catch (e) {
    return { kind: 'down' };
  }
  const b = r.body || {};
  if (r.status === 200 && b.ok) return { kind: 'ok', txHash: b.txHash, amount: b.amountZNYT, address: b.address, nextClaimAt: b.nextClaimAt, nextClaimAtJst: b.nextClaimAtJst };
  if (r.status === 400) return { kind: 'bad_address' };
  if (r.status === 409) return { kind: 'busy_or_funded', msg: b.message || b.error };
  if (r.status === 429) return { kind: 'cooldown', code: b.code, nextClaimAtJst: b.nextClaimAtJst, msg: b.messageJa || b.error };
  if (r.status === 503) return { kind: 'unavailable', msg: b.error };
  if (r.status >= 502) return { kind: 'down' };
  return { kind: 'error', status: r.status, msg: b.error };
}

// Local test: `node lib.mjs` prints the /status data (no secrets involved).
if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await fetchStatus();
  console.log(JSON.stringify(statusFields(s), null, 1));
  console.log('overallOk:', overallOk(s));
}
