import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { privateIp, validatePrivatePeerConfig } from './private-peer-transport.mjs';

const exec=promisify(execFile);
const demo=fileURLToPath(new URL('./private-peer-demo.mjs',import.meta.url));
const hasOpenSsl=spawnSync('openssl',['version'],{encoding:'utf8'}).status===0;
const fingerprint=n=>Array(32).fill(n.toString(16).padStart(2,'0').toUpperCase()).join(':');
const genesis={validators:Array.from({length:4},(_,i)=>({publicKey:`validator-public-${i}`}))};
function good(){
  return {kind:'ZERONYTH_PQ_PRIVATE_VALIDATORS_V1',validatorIndex:0,
    listenAddress:'10.17.0.1',port:13001,tls:{},
    peers:Array.from({length:4},(_,i)=>({validatorIndex:i,
      host:`10.17.0.${i+1}`,port:13001+i,
      serverName:`validator-${i}.zeronyth.internal`,certSha256:fingerprint(i+1)}))};
}

test('private VPN peers require unique addresses, pins, fixed identity and private IP',()=>{
  assert.equal(privateIp('10.12.5.7'),true);
  assert.equal(privateIp('100.64.0.4'),true);
  assert.equal(privateIp('192.168.1.9'),true);
  assert.equal(privateIp('8.8.8.8'),false);
  assert.equal(privateIp('example.com'),false);
  assert.equal(validatePrivatePeerConfig(good(),genesis,'validator-public-0',13001),true);
  const publicPeer=good();publicPeer.peers[2].host='1.1.1.1';
  assert.throws(()=>validatePrivatePeerConfig(publicPeer,genesis,'validator-public-0',13001),
    /Invalid genesis-ordered private peer/);
  const duplicate=good();duplicate.peers[3].certSha256=duplicate.peers[1].certSha256;
  assert.throws(()=>validatePrivatePeerConfig(duplicate,genesis,'validator-public-0',13001),
    /Duplicate private peer/);
  assert.throws(()=>validatePrivatePeerConfig(good(),genesis,'validator-public-1',13001),
    /genesis identity/);
});

test('four separate validators converge through mutual TLS and ML-DSA quorum',
  {skip:!hasOpenSsl,timeout:40_000},async()=>{
    const {stdout}=await exec(process.execPath,[demo,'4','2'],{
      timeout:35_000,maxBuffer:1024*1024});
    const result=JSON.parse(stdout);
    assert.equal(result.allBalancesAgree,true);
    assert.equal(result.committedHeight,'2');
    assert.equal(result.mlDsaValidatorQuorum,'3 of 4');
    assert.equal(result.sustained5000TpsVerified,false);
  });

test('mutual TLS refuses swapped but CA-signed certificate pins',
  {skip:!hasOpenSsl,timeout:40_000},async()=>{
    await assert.rejects(exec(process.execPath,[demo,'4','2','--bad-peer-pin'],{
      timeout:35_000,maxBuffer:1024*1024}),/Private peer TLS certificate pin mismatch/);
  });

test('single-pass consensus still rejects forged ML-DSA transactions before voting',
  {skip:!hasOpenSsl,timeout:40_000},async()=>{
    await assert.rejects(exec(process.execPath,
      [demo,'4','2','--single-pass','--bad-transaction'],{
        timeout:35_000,maxBuffer:1024*1024}),/Invalid ML-DSA transaction signature/);
  });
