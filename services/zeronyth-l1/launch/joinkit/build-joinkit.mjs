#!/usr/bin/env node
// Builds the Japanese-first participant join kit (double-click START.bat / START.command / start.sh).
//   node build-joinkit.mjs --server https://your-public-url [--out ../../dashboard/downloads]
// Output: <out>/zeronyth-join-kit.zip (+ unpacked folder in ./out/zeronyth-join-kit). No keys are included: each
// participant's keys are generated on their own PC at first start (data/keys.json, 0600) and never leave it.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, copyFileSync, writeFileSync, chmodSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const server = arg('--server');
if (!server || !/^https?:\/\/[^\s"]+$/.test(server)) { console.error('usage: build-joinkit.mjs --server <http(s)://gateway-url> [--out dir]'); process.exit(2); }
const outDir = path.resolve(arg('--out', path.join(here, 'out')));
const kit = path.join(here, 'out', 'zeronyth-join-kit');
const esbuild = [process.env.ESBUILD, '/workspace/zeronyth/node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/bin/esbuild'].filter(Boolean).find(existsSync);
if (!esbuild) { console.error('esbuild not found'); process.exit(1); }
rmSync(kit, { recursive: true, force: true }); mkdirSync(path.join(kit, 'app'), { recursive: true }); mkdirSync(path.join(kit, 'tools'));
const econ = path.resolve(here, '../../economy');
const common = ['--bundle', '--platform=node', '--format=esm', '--target=node20', '--loader:.html=text', '--legal-comments=none', '--log-level=warning',
  "--banner:js=import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"];
execFileSync(esbuild, [path.join(econ, 'participant/app.mjs'), ...common, `--outfile=${path.join(kit, 'app/zeronyth-participant.mjs')}`], { stdio: 'inherit' });
execFileSync(esbuild, [path.join(econ, 'lib/verify-worker.mjs'), ...common, `--outfile=${path.join(kit, 'app/verify-worker.mjs')}`], { stdio: 'inherit' });
const t = (f, to = f, mode) => { copyFileSync(path.join(here, 'templates', f), path.join(kit, to)); if (mode) chmodSync(path.join(kit, to), mode); };
t('START.bat'); t('START.command', 'START.command', 0o755); t('start.sh', 'start.sh', 0o755); t('get-node.ps1', 'tools/get-node.ps1'); t('README.ja.txt', 'はじめにお読みください.txt');
writeFileSync(path.join(kit, 'defaults.json'), JSON.stringify({ server, lang: 'ja', cpuPct: 50, pauseOnBattery: true, pauseOnHeat: true, pauseWhenBusy: true, openBrowser: true }, null, 2) + '\n');
for (const f of ['START.bat', 'tools/get-node.ps1']) { const p = path.join(kit, f); writeFileSync(p, (await import('node:fs')).readFileSync(p, 'utf8').replace(/\r?\n/g, '\r\n')); }
mkdirSync(outDir, { recursive: true });
const zip = path.join(outDir, 'zeronyth-join-kit.zip'); rmSync(zip, { force: true });
execFileSync('python3', ['-c', `import zipfile,os,sys
k=sys.argv[1]; z=zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED)
for r,_,fs in os.walk(k):
  for f in fs:
    p=os.path.join(r,f); a=os.path.join('zeronyth-join-kit',os.path.relpath(p,k)); i=zipfile.ZipInfo.from_file(p,a); i.compress_type=zipfile.ZIP_DEFLATED
    z.writestr(i,open(p,'rb').read())
z.close()`, kit, zip]);
console.log(`join kit: ${zip} (${(statSync(zip).size / 1e6).toFixed(2)} MB), server=${server}`);
