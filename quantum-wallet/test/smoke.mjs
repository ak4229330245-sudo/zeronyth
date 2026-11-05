// HTTP smoke test for the built app: run the build, serve dist/ over a
// local HTTP server, and assert every asset the app needs returns 200
// (plus the import map really points at ./vendor/). This is the headless
// stand-in for "the page loads" — DOM-level interaction is covered by
// the session-controller unit tests in test/ui.test.mjs.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');

execFileSync('node', ['build.mjs'], { cwd: root, stdio: 'inherit' });

const MIME = {
  '.html': 'text/html',
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.css': 'text/css',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
    if (path === '' || path === '.') path = 'index.html';
    const file = join(dist, path);
    if (!file.startsWith(dist)) throw Error('traversal');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const ASSETS = [
  '/',
  '/index.html',
  '/main.mjs',
  '/src/ui/app.mjs',
  '/src/app/session.mjs',
  '/src/i18n.mjs',
  '/src/core/vault.mjs',
  '/src/core/crypto.mjs',
  '/src/core/tx.mjs',
  '/src/core/bip39.mjs',
  '/src/core/bip39-wordlist.mjs',
  '/src/core/hd.mjs',
  '/src/build-info.mjs',
  '/src/app/idle.mjs',
  '/src/app/clipboard.mjs',
  '/src/core/networks.mjs',
  '/src/core/swap.mjs',
  '/src/core/enc.mjs',
  '/src/core/chains/solana.mjs',
  '/src/core/chains/bitcoin.mjs',
  '/src/core/chains/xrp.mjs',
  '/src/core/chains/sui.mjs',
  '/src/core/chains/aptos.mjs',
  '/sw.js',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/vendor/@noble/post-quantum/falcon.js',
  '/vendor/@noble/post-quantum/ml-dsa.js',
  '/vendor/@noble/curves/secp256k1.js',
  '/vendor/@noble/hashes/sha3.js',
  '/vendor/@noble/hashes/sha2.js',
];

let failed = 0;
for (const path of ASSETS) {
  const res = await fetch(base + path);
  const ok = res.status === 200;
  if (!ok) failed++;
  console.log(`${ok ? '200' : res.status} ${path}`);
  await res.arrayBuffer(); // drain
}

const html = await (await fetch(base + '/index.html')).text();
if (!html.includes('./vendor/')) {
  failed++;
  console.log('FAIL index.html import map does not point at ./vendor/');
}
const sw = await (await fetch(base + '/sw.js')).text();
if (!sw.includes("const CACHE = 'zeronyth-qwallet-912701v12'")) {
  failed++;
  console.log('FAIL sw.js cache name is not zeronyth-qwallet-912701v12');
}

server.close();
if (failed) {
  console.error(`smoke: ${failed} failure(s)`);
  process.exit(1);
}
console.log(`smoke: all ${ASSETS.length} assets serve 200 from dist/`);
