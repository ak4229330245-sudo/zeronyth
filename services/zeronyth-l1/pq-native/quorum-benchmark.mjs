/** Repeated four-validator mutually-authenticated TLS throughput comparison. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec=promisify(execFile);
const demo=fileURLToPath(new URL('./private-peer-demo.mjs',import.meta.url));
const transactions=Number(process.argv[2]||'512');
const blocks=Number(process.argv[3]||'3');
const repeats=Number(process.argv[4]||'3');
if(!Number.isInteger(transactions)||transactions<1||transactions>1536||
   !Number.isInteger(blocks)||blocks<1||blocks>8||
   transactions*blocks>12000||!Number.isInteger(repeats)||repeats<1||repeats>5){
  throw Error('Usage: node pq-native/quorum-benchmark.mjs [1..1536 tx/block] [1..8 blocks] [1..5 repetitions]');
}
const series={preverifiedBeforeConsensus:[],singlePassFullyVerifiedConsensus:[]};
const median=items=>[...items].sort((a,b)=>a-b)[Math.floor(items.length/2)];
for(let run=0;run<repeats;run++){
  // Alternate order across repetitions to expose transient CPU throttling.
  const modes=run%2===0 ? [false,true]:[true,false];
  for(const singlePass of modes){
    const args=[demo,String(transactions),String(blocks),
      ...(singlePass?['--single-pass']:[])];
    const {stdout}=await exec(process.execPath,args,{timeout:120_000,
      maxBuffer:1024*1024});
    const sample=JSON.parse(stdout);
    if(sample.allBalancesAgree!==true||sample.committedHeight!==String(blocks)||
        sample.mlDsaValidatorQuorum!=='3 of 4'||
        sample.independentlyVerifiedAtEveryValidator!==true||
        sample.sustained5000TpsVerified!==false){
      throw Error('Benchmark refused unverified/inconsistent validator result');
    }
    const name=singlePass?'singlePassFullyVerifiedConsensus':'preverifiedBeforeConsensus';
    series[name].push(sample.admissionConsensusFsyncTps);
  }
}
const first=median(series.preverifiedBeforeConsensus);
const second=median(series.singlePassFullyVerifiedConsensus);
console.log(JSON.stringify({
  status:'INDEPENDENTLY VERIFIED FOUR-VALIDATOR MUTUAL TLS SHORT-RUN BENCHMARK',
  transactionsPerBlock:transactions,blocks,repeatCount:repeats,
  preverifiedAdmissionTps:series.preverifiedBeforeConsensus,
  singlePassVerifiedConsensusTps:series.singlePassFullyVerifiedConsensus,
  medians:{preverifiedAdmissionTps:first,singlePassVerifiedConsensusTps:second},
  medianRatio:+(second/first).toFixed(2),
  sustained5000TpsVerified:false,
  warning:'Short separate experiments on ONE computer with loopback mTLS; no remote-host, sustained load, WAN, fault injection or public/production BFT TPS claim.',
},null,2));
