// Container "VPS" backend for 10-day VPS plans (box test chain).
//  podman: real containers via ./podman-ns.sh (static rootless podman run inside an unprivileged single-UID user
//          namespace; no sudo, no setuid helpers). Isolation: own PID/mount/IPC/UTS namespaces, --network none,
//          all capabilities dropped, no-new-privileges, read-only image with size-limited tmpfs, rlimits.
//          NOT enforced on this box: cgroup CPU/memory/pids limits (cgroups are not delegated to the box user).
//  mock:   no container; every answer is prefixed "[MOCK]" so it can never be mistaken for a real machine.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND = process.env.ACCESS_VPS_BACKEND || 'podman';
const PODMAN = process.env.ACCESS_PODMAN || '/workspace/podman/podman-in-ns.sh';
const IMAGE = process.env.ACCESS_VPS_IMAGE || 'docker.io/library/alpine:3.20';
export const MAX_VPS = Number(process.env.ACCESS_MAX_VPS || 3);
export const SPEC = { image: IMAGE, network: 'none (isolated, no internet)', home: '/home/renter tmpfs 64 MB', tmp: '/tmp tmpfs 16 MB',
  rlimits: 'data 256 MB, nofile 256, fsize 64 MB, exec 10 s', enforced: 'namespaces + caps dropped + no-new-privileges + rlimits', notEnforced: 'cgroup CPU/memory/pids quotas (not delegated on this box)' };

const run = (args, { timeout = 30_000, max = 65_536 } = {}) => new Promise((resolve) => {
  execFile('nice', ['-n', '15', PODMAN, ...args], { timeout, maxBuffer: max * 4, env: process.env }, (err, stdout, stderr) => {
    resolve({ code: err ? (err.code ?? 1) : 0, out: String(stdout).slice(0, max), err: String(stderr).slice(0, 4096), killed: !!err?.killed });
  });
});
const mock = new Map();
export const nameFor = (address) => `znyt-vps-${address.toLowerCase().slice(2, 14)}`;

export async function list() {
  if (BACKEND === 'mock') return [...mock.values()];
  const r = await run(['ps', '-a', '--filter', 'label=znyt.owner', '--format', 'json']);
  if (r.code) return [];
  try { return JSON.parse(r.out || '[]').map((c) => ({ name: c.Names?.[0], owner: c.Labels?.['znyt.owner'], state: c.State, created: c.Created ?? c.CreatedAt, started: c.StartedAt })); } catch { return []; }
}
export async function start(address, expiry) {
  const name = nameFor(address);
  if (BACKEND === 'mock') { if (!mock.has(name)) mock.set(name, { name, owner: address.toLowerCase(), state: 'running (mock)', started: Math.floor(Date.now() / 1000), mock: true }); return { name, mock: true }; }
  const cur = (await list()).find((c) => c.name === name);
  if (cur?.state === 'running') return { name, existing: true };
  if (cur) await run(['rm', '-f', name]);
  if ((await list()).filter((c) => c.state === 'running').length >= MAX_VPS) throw new Error('all test VPS slots are in use; try later');
  const r = await run(['run', '-d', '--name', name, '--hostname', 'znyt-vps', '--network', 'none', '--read-only', '--init',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--mount', 'type=devpts,destination=/dev/pts,uid=0,gid=0,mode=600',
    '--tmpfs', '/home/renter:rw,size=64m,mode=1777', '--tmpfs', '/tmp:rw,size=16m,mode=1777', '--workdir', '/home/renter',
    '--ulimit', 'data=268435456:268435456', '--ulimit', 'nofile=256:256', '--ulimit', 'fsize=67108864:67108864',
    '--label', `znyt.owner=${address.toLowerCase()}`, '--label', `znyt.expiry=${expiry}`, IMAGE, 'sleep', 'infinity'], { timeout: 120_000 });
  if (r.code) throw new Error('container start failed: ' + (r.err.split('\n').find((l) => /Error/.test(l)) || 'unknown').slice(0, 200));
  return { name, created: true };
}
export async function exec(address, cmd) {
  const name = nameFor(address);
  if (BACKEND === 'mock') return { code: 0, out: `[MOCK] この VPS は模擬です。実行はされていません: ${cmd}\n` };
  const r = await run(['exec', name, 'timeout', '-s', 'KILL', '10', 'sh', '-c', cmd], { timeout: 20_000 });
  return { code: r.code, out: r.out + (r.code && r.err ? `\n${r.err.slice(0, 500)}` : ''), truncated: r.out.length >= 65_536 };
}
export async function stop(address) {
  const name = nameFor(address);
  if (BACKEND === 'mock') return mock.delete(name);
  const r = await run(['rm', '-f', '-t', '2', name]); return r.code === 0;
}
