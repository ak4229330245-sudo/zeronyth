import test from 'node:test';
import assert from 'node:assert/strict';
import {GENESIS_KIND,digest,generateIdentity} from './pq.mjs';
import {MARKET_KINDS,signMarket} from './market-crypto.mjs';
import {GasBurnLab} from './gas-burn-lab.mjs';

function fixture(burnBps='2000'){
  const validators=Array.from({length:4},()=>generateIdentity());
  const payer=generateIdentity(),outsider=generateIdentity(),chainId='19127';
  const genesis={kind:GENESIS_KIND,chainId,
    validators:validators.map(v=>({publicKey:v.publicKey})),
    allocations:[{address:payer.address,balance:'1000'}]};
  const lab=new GasBurnLab(genesis,{balances:[{address:payer.address,balance:'1000'}],burnBps});
  const sign=(kind,fields,key)=>signMarket({kind,chainId,...fields},key.privateKey);
  const authorization=(overrides={})=>sign(MARKET_KINDS.GAS_AUTH,{
    nonce:lab.nextNonce(payer.address),operationId:digest('ZERONYTH_GAS_TEST\0','one'),
    gasLimit:'50',maxUnitPrice:'20',expiresAtHeight:'5',...overrides},payer);
  const meters=(auth,{gasUsed='10',unitPrice='10',height='1'}={})=>{
    const authorizationId=digest('ZERONYTH_GAS_LAB_AUTH_ID_V1\0',JSON.stringify(auth));
    return validators.map(v=>sign(MARKET_KINDS.GAS_METER,{
      authorizationId,gasUsed,unitPrice,blockHeight:height},v));
  };
  return {lab,validators,payer,outsider,chainId,authorization,meters,sign};
}

test('20% of quorum-asserted gas charge is burned and 80% goes to network pool',()=>{
  const x=fixture();x.lab.advanceHeight('1');
  const auth=x.authorization(),reports=x.meters(auth);
  const receipt=x.lab.chargeGas(auth,reports.slice(0,3));
  assert.deepEqual({paid:receipt.paid,burned:receipt.burned,
    networkFeePoolAdded:receipt.networkFeePoolAdded},
    {paid:'100',burned:'20',networkFeePoolAdded:'80'});
  assert.equal(receipt.actualTransactionExecuted,false);
  assert.equal(x.lab.balance(x.payer.address),'900');
  assert.equal(x.lab.nextNonce(x.payer.address),'1');
  assert.deepEqual(x.lab.audit(),{
    unit:'GAS_LAB_SIMULATION_ONLY',height:'1',burnBasisPoints:'2000',
    totalGasUsed:'10',spendable:'900',networkFeePool:'80',cumulativeBurned:'20',
    circulatingSupply:'980',initialSupply:'1000',gasCharges:1,conserved:true,
    realGasMarketActive:false});
  assert.throws(()=>x.lab.chargeGas(auth,reports.slice(0,3)),/nonce\/replay/);
});

test('gas billing rejects forged signatures, duplicate validator, conflicting meter',()=>{
  const x=fixture();x.lab.advanceHeight('1');
  const auth=x.authorization(),r=x.meters(auth);
  assert.throws(()=>x.lab.chargeGas(auth,r.slice(0,2)),/At least 3/);
  assert.throws(()=>x.lab.chargeGas(auth,[r[0],r[0],r[2]]),/duplicate/);
  assert.throws(()=>x.lab.chargeGas(auth,[r[0],r[1],{...r[2],unitPrice:'999'}]),
    /signature/);
  const fake=x.sign(MARKET_KINDS.GAS_METER,{
    authorizationId:r[0].authorizationId,gasUsed:'10',unitPrice:'10',blockHeight:'1'},
  x.outsider);
  assert.throws(()=>x.lab.chargeGas(auth,[r[0],r[1],fake]),/Unknown/);
  assert.throws(()=>x.lab.chargeGas(auth,[r[0],r[1],
    x.meters(auth,{gasUsed:'11'})[2]]),/Conflicting/);
  assert.throws(()=>x.lab.chargeGas({...auth,gasLimit:'100'},r.slice(0,3)),/signature/);
  assert.equal(x.lab.balance(x.payer.address),'1000');
  assert.equal(x.lab.audit().cumulativeBurned,'0');
});

test('metered gas and price cannot exceed payer limits or available credits',()=>{
  const x=fixture();x.lab.advanceHeight('1');
  const auth=x.authorization({gasLimit:'20',maxUnitPrice:'100'});
  assert.throws(()=>x.lab.chargeGas(auth,x.meters(auth,{gasUsed:'21',unitPrice:'10'}).slice(0,3)),
    /authorized gas bounds/);
  assert.throws(()=>x.lab.chargeGas(auth,x.meters(auth,{gasUsed:'20',unitPrice:'101'}).slice(0,3)),
    /authorized gas bounds/);
  assert.throws(()=>x.lab.chargeGas(auth,x.meters(auth,{gasUsed:'20',unitPrice:'100'}).slice(0,3)),
    /Insufficient GAS-LAB/);
  assert.throws(()=>x.lab.chargeGas(auth,x.meters(auth,{height:'2'}).slice(0,3)),
    /not bound/);
  assert.equal(x.lab.audit().conserved,true);
});

test('percentage can be configured safely, and small-unit rounding never burns more than charged',()=>{
  const a=fixture('10000');a.lab.advanceHeight('1');
  const auth=a.authorization();
  a.lab.chargeGas(auth,a.meters(auth,{gasUsed:'3',unitPrice:'1'}).slice(0,3));
  assert.equal(a.lab.audit().cumulativeBurned,'3');
  assert.equal(a.lab.audit().networkFeePool,'0');
  const b=fixture('2000');b.lab.advanceHeight('1');
  const auth2=b.authorization();
  b.lab.chargeGas(auth2,b.meters(auth2,{gasUsed:'3',unitPrice:'1'}).slice(0,3));
  assert.equal(b.lab.audit().cumulativeBurned,'0'); // integer dust is rounded down
  assert.equal(b.lab.audit().networkFeePool,'3');
  assert.equal(b.lab.audit().conserved,true);
  assert.throws(()=>fixture('10001'),/0..10000/);
});

test('expiry, wrong-chain signature and pre-inclusion settlement fail closed',()=>{
  const x=fixture();
  const auth=x.authorization({expiresAtHeight:'1'});
  assert.throws(()=>x.lab.chargeGas(auth,x.meters(auth).slice(0,3)),/bounded gas authorization/);
  x.lab.advanceHeight('2');
  assert.throws(()=>x.lab.chargeGas(auth,x.meters(auth,{height:'2'}).slice(0,3)),
    /bounded gas authorization/);
  const other=x.authorization();
  const wrong=x.sign(MARKET_KINDS.GAS_AUTH,{
    nonce:'0',operationId:other.operationId,gasLimit:'50',
    maxUnitPrice:'20',expiresAtHeight:'5'},x.outsider);
  assert.throws(()=>x.lab.chargeGas({...wrong,chainId:'19128'},x.meters(other).slice(0,3)),
    /replay/);
  assert.equal(x.lab.audit().gasCharges,0);
});
