/** Real four-process *local* signature-quorum demonstration, no public network. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';
import { GENESIS_KIND, exportPrivatePem, generateIdentity, hashBlock, signTransaction } from './pq.mjs';
import { requiredValidatorQuorum } from './ledger.mjs';
import { performance } from 'node:perf_hooks';

async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => socket.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function request(port, route, data) {
  const options = data === undefined ? {} : {
    method:'POST', headers: { 'Content-Type':'application/json' }, body:JSON.stringify(data),
  };
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    ...options, signal:AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  if (!response.ok) throw Error(`validator ${port} ${route}: ${JSON.stringify(result)}`);
  return result;
}

async function stopValidator(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Validator failed to close journal after SIGTERM')),5000);
    child.once('exit',()=>{clearTimeout(timer);resolve();});
    child.kill('SIGTERM');
  });
}

const temp = mkdtempSync(join(tmpdir(), 'zeronyth-pq-demo-'));
const children = [];
try {
  const requested = process.argv[2] || '1';
  if (!/^[1-9][0-9]{0,3}$/.test(requested) || Number(requested) > 1536) {
    throw Error('Usage: node network-demo.mjs [transactions-per-block <= 1536] [--blocks 1..8] [--senders 1..64] [--preverify] [--compact] [--parallel-exec] [--direct-peer] [--restart-after-first]');
  }
  const options = process.argv.slice(3);
  let validatorCount=4;
  const validatorsArg=options.indexOf('--validators');
  if(validatorsArg!==-1){
    const value=options[validatorsArg+1];
    // Only the disposable localhost demo is process-bounded. The protocol
    // committee size itself is not fixed to four.
    if(!/^(?:[4-9]|1[0-6])$/.test(value||''))throw Error('--validators must be 4..16 for local process safety');
    validatorCount=Number(value);
    options.splice(validatorsArg,2);
  }
  const quorum=requiredValidatorQuorum(validatorCount);
  let blocks = 1;
  const blocksArg = options.indexOf('--blocks');
  if (blocksArg !== -1) {
    const value = options[blocksArg+1];
    if (!/^[1-8]$/.test(value || '')) throw Error('--blocks must be 1..8');
    blocks = Number(value);
    options.splice(blocksArg, 2);
  }
  let senderCount=1;
  const sendersArg=options.indexOf('--senders');
  if (sendersArg!==-1) {
    const value=options[sendersArg+1];
    if (!/^[1-9][0-9]?$/.test(value||'') || Number(value)>64) throw Error('--senders must be 1..64');
    senderCount=Number(value);
    options.splice(sendersArg,2);
  }
  if (options.some(option => !['--preverify','--compact','--parallel-exec','--direct-peer','--restart-after-first'].includes(option)) ||
      new Set(options).size !== options.length) throw Error('Unexpected or duplicate argument');
  const preverify = options.includes('--preverify');
  const compact = options.includes('--compact');
  const parallelExec=options.includes('--parallel-exec');
  const directPeer=options.includes('--direct-peer');
  if (directPeer && compact) throw Error('--compact applies only to coordinator mode');
  const restartAfterFirst=options.includes('--restart-after-first');
  if (restartAfterFirst && blocks<2) throw Error('--restart-after-first requires --blocks >=2');
  const transactionCount = Number(requested);
  if (blocks * transactionCount > 12_000) {
    throw Error('Maximum 12,000 signed transactions per local multi-block test');
  }
  const validators = Array.from({ length:validatorCount }, () => generateIdentity());
  const senders=Array.from({length:senderCount},()=>generateIdentity());
  const recipients=Array.from({length:senderCount},()=>generateIdentity());
  const genesis = {
    kind: GENESIS_KIND, chainId:'19127',
    validators: validators.map(({ publicKey }) => ({ publicKey })),
    allocations:senders.map(sender=>({address:sender.address,balance:'1000000'})),
  };
  const genesisFile = join(temp, 'genesis.json');
  writeFileSync(genesisFile, JSON.stringify(genesis), { mode:0o600, flag:'wx' });
  const ports = [];
  const keyPaths=[];
  const launch=index=>spawn(process.execPath,[
    new URL('./server.mjs', import.meta.url).pathname,genesisFile,keyPaths[index],String(ports[index]),
  ],{stdio:'ignore',env:{...process.env,ZERONYTH_PQ_PARALLEL_EXEC:parallelExec?'1':'0',
    ...(directPeer ? {ZERONYTH_PQ_LOCAL_PEER_PORTS:ports.join(',')} :
      {ZERONYTH_PQ_LOCAL_PEER_PORTS:undefined})}});
  for (let index=0; index<validators.length; index++) {
    const keyFile = join(temp, `validator-${index}.pem`);
    writeFileSync(keyFile, exportPrivatePem(validators[index].privateKey), { mode:0o600, flag:'wx' });
    const port = await freePort();
    ports.push(port);
    keyPaths.push(keyFile);
  }
  for (let index=0;index<validators.length;index++) children.push(launch(index));
  for (const port of ports) {
    let ready = false;
    for (let retry = 0; retry < 35; retry++) {
      try { await request(port, '/status'); ready = true; break; }
      catch { await pause(100); }
    }
    if (!ready) throw Error(`Validator ${port} failed to start`);
  }

  let signingMs = 0;
  let preverificationMs = 0;
  let proposalMs = 0;
  let stagingMs = 0;
  let votingMs = 0;
  let commitMs = 0;
  let directPeerMs = 0;
  let recoveryMs = 0;
  let lastHash = '';
  const wallStarted = performance.now();
  for (let blockIndex = 0; blockIndex < blocks; blockIndex++) {
    const signingStarted = performance.now();
    const txs = Array.from({ length:transactionCount }, (_,index) => {
      const globalIndex=blockIndex*transactionCount+index;
      const senderIndex=globalIndex%senderCount;
      return signTransaction({
        chainId:'19127', nonce:String(Math.floor(globalIndex/senderCount)),
        to:recipients[senderIndex].address,value:'1',memo:'four-process local test',
      },senders[senderIndex].privateKey);
    });
    signingMs += performance.now()-signingStarted;
    // Mempool admission is included in inclusive TPS, never silently excluded.
    if (preverify) {
    const started = performance.now();
    const results = await Promise.all(ports.map(port => request(port, '/preverify', { transactions:txs })));
    if (!results.every(result => result.verifiedSignatures === transactionCount &&
        result.consensusApproved === false)) throw Error('Mempool verification failed');
    preverificationMs += performance.now() - started;
    }
    // The deterministic proposer rotates by height; no reconfig/view-change.
    const started = performance.now();
    let blockHash;
    if (directPeer) {
      const receipt=await request(ports[blockIndex%validatorCount], '/p2p/round', {transactions:txs});
      if (receipt.height!==String(blockIndex+1) || receipt.verifiedValidators!==validatorCount ||
          receipt.certificateVotes!==quorum || !/^[a-f0-9]{64}$/.test(receipt.headHash)) {
        throw Error('Direct peer consensus certificate/convergence mismatch');
      }
      blockHash=receipt.headHash;
      directPeerMs+=performance.now()-started;
    } else {
    const { block } = await request(ports[blockIndex%validatorCount], '/propose', { transactions:txs });
    const proposedAt = performance.now();
    blockHash = hashBlock(block.header);
    if (compact) {
    // All genesis validators independently inspect the full ML-DSA-signed block
    // ONCE before any later vote or commit can refer to its 32-byte hash.
    const receipts = await Promise.all(ports.map(port => request(port, '/stage', { block })));
    if (!receipts.every(x => x.blockHash === blockHash && x.consensusApproved === false)) {
      throw Error('Staged block verification mismatch');
    }
    }
    const stagedAt = performance.now();
    const voteResponses = await Promise.all(ports.slice(0,quorum).map(port => request(port, '/vote',
      compact ? { blockHash } : { block })));
    const votedAt = performance.now();
    const votes = voteResponses.map(x => x.vote);
    const committed = await Promise.all(ports.map(port => request(port, '/commit',
      compact ? { blockHash, votes } : { block, votes })));
    const committedAt = performance.now();
    if (!committed.every(x => x.headHash === blockHash && x.height === String(blockIndex+1))) {
      throw Error('Local replicas disagree after ML-DSA quorum');
    }
    proposalMs += proposedAt - started;
    stagingMs += stagedAt - proposedAt;
    votingMs += votedAt - stagedAt;
    commitMs += committedAt - votedAt;
    }
    lastHash=blockHash;
    if (restartAfterFirst && blockIndex===0) {
      const recoveryStarted=performance.now();
      await Promise.all(children.map(stopValidator));
      for (let i=0;i<children.length;i++) children[i]=launch(i);
      for (const port of ports) {
        let status=null;
        for (let retry=0;retry<50;retry++) {
          try { status=await request(port,'/status'); break; }
          catch { await pause(100); }
        }
        if (!status || status.height!=='1' || status.headHash!==blockHash) {
          throw Error('Durable validator restart/replay recovery failed');
        }
      }
      recoveryMs += performance.now()-recoveryStarted;
    }
  }
  const fullWallMs = performance.now() - wallStarted;
  const endToEndMs = directPeer ? directPeerMs : proposalMs+stagingMs+votingMs+commitMs;
  const totalTransactions = blocks * transactionCount;
  const statuses = await Promise.all(ports.map(port => request(port, '/status')));
  const balances=await Promise.all(ports.map(async port=>Promise.all(
    recipients.map(({address})=>request(port,`/balance?address=${address}`)))));
  const verifiedBalance=balances[0].reduce((sum,item)=>sum+BigInt(item.balance),0n);
  const consistentBalances=balances.every(perNode=>perNode.every((item,index)=>
    item.balance===String(Math.floor(totalTransactions/senderCount)+
      (index<totalTransactions%senderCount?1:0))));
  if (!statuses.every(x => x.height === String(blocks) && x.headHash === lastHash) ||
      !consistentBalances || verifiedBalance!==BigInt(totalTransactions)) {
    throw Error('Validator committee convergence failed');
  }
  console.log(JSON.stringify({
    status:'VARIABLE GENESIS VALIDATOR COMMITTEE VERIFIED ML-DSA QUORUM',
    chainId:genesis.chainId, validators:statuses.length, mlDsaVotes:quorum, mlDsaVotesPerBlock:quorum,
    transactionCount, transactionsPerBlock:transactionCount, blocks, totalTransactions,
    independentSenderAccounts:senderCount, parallelAccountExecution:parallelExec,
    directValidatorPeerMode:directPeer,
    restartedAllValidatorsAfterFirstBlock:restartAfterFirst,
    durableRecoveryMs:+recoveryMs.toFixed(2),
    clientSigningMs:+signingMs.toFixed(2),
    independentPreverification:preverify,
    compactBlockReferences:compact,
    independentPreverificationMs:+preverificationMs.toFixed(2),
    proposalPhaseMs:directPeer?null:+proposalMs.toFixed(2),
    stagingPhaseMs:directPeer?null:+stagingMs.toFixed(2),
    votingPhaseMs:directPeer?null:+votingMs.toFixed(2),
    commitPhaseMs:directPeer?null:+commitMs.toFixed(2),
    directPeerConsensusMs:directPeer?+directPeerMs.toFixed(2):null,
    localNetworkCommitMs:+endToEndMs.toFixed(2),
    oneBlockLocalTps:blocks === 1 ? +((1000 * transactionCount) / endToEndMs).toFixed(1) : null,
    commitOnlyLocalTps:+((1000 * totalTransactions) / endToEndMs).toFixed(1),
    totalValidationAndCommitMs:+(preverificationMs+endToEndMs).toFixed(2),
    inclusiveLocalTps:+((1000 * totalTransactions) / (preverificationMs+endToEndMs)).toFixed(1),
    includingClientSigningTps:+((1000 * totalTransactions) / fullWallMs).toFixed(1),
    sustained5000TpsVerified:false,
    committedHeight:statuses[0].height, blockHash:statuses[0].headHash,
    recipientBalance:verifiedBalance.toString(),
    warning:directPeer ? 'One-machine loopback direct-validator communication only; no independent operators, public P2P discovery, view-change, public testnet, Besu, EVM, or QBFT. No production TPS claim.' :
      'Multi-block localhost coordinator demonstration on one machine with fsync-backed block journal. No independent operators, P2P, safe view-change, public testnet, Besu, EVM, or QBFT. No production TPS claim.',
  }, null, 2));
} finally {
  await Promise.allSettled(children.map(stopValidator));
  // Deletes only keys created for this one invocation in a mkdtemp-owned directory.
  rmSync(temp, { recursive:true, force:true });
}
