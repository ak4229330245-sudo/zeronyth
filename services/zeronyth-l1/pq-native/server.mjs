/** Experimental PQ validator API. Optional private-VPN mutual TLS is not production BFT. */
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createPrivateKey } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { ValidatorReplica } from './consensus.mjs';
import { VoteJournal } from './journal.mjs';
import { MAX_BLOCK_BYTES, requiredValidatorQuorum } from './ledger.mjs';
import { SignatureVerificationPool } from './verification-pool.mjs';
import { StagedBlockStore } from './staged-block.mjs';
import { ParallelExecutionPool } from './execution-pool.mjs';
import { addressOf, ProtocolError } from './pq.mjs';
import { openPrivatePeerTransport } from './private-peer-transport.mjs';
import { performance } from 'node:perf_hooks';

const [genesisPath, privateKeyPath, portText] = process.argv.slice(2);
const port = Number(portText);
// Optional direct validator-to-validator laboratory mode. Only genesis-listed,
// explicitly configured peers participate; this is NOT public P2P.
const peerPortsText = process.env.ZERONYTH_PQ_LOCAL_PEER_PORTS;
const remoteConfigPath=process.env.ZERONYTH_PQ_REMOTE_CONFIG_PATH;
if(peerPortsText!==undefined&&remoteConfigPath!==undefined){
  throw Error('Local and authenticated private remote peer modes are mutually exclusive');
}
let peerPorts = null;
if (peerPortsText !== undefined) {
  const parts=peerPortsText.split(',');
  const parsed=parts.map(Number);
  if (parts.length<4 || parts.some(x=>!/^\d{4,5}$/.test(x)) ||
      parsed.some(x=>!Number.isInteger(x)||x<1024||x>65535) ||
      new Set(parsed).size!==parsed.length || !parsed.includes(port)) {
    throw Error('ZERONYTH_PQ_LOCAL_PEER_PORTS needs distinct loopback ports including this node');
  }
  peerPorts=parsed;
}
if (!genesisPath || !privateKeyPath || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw Error('Usage: node server.mjs <genesis.json> <validator-private.pem> <local-port>');
}
const keyFileMode = statSync(privateKeyPath).mode;
if (process.platform !== 'win32' && (keyFileMode & 0o077) !== 0) {
  throw Error('Validator private key must be owner-only (chmod 600)');
}
const genesis = JSON.parse(readFileSync(genesisPath, 'utf8'));
if(peerPorts&&peerPorts.length!==genesis.validators?.length){
  throw Error('Local peer count must match the complete genesis validator committee');
}
const privateKey = createPrivateKey(readFileSync(privateKeyPath, 'utf8'));
const journal = new VoteJournal(`${privateKeyPath}.votes.jsonl`);
let replica;
try {
  replica = new ValidatorReplica(genesis, privateKey, {
    journal, blockStore:`${privateKeyPath}.blocks.jsonl`,
  });
} catch (error) {
  journal.close();
  throw error;
}
const staged = new StagedBlockStore(replica);
const remoteTransport=remoteConfigPath ?
  openPrivatePeerTransport(remoteConfigPath,genesis,replica.publicKey,port) : null;
if (peerPorts && genesis.validators[peerPorts.indexOf(port)]?.publicKey !== replica.publicKey) {
  throw Error('Local peer port ordering must exactly match genesis validator ordering');
}
const MAX_REQUEST_BYTES = MAX_BLOCK_BYTES + 1024 * 1024;
let processingPost = false;
let signaturePool = null;
let executionPool = null;
const parallelExecutionEnabled = process.env.ZERONYTH_PQ_PARALLEL_EXEC === '1';
if (process.env.ZERONYTH_PQ_PARALLEL_EXEC && !['0','1'].includes(process.env.ZERONYTH_PQ_PARALLEL_EXEC)) {
  throw Error('ZERONYTH_PQ_PARALLEL_EXEC must be 0 or 1');
}
function getExecutionPool() {
  if (!executionPool) executionPool = new ParallelExecutionPool({workers:2});
  return executionPool;
}
function getSignaturePool() {
  if (!signaturePool) {
    const requested = process.env.ZERONYTH_PQ_VERIFY_WORKERS || '2';
    if (!/^[1-8]$/.test(requested)) throw Error('ZERONYTH_PQ_VERIFY_WORKERS must be 1..8');
    signaturePool = new SignatureVerificationPool({ workers:Number(requested) });
  }
  return signaturePool;
}

function respond(res, code, value) {
  const encoded = JSON.stringify(value);
  res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  res.end(encoded);
}

async function requestLocalPeer(peerPort, route, value) {
  if (!peerPorts?.includes(peerPort) || peerPort === port) {
    throw new ProtocolError('Peer is not an authorized independent local validator');
  }
  const response = await fetch(`http://127.0.0.1:${peerPort}${route}`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify(value), signal:AbortSignal.timeout(30_000),
  });
  const result=await response.json();
  if (!response.ok) throw new ProtocolError(`Local peer ${peerPort} rejected ${route}: ${result.error}`);
  return result;
}
const peerMode=Boolean(peerPorts||remoteTransport);
const ownIndex=remoteTransport?.ownIndex ?? peerPorts?.indexOf(port);
const allPeerIndices=peerMode ? genesis.validators.map((_,index)=>index) : [];
function requestValidatorPeer(index,route,value){
  if(!peerMode||index===ownIndex||!Number.isInteger(index)||
      index<0||index>=genesis.validators.length){
    throw new ProtocolError('Invalid direct peer index');
  }
  return remoteTransport ? remoteTransport.requestPeer(index,route,value) :
    requestLocalPeer(peerPorts[index],route,value);
}

async function bodyOf(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = remoteTransport ? createHttpsServer(remoteTransport.serverOptions) : createHttpServer();
server.on('request',async (req, res) => {
  try {
    if(remoteTransport&&!remoteTransport.authorize(req.socket)){
      return respond(res,403,{error:'Unrecognized mutual TLS validator identity'});
    }
    const route = new URL(req.url, 'http://127.0.0.1').pathname;
    if (req.method === 'GET' && route === '/status') {
      return respond(res, 200, {
        chainId: genesis.chainId, validator: replica.id,
        height: replica.ledger.height.toString(), headHash: replica.ledger.headHash,
        proposer: replica.ledger.expectedProposer(),
      });
    }
    if (req.method === 'GET' && route === '/balance') {
      const address = new URL(req.url, 'http://127.0.0.1').searchParams.get('address');
      return respond(res, 200, {
        address, balance: replica.ledger.balance(address).toString(),
        nonce: replica.ledger.nonce(address).toString(),
      });
    }
    if (req.method !== 'POST') return respond(res, 404, { error:'Not found' });
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      return respond(res, 415, { error:'Content-Type must be application/json' });
    }
    if (Number(req.headers['content-length'] || 0) > MAX_REQUEST_BYTES) {
      return respond(res, 413, { error:'Request too large' });
    }
    if (processingPost) return respond(res, 429, { error:'Validator busy' });
    processingPost = true;
    try {
    const input = await bodyOf(req);
    if (route === '/p2p/stage-vote' && peerMode) {
      // Every peer re-verifies the *whole* ML-DSA signed block and account
      // state before issuing its own fsync-journalled, anti-equivocation vote.
      const blockHash=parallelExecutionEnabled ?
        await staged.stageParallel(input.block,getExecutionPool()) : staged.stage(input.block);
      return respond(res, 200, { blockHash, vote:staged.vote(blockHash) });
    }
    if (route === '/p2p/round' && peerMode) {
      // Experimental proposer-driven one-round peer protocol. All genesis peers
      // must stage independently before *any* commit; no view-change,
      // partition recovery or production fault-tolerant liveness is asserted.
      const roundStarted=performance.now();
      const block=parallelExecutionEnabled ?
        await replica.proposeParallel(input.transactions,getExecutionPool()) :
        replica.propose(input.transactions);
      const blockHash=staged.stage(block);
      const proposedAt=performance.now();
      const expected=allPeerIndices.filter(index=>index!==ownIndex);
      const remote=await Promise.all(expected.map(index=>
        requestValidatorPeer(index,'/p2p/stage-vote',{block})));
      const votes=[staged.vote(blockHash)];
      for (let i=0;i<remote.length;i++) {
        const result=remote[i];
        const expectedValidator=addressOf(genesis.validators[expected[i]].publicKey);
        if (result.blockHash!==blockHash || result.vote?.validator!==expectedValidator) {
          throw new ProtocolError('Peer vote identity or block hash mismatch');
        }
        votes.push(result.vote);
      }
      replica.ledger.verifyCertificate(block,votes);
      const certifiedAt=performance.now();
      const certificate=votes.slice(0,requiredValidatorQuorum(genesis.validators.length));
      const receipts=await Promise.all(allPeerIndices.map(index=>index===ownIndex ?
        Promise.resolve({headHash:staged.commit(blockHash,certificate),
          height:replica.ledger.height.toString()}) :
        requestValidatorPeer(index,'/commit',{blockHash,votes:certificate})));
      if (!receipts.every(item=>item.headHash===blockHash &&
          item.height===block.header.height)) {
        throw new ProtocolError('Peers did not converge after certified commit');
      }
      const committedAt=performance.now();
      return respond(res,200,{headHash:blockHash,height:block.header.height,
        verifiedValidators:receipts.length,certificateVotes:certificate.length,
        phaseMs:{proposer:+(proposedAt-roundStarted).toFixed(2),
          peerVerificationAndVotes:+(certifiedAt-proposedAt).toFixed(2),
          durableCommitteeCommit:+(committedAt-certifiedAt).toFixed(2),
          durableFourNodeCommit:genesis.validators.length===4 ?
            +(committedAt-certifiedAt).toFixed(2) : null}});
    }
    if (route === '/preverify') {
      return respond(res, 200, {
        verifiedSignatures: await replica.ledger.preverifyTransactionsAsync(
          input.transactions, getSignaturePool()),
        // Only an independently verified local mempool receipt, NEVER a quorum vote.
        consensusApproved: false,
      });
    }
    if (route === '/propose') {
      const block = parallelExecutionEnabled ?
        await replica.proposeParallel(input.transactions,getExecutionPool()) :
        replica.propose(input.transactions);
      staged.stage(block);
      return respond(res, 200, { block });
    }
    if (route === '/stage') {
      return respond(res, 200, {
        blockHash:parallelExecutionEnabled ?
          await staged.stageParallel(input.block,getExecutionPool()) : staged.stage(input.block),
        consensusApproved:false,
      });
    }
    if (route === '/vote') {
      return respond(res, 200, {
        vote:input.blockHash === undefined ? replica.vote(input.block) : staged.vote(input.blockHash),
      });
    }
    if (route === '/commit') {
      const headHash = input.blockHash === undefined ?
        replica.commit(input.block, input.votes) : staged.commit(input.blockHash, input.votes);
      staged.clear();
      return respond(res, 200, { headHash, height:replica.ledger.height.toString() });
    }
    return respond(res, 404, { error:'Not found' });
    } finally { processingPost = false; }
  } catch (error) {
    return respond(res, 400, { error: error instanceof Error ? error.message : 'Invalid request' });
  }
});

server.requestTimeout = 40_000;
server.headersTimeout = 10_000;
server.maxRequestsPerSocket = 200;

server.listen(port, remoteTransport?.bindAddress ?? '127.0.0.1', () => {
  console.log(`PQ validator ${replica.id.slice(0,18)} listening at ${remoteTransport?.bindAddress ?? '127.0.0.1'}:${port}`);
});
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(async () => {
  if (signaturePool) await signaturePool.close();
  if (executionPool) await executionPool.close();
  remoteTransport?.close();
  replica.ledger.close?.();
  journal.close();
  process.exit(0);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
