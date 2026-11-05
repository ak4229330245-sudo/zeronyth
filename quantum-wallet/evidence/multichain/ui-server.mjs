// Local E2E static server for the wallet dist/.
// - Serves dist/ on PORT (default 18080).
// - Answers GET /api/points/rules with { amm: <manifest> } read fresh
//   from $AMM_MANIFEST (written by the AMM deploy step).
// - With QW_CSP=1, adds the production wallet-branch CSP (v12 extended
//   connect-src) to every response — for the CSP boot test on PORT 18081.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../dist/', import.meta.url));
const PORT = Number(process.env.PORT || 18080);
const MANIFEST_FILE = process.env.AMM_MANIFEST || fileURLToPath(new URL('./amm-manifest.json', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.css': 'text/css',
};

// The production wallet-branch policy with the step-9 extended
// connect-src (identical to what ships on the VPS gateway + edge).
const CSP = [
  "default-src 'self'",
  "connect-src 'self' https://sepolia.base.org https://ethereum-sepolia-rpc.publicnode.com https://sepolia-rollup.arbitrum.io https://rpc.testnet.chain.robinhood.com https://rpc.testnet.arc.network https://api.mainnet-beta.solana.com https://api.devnet.solana.com https://blockstream.info https://s1.ripple.com:51234 https://s.altnet.rippletest.net:51234 https://graphql.mainnet.sui.io https://graphql.testnet.sui.io https://fullnode.mainnet.aptoslabs.com https://fullnode.testnet.aptoslabs.com",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

createServer(async (req, res) => {
  try {
    if (process.env.QW_CSP === '1') res.setHeader('Content-Security-Policy', CSP);
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/points/rules') {
      const manifest = JSON.parse(await readFile(MANIFEST_FILE, 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ amm: manifest }));
      return;
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path === '/' || path === '\\') path = '/index.html';
    const file = join(root, path);
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`ui-server on ${PORT} csp=${process.env.QW_CSP ?? '0'}`));
