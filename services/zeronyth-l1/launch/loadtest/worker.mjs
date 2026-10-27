// One load-generator process: simulates `clients` visitors/light nodes, each with its own CF-Connecting-IP.
// Open-loop: every client starts one cycle per second (like the real pages' 1 s timers); a cycle still running skips the tick.
import http from 'node:http';
const [base, kind, clients, seconds, ipBase] = [process.argv[2], process.argv[3], Number(process.argv[4]), Number(process.argv[5]), Number(process.argv[6])];
const u = new URL(base); const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });
const lat = []; let ok = 0, err = 0, s429 = 0, s5xx = 0, cycles = 0, skipped = 0, bytes = 0;
function req(method, path, ip, body) {
  return new Promise((resolve) => {
    const t = performance.now();
    const r = http.request({ host: u.hostname, port: u.port, path, method, agent, headers: { 'cf-connecting-ip': ip, 'accept-encoding': 'gzip', ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}) }, timeout: 10000 }, (res) => {
      res.on('data', (c) => { bytes += c.length; }); res.on('end', () => { lat.push(performance.now() - t); if (res.statusCode < 400) ok++; else { err++; if (res.statusCode === 429) s429++; if (res.statusCode >= 500) s5xx++; } resolve(res.statusCode); });
    });
    r.on('error', () => { err++; s5xx++; resolve(0); }); r.on('timeout', () => r.destroy());
    if (body) r.write(body); r.end();
  });
}
const batch = (calls) => JSON.stringify(calls.map(([m, p], id) => ({ jsonrpc: '2.0', id, method: m, params: p || [] })));
let head = 0;
async function cycle(i, ip, tick) {
  cycles++;
  if (kind === 'light' || kind === 'light10') {   // light-node-ui.mjs tick(): head+peers, next header(s), PQ certificate
    await req('POST', '/rpc', ip, batch([['eth_blockNumber'], ['net_peerCount']]));
    await req('POST', '/rpc', ip, batch([['eth_getBlockByNumber', ['latest', false]]]));
    if (kind === 'light' || tick % 10 === 0) await req('GET', '/api/pq/finality/latest', ip);  // light10 = PQ_EVERY 10
  } else {                  // app.js refresh(): 5-call batch each second, PQ summary every 2 s; first tick loads the page
    if (tick === 0) for (const p of ['/', '/assets/app.js', '/assets/styles.css', '/assets/i18n.mjs']) await req('GET', p, ip);
    await req('POST', '/rpc', ip, batch([['eth_chainId'], ['eth_blockNumber'], ['net_peerCount'], ['qbft_getValidatorsByBlockNumber', ['latest']], ['eth_getBlockByNumber', ['latest', false]]]));
    if (tick % 2 === 0) await req('GET', '/api/pq/finality/latest?summary=1', ip);
  }
}
const busy = new Uint8Array(clients); const end = Date.now() + seconds * 1000;
for (let i = 0; i < clients; i++) {
  const ip = `10.${(ipBase + i) >> 16 & 255}.${(ipBase + i) >> 8 & 255}.${(ipBase + i) & 255}`;
  let tick = 0;
  setTimeout(function loop() {
    if (Date.now() >= end) return;
    if (busy[i]) skipped++; else { busy[i] = 1; cycle(i, ip, tick).finally(() => { busy[i] = 0; }); }
    tick++; setTimeout(loop, 1000);
  }, Math.random() * 1000);
}
setTimeout(() => { process.send({ lat, ok, err, s429, s5xx, cycles, skipped, bytes }); setTimeout(() => process.exit(0), 50); }, seconds * 1000 + 2500);
