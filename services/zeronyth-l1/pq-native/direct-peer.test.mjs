import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec=promisify(execFile);
const demo=fileURLToPath(new URL('./network-demo.mjs',import.meta.url));
const server=fileURLToPath(new URL('./server.mjs',import.meta.url));

test('four local validator peers independently stage, vote, fsync, replay and converge',
  {timeout:40_000},async()=>{
    const {stdout}=await exec(process.execPath,[demo,'4','--blocks','2',
      '--senders','4','--direct-peer','--preverify','--restart-after-first'],
    {timeout:35_000,maxBuffer:1024*1024});
    const result=JSON.parse(stdout);
    assert.equal(result.directValidatorPeerMode,true);
    assert.equal(result.validators,4);
    assert.equal(result.mlDsaVotes,3);
    assert.equal(result.committedHeight,'2');
    assert.equal(result.recipientBalance,'8');
    assert.equal(result.restartedAllValidatorsAfterFirstBlock,true);
    assert.equal(result.sustained5000TpsVerified,false);
  });

test('direct peer configuration rejects duplicate local ports before node startup',
  {timeout:10_000},async()=>{
    await assert.rejects(exec(process.execPath,[server,'missing-genesis','missing-key','12345'],{
      env:{...process.env,ZERONYTH_PQ_LOCAL_PEER_PORTS:'12345,12345,12346,12347'},
      timeout:5_000,
    }),/distinct loopback ports/);
  });
