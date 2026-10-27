import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VoteJournal } from './journal.mjs';

test('fsync vote journal rejects conflicting vote after simulated process restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeronyth-journal-test-'));
  const file = join(dir, 'validator.votes.jsonl');
  try {
    const first = new VoteJournal(file);
    first.record('1:0', 'a'.repeat(64));
    first.close();
    const restarted = new VoteJournal(file);
    restarted.record('1:0', 'a'.repeat(64));
    assert.throws(() => restarted.record('1:0', 'b'.repeat(64)), /Persistent double-sign/);
    restarted.record('2:0', 'c'.repeat(64));
    restarted.close();
    const later = new VoteJournal(file);
    assert.throws(() => later.record('2:0', 'd'.repeat(64)), /Persistent double-sign/);
    later.close();
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('truncated journal fails closed before validator can start', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeronyth-journal-test-'));
  const file = join(dir, 'validator.votes.jsonl');
  try {
    const first = new VoteJournal(file);
    first.record('1:0', 'e'.repeat(64));
    first.close();
    appendFileSync(file, '{');
    assert.throws(() => new VoteJournal(file), /Truncated vote journal/);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});
