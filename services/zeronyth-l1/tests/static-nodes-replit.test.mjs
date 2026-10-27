import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureStaticPeerFiles } from '../scripts/static-nodes-replit.mjs';

const peers = Array.from({ length: 4 }, (_, index) =>
  `enode://${String(index + 1).repeat(128)}@127.0.0.1:${30303 + index}`);
const expectedFor = (index) => peers.filter((_, peerIndex) => peerIndex !== index);

async function tempRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeronyth-static-peers-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (let index = 1; index <= 4; index++) await mkdir(path.join(root, `node-data/node${index}`), { recursive: true });
  return root;
}

test('existing matching peer files are verified without being rewritten', async (t) => {
  const root = await tempRoot(t);
  const before = [];
  for (let index = 0; index < 4; index++) {
    const file = path.join(root, `node-data/node${index + 1}/static-nodes-replit.json`);
    await writeFile(file, JSON.stringify(expectedFor(index)));
    before.push({ content: await readFile(file, 'utf8'), mtime: (await stat(file)).mtimeMs });
  }
  await ensureStaticPeerFiles(root, peers);
  for (let index = 0; index < 4; index++) {
    const file = path.join(root, `node-data/node${index + 1}/static-nodes-replit.json`);
    assert.equal(await readFile(file, 'utf8'), before[index].content);
    assert.equal((await stat(file)).mtimeMs, before[index].mtime);
  }
});

test('a mismatching existing file fails before any missing peer files are created', async (t) => {
  const root = await tempRoot(t);
  const mismatch = path.join(root, 'node-data/node2/static-nodes-replit.json');
  await writeFile(mismatch, '[]');
  await assert.rejects(ensureStaticPeerFiles(root, peers), /refusing to overwrite node2/);
  for (const index of [1, 3, 4]) {
    assert.equal(
      await stat(path.join(root, `node-data/node${index}/static-nodes-replit.json`)).then(() => true, () => false),
      false,
    );
  }
});

test('missing peer files are created exclusively with the expected local peers', async (t) => {
  const root = await tempRoot(t);
  await ensureStaticPeerFiles(root, peers);
  for (let index = 0; index < 4; index++) {
    const file = path.join(root, `node-data/node${index + 1}/static-nodes-replit.json`);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), expectedFor(index));
  }
});
