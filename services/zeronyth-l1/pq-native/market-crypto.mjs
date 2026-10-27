/** Domain-separated ML-DSA-65 authorization for the compute rewards research lab. */
import { createPublicKey, sign, verify } from 'node:crypto';
import { ProtocolError, addressOf, checkShape, publicKeyObject } from './pq.mjs';

export const MARKET_KINDS=Object.freeze({
  REGISTER:'ZERONYTH_COMPUTE_REGISTER_V1',
  CAPACITY:'ZERONYTH_COMPUTE_CAPACITY_V1',
  REQUEST:'ZERONYTH_COMPUTE_REQUEST_V1',
  RESULT:'ZERONYTH_COMPUTE_RESULT_V1',
  DEVICE:'ZERONYTH_DEVICE_PROFILE_V1',
  HEARTBEAT:'ZERONYTH_DEVICE_HEARTBEAT_V1',
  DEVICE_LEAVE:'ZERONYTH_DEVICE_LEAVE_V1',
  RENT_OFFER:'ZERONYTH_RESOURCE_RENT_OFFER_V1',
  RENT_REQUEST:'ZERONYTH_RESOURCE_RENT_REQUEST_V1',
  RENT_METER:'ZERONYTH_RESOURCE_RENT_METER_V1',
  RENT_CANCEL:'ZERONYTH_RESOURCE_RENT_CANCEL_V1',
  VALIDATOR_REWARD:'ZERONYTH_GOV_LAB_VALIDATOR_ROUND_V1',
  CHAIN_SHARE:'ZERONYTH_CHAIN_RESOURCE_SHARE_V1',
  AI_SHARE:'ZERONYTH_AI_GROWTH_RESOURCE_SHARE_V1',
  AI_ACCESS:'ZERONYTH_NODE_PROVIDER_AI_ACCESS_V1',
  GAS_AUTH:'ZERONYTH_GAS_CHARGE_AUTH_V1',
  GAS_METER:'ZERONYTH_GAS_USAGE_ATTEST_V1',
  WORK_PERMIT:'ZERONYTH_LEASE_WORK_PERMIT_V1',
  WORK_ORDER:'ZERONYTH_LEASE_WORK_ORDER_V1',
  WORK_RECEIPT:'ZERONYTH_LEASE_WORK_RECEIPT_V1',
  SERVICE_PERMIT:'ZERONYTH_HOSTED_SERVICE_PERMIT_V1',
  SERVICE_REQUEST:'ZERONYTH_HOSTED_SERVICE_REQUEST_V1',
  SERVICE_RECEIPT:'ZERONYTH_HOSTED_SERVICE_RECEIPT_V1',
  NODE_JOIN:'ZERONYTH_PROVIDER_NODE_JOIN_V1',
  NODE_PULSE:'ZERONYTH_PROVIDER_NODE_PULSE_V1',
});

const COMMON=['kind','chainId'];
const SHAPES=Object.freeze({
  [MARKET_KINDS.REGISTER]:[...COMMON,'nonce','cpuCores','ramMiB','gpuCount','stake','publicKey'],
  [MARKET_KINDS.CAPACITY]:[...COMMON,'provider','registrationId','cpuCores','ramMiB',
    'gpuCount','expiresAtHeight','publicKey'],
  [MARKET_KINDS.REQUEST]:[...COMMON,'nonce','seed','iterations','price',
    'expiresAtHeight','publicKey'],
  [MARKET_KINDS.RESULT]:[...COMMON,'jobId','output','publicKey'],
  [MARKET_KINDS.DEVICE]:[...COMMON,'nonce','deviceClass','platform','runtime','role',
    'maxCpuPct','foregroundOnly','publicKey'],
  [MARKET_KINDS.HEARTBEAT]:[...COMMON,'deviceId','sequence','observedAtHeight',
    'foreground','charging','unmetered','batteryPct','thermal','publicKey'],
  [MARKET_KINDS.DEVICE_LEAVE]:[...COMMON,'deviceId','sequence','publicKey'],
  [MARKET_KINDS.RENT_OFFER]:[...COMMON,'nonce','service','cpuCores','ramMiB',
    'storageGiB','gpuCount','vramMiB','pricePerSlot','maxSlots','expiresAtHeight','publicKey'],
  [MARKET_KINDS.RENT_REQUEST]:[...COMMON,'nonce','offerId','slots','publicKey'],
  [MARKET_KINDS.RENT_METER]:[...COMMON,'rentalId','usedSlots','publicKey'],
  [MARKET_KINDS.RENT_CANCEL]:[...COMMON,'nonce','rentalId','publicKey'],
  [MARKET_KINDS.VALIDATOR_REWARD]:[...COMMON,'height','blockId','publicKey'],
  [MARKET_KINDS.CHAIN_SHARE]:[...COMMON,'nonce','cpuPercent','expiresAtHeight','publicKey'],
  [MARKET_KINDS.AI_SHARE]:[...COMMON,'nonce','aiPercent','expiresAtHeight','publicKey'],
  [MARKET_KINDS.AI_ACCESS]:[...COMMON,'nonce','requestId','publicKey'],
  [MARKET_KINDS.GAS_AUTH]:[...COMMON,'nonce','operationId','gasLimit',
    'maxUnitPrice','expiresAtHeight','publicKey'],
  [MARKET_KINDS.GAS_METER]:[...COMMON,'authorizationId','gasUsed',
    'unitPrice','blockHeight','publicKey'],
  [MARKET_KINDS.WORK_PERMIT]:[...COMMON,'rentalId','customer','provider',
    'maxJobs','maxTotalIterations','expiresAtUnixMs','publicKey'],
  [MARKET_KINDS.WORK_ORDER]:[...COMMON,'rentalId','permitId','nonce',
    'jobId','seed','iterations','publicKey'],
  [MARKET_KINDS.WORK_RECEIPT]:[...COMMON,'rentalId','permitId','orderId',
    'jobId','seed','iterations','output','runTimeMs','publicKey'],
  [MARKET_KINDS.SERVICE_PERMIT]:[...COMMON,'rentalId','customer','provider',
    'service','cpuCores','ramMiB','gpuDeviceId','model',
    'maxRequests','expiresAtUnixMs','publicKey'],
  [MARKET_KINDS.SERVICE_REQUEST]:[...COMMON,'rentalId','permitId','nonce',
    'operation','prompt','maxTokens','publicKey'],
  [MARKET_KINDS.SERVICE_RECEIPT]:[...COMMON,'rentalId','permitId','requestId',
    'service','operation','resourceId','outputHash','publicKey'],
  [MARKET_KINDS.NODE_JOIN]:[...COMMON,'nonce','issuedAtMs','deviceClass',
    'cpuCores','ramMiB','gpuCount','gpuSummary','l1Percent','aiPercent',
    'rentalPercent','termsAccepted','publicKey'],
  [MARKET_KINDS.NODE_PULSE]:[...COMMON,'nonce','issuedAtMs','cpuLoadPct',
    'gpuLoadPct','publicKey'],
});

function canonicalPayload(unsigned) {
  const schema=SHAPES[unsigned?.kind];
  if (!schema) throw new ProtocolError('Unknown market authorization type');
  checkShape(unsigned,schema,'market payload');
  publicKeyObject(unsigned.publicKey); // reject ECDSA before attempting signature
  return Object.fromEntries(schema.map(key=>[key,unsigned[key]]));
}

function signedBytes(unsigned) {
  return Buffer.from(`ZERONYTH_MARKET_AUTH_V1\0${unsigned.kind}\0${JSON.stringify(unsigned)}`,'utf8');
}

export function signMarket(unsignedFields,privateKey) {
  if (privateKey?.asymmetricKeyType!=='ml-dsa-65' || privateKey?.type!=='private') {
    throw new ProtocolError('Compute market requires native ML-DSA-65 signing key');
  }
  const publicKey=createPublicKey(privateKey).export({format:'der',type:'spki'}).toString('base64');
  const canonical=canonicalPayload({...unsignedFields,publicKey});
  return {...canonical,signature:sign(null,signedBytes(canonical),privateKey).toString('base64')};
}

export function verifyMarket(signed,expectedKind,expectedChainId) {
  const fields=SHAPES[expectedKind];
  if (!fields) throw new ProtocolError('Unknown market authorization');
  checkShape(signed,[...fields,'signature'],'signed market authorization');
  const payload=canonicalPayload(Object.fromEntries(fields.map(key=>[key,signed[key]])));
  if (payload.kind!==expectedKind || payload.chainId!==expectedChainId) {
    throw new ProtocolError('Market kind/chain replay rejected');
  }
  if (typeof signed.signature!=='string' ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(signed.signature)) {
    throw new ProtocolError('Invalid market signature encoding');
  }
  const bytes=Buffer.from(signed.signature,'base64');
  if (bytes.length!==3309 || bytes.toString('base64')!==signed.signature ||
      !verify(null,signedBytes(payload),publicKeyObject(payload.publicKey),bytes)) {
    throw new ProtocolError('Invalid market ML-DSA signature');
  }
  return {signer:addressOf(payload.publicKey),payload};
}
