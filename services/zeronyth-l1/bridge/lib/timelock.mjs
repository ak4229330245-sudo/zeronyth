// 24h TimelockController (OpenZeppelin, src/BridgeTimelock.sol) that owns the vault and every BridgeMinter.
// Same CREATE2 init code on every chain => the same timelock address everywhere.
// Deployed with minDelay 0, then ONE self-executing batch: grant CANCELLER to the guardian, accept ownership of the
// bridge contract (Ownable2Step), and raise the delay to 24h. After that block every owner action needs schedule + 24h.
import { NonceManager, ContractFactory, ZeroAddress, keccak256, toUtf8Bytes, concat, Interface, getCreate2Address } from 'ethers';
import { artifact, CREATE2_FACTORY } from './bridge.mjs';
import { timelockContract } from './board.mjs';

export const TIMELOCK_SALT = keccak256(toUtf8Bytes('ZERONYTH_BRIDGE_V1/timelock'));
export const MIN_DELAY = 86_400;
export const HANDOVER_SALT = keccak256(toUtf8Bytes('ZERONYTH_BRIDGE_V1/handover'));

export function timelockInitCode(admin) {
  const a = artifact('BridgeTimelock');
  return new ContractFactory(a.abi, a.bytecode).interface.encodeDeploy([0, [admin], [ZeroAddress], ZeroAddress]).replace(/^0x/, a.bytecode);
}
export const timelockAddress = (admin) => getCreate2Address(CREATE2_FACTORY, TIMELOCK_SALT, keccak256(timelockInitCode(admin)));

export function handoverBatch(tlAddr, target, guardian) {
  const tl = new Interface(artifact('BridgeTimelock').abi);
  const CANCELLER = keccak256(toUtf8Bytes('CANCELLER_ROLE'));
  return { targets: [tlAddr, target, tlAddr], values: [0, 0, 0],
    datas: [tl.encodeFunctionData('grantRole', [CANCELLER, guardian]), '0x79ba5097' /* acceptOwnership() */, tl.encodeFunctionData('updateDelay', [MIN_DELAY])] };
}

/** idempotent: deploy (if needed) + transferOwnership + handover batch. `send(label, txPromiseFn)` records tx hashes. */
export async function handover({ provider, admin, contract, guardian, send, opts = {}, known = null }) {
  // CREATE2 (same address on every chain) where the deterministic deployment proxy exists; plain CREATE otherwise (9127)
  // pass a NonceManager-wrapped signer: some RPCs (anvil block-time mode, load-balanced public RPCs) report a stale
  // pending nonce right after a receipt, so nonces are tracked locally.
  if (!(admin instanceof NonceManager)) admin = new NonceManager(admin);
  const adminAddr = await admin.getAddress();
  const hasFactory = (await provider.getCode(CREATE2_FACTORY)) !== '0x';
  let addr = hasFactory ? timelockAddress(adminAddr) : known;
  if (!addr || (await provider.getCode(addr)) === '0x') {
    const r = await send('deploy', () => (hasFactory
      ? admin.sendTransaction({ to: CREATE2_FACTORY, data: concat([TIMELOCK_SALT, timelockInitCode(adminAddr)]), ...opts })
      : admin.sendTransaction({ data: timelockInitCode(adminAddr), ...opts })));
    if (!hasFactory) addr = r.contractAddress;
  }
  const tl = timelockContract(addr, admin);
  const target = await contract.getAddress();
  if ((await contract.owner()).toLowerCase() !== addr.toLowerCase()) {
    if ((await contract.pendingOwner()).toLowerCase() !== addr.toLowerCase()) await send('transferOwnership', () => contract.connect(admin).transferOwnership(addr, opts));
    const b = handoverBatch(addr, target, guardian);
    const id = await tl.hashOperationBatch(b.targets, b.values, b.datas, '0x' + '00'.repeat(32), HANDOVER_SALT);
    if (!(await tl.isOperation(id))) await send('scheduleHandover', () => tl.scheduleBatch(b.targets, b.values, b.datas, '0x' + '00'.repeat(32), HANDOVER_SALT, 0, opts));
    if (!(await tl.isOperationDone(id))) await send('executeHandover', () => tl.executeBatch(b.targets, b.values, b.datas, '0x' + '00'.repeat(32), HANDOVER_SALT, opts));
  }
  const delay = Number(await tl.getMinDelay()); const owner = await contract.owner();
  if (owner.toLowerCase() !== addr.toLowerCase() || delay !== MIN_DELAY) throw new Error(`handover incomplete: owner ${owner} delay ${delay}`);
  return { address: addr, minDelay: delay };
}
