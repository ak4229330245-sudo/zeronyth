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
import { execFileSync } from 'node:child_process';
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

// Bake the build identity into dist/src/build-info.mjs: the version is
// the service-worker generation from sw.js (so Settings always agrees
// with the deployed cache), the commit is the git short hash with a
// trailing "+" when the working tree was dirty at build time.
{
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const gen = sw.match(/const CACHE = 'zeronyth-qwallet-912701v(\d+)'/)?.[1];
  let commit = 'dev';
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    if (dirty) commit += '+';
  } catch {
    /* not a git checkout — keep the placeholder */
  }
  const info = {
    version: gen ? `v${gen}` : 'v?',
    commit,
    builtAt: new Date().toISOString(),
  };
  writeFileSync(
    join(dist, 'src', 'build-info.mjs'),
    `// Baked by build.mjs — do not edit (source placeholder: src/build-info.mjs).\n` +
      `export default Object.freeze(${JSON.stringify(info)});\n`,
  );
  console.log(`build identity: ${info.version} · ${info.commit}`);
}

console.log(
  'built dist/ (index.html, main.mjs, src/, sw.js, manifest.webmanifest, icons, vendor/@noble/)',
);
