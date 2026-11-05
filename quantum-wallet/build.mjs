// Build the static app into dist/.
//
// Layout: index.html + main.mjs + src/ are copied verbatim; the vendored
// noble tree is copied to dist/vendor/@noble/ and the import map in
// index.html is rewritten from ./node_modules/ to ./vendor/. The PWA
// shell (sw.js, manifest.webmanifest, icons) is copied alongside. The
// result is a fully static directory that can be dropped into the
// dashboard's quantum-wallet/ path (deploy is a later phase — this
// script never touches the VPS).
//
// IMPORTANT (deploy rule, see sw.js): every deployment that changes
// any shipped asset must also bump the SW cache name in sw.js and the
// gateway's index.html?v=N redirect in lockstep.
import { cpSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

cpSync(join(root, 'src'), join(dist, 'src'), { recursive: true });
cpSync(join(root, 'main.mjs'), join(dist, 'main.mjs'));
for (const asset of ['sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']) {
  cpSync(join(root, asset), join(dist, asset));
}
cpSync(join(root, 'node_modules/@noble'), join(dist, 'vendor/@noble'), { recursive: true });

const html = readFileSync(join(root, 'index.html'), 'utf8').replaceAll(
  './node_modules/',
  './vendor/',
);
writeFileSync(join(dist, 'index.html'), html);

console.log(
  'built dist/ (index.html, main.mjs, src/, sw.js, manifest.webmanifest, icons, vendor/@noble/)',
);
