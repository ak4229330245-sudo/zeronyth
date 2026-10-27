/** Signed metered-gas 20% burn prototype; no real gas transaction is executed. */
import {GasBurnLab} from './gas-burn-lab.mjs';
import {GENESIS_KIND,digest,generateIdentity} from './pq.mjs';
import {MARKET_KINDS,signMarket} from './market-crypto.mjs';

const chainId='19127';
const validators=Array.from({length:4},()=>generateIdentity());
const payer=generateIdentity();
const genesis={kind:GENESIS_KIND,chainId,
  validators:validators.map(v=>({publicKey:v.publicKey})),
  allocations:[{address:payer.address,balance:'1000'}]};
const lab=new GasBurnLab(genesis,{balances:[{address:payer.address,balance:'1000'}],
  burnBps:'2000'});
lab.advanceHeight('1');
const auth=signMarket({kind:MARKET_KINDS.GAS_AUTH,chainId,
  nonce:lab.nextNonce(payer.address),
  operationId:digest('ZERONYTH_MOCK_GAS_OP\0','one-transfer'),
  gasLimit:'50',maxUnitPrice:'20',expiresAtHeight:'5'},payer.privateKey);
const authorizationId=digest('ZERONYTH_GAS_LAB_AUTH_ID_V1\0',JSON.stringify(auth));
const meters=validators.slice(0,3).map(v=>signMarket({
  kind:MARKET_KINDS.GAS_METER,chainId,authorizationId,
  gasUsed:'10',unitPrice:'10',blockHeight:'1'},v.privateKey));
const receipt=lab.chargeGas(auth,meters);
console.log(JSON.stringify({researchOnly:true,baseNetworkZeroGasUnchanged:true,
  actualGasExecution:false,gasFeeDistribution:receipt,
  supplyAudit:lab.audit()},null,2));
