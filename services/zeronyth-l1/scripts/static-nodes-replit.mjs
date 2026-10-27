import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function ensureStaticPeerFiles(root, peers) {
  if (!Array.isArray(peers) || peers.length !== 4 ||
      peers.some((peer) => typeof peer !== 'string' || !/^enode:\/\/[a-fA-F0-9]{128}@127\.0\.0\.1:\d{5}$/.test(peer)) ||
      new Set(peers).size !== peers.length) {
    throw new Error('Expected four unique local validator peers');
  }

  const pendingWrites = [];
  for (let index = 0; index < 4; index++) {
    const file = path.join(root, `node-data/node${index + 1}/static-nodes-replit.json`);
    const expected = peers.filter((_, peerIndex) => peerIndex !== index);
    if (existsSync(file)) {
      let existing;
      try {
        existing = JSON.parse(await readFile(file, 'utf8'));
      } catch {
        throw new Error(`Existing static peer file is invalid; refusing to overwrite node${index + 1}`);
      }
      if (!Array.isArray(existing) || JSON.stringify(existing) !== JSON.stringify(expected)) {
        throw new Error(`Existing static peer file differs; refusing to overwrite node${index + 1}`);
      }
    } else {
      pendingWrites.push({ file, expected, node: index + 1 });
    }
  }

  for (const { file, expected, node } of pendingWrites) {
    try {
      await writeFile(file, JSON.stringify(expected), { flag: 'wx', mode: 0o644 });
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new Error(`Static peer file appeared during startup; refusing to overwrite node${node}`);
      }
      throw error;
    }
  }
}
