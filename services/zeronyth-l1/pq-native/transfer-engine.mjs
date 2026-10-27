/** Pure deterministic transfer execution for an independently owned account component. */
import { MAX_UINT, ProtocolError, assertAddress, checkShape, uint } from './pq.mjs';

export function executeComponent(group) {
  checkShape(group, ['id','accounts','transfers'], 'execution component');
  if (!Number.isInteger(group.id) || group.id < 0 ||
      !Array.isArray(group.accounts) || !Array.isArray(group.transfers) ||
      group.accounts.length > 3072 || group.transfers.length > 1536) {
    throw new ProtocolError('Invalid bounded execution component');
  }
  const accounts = new Map();
  for (const item of group.accounts) {
    checkShape(item, ['address','balance','nonce'], 'component account');
    assertAddress(item.address);
    if (accounts.has(item.address)) throw new ProtocolError('Duplicate component account');
    accounts.set(item.address, {
      balance:uint(item.balance,'balance'), nonce:uint(item.nonce,'nonce'),
    });
  }
  for (const tx of group.transfers) {
    checkShape(tx, ['sender','to','nonce','value'], 'component transfer');
    assertAddress(tx.sender);
    assertAddress(tx.to);
    const source = accounts.get(tx.sender);
    if (!source || !accounts.has(tx.to)) throw new ProtocolError('Missing component account');
    const nonce = uint(tx.nonce,'nonce');
    const value = uint(tx.value,'value',{min:1n});
    if (nonce !== source.nonce) throw new ProtocolError('Nonce/replay rejected');
    if (source.nonce === MAX_UINT) throw new ProtocolError('Nonce overflow');
    if (value > source.balance) throw new ProtocolError('Insufficient balance');
    accounts.set(tx.sender, { balance:source.balance-value, nonce:source.nonce+1n });
    const destination = accounts.get(tx.to);
    if (destination.balance+value > MAX_UINT) throw new ProtocolError('Balance overflow');
    accounts.set(tx.to, { balance:destination.balance+value, nonce:destination.nonce });
  }
  return {
    id:group.id,
    accounts:[...accounts.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([address,state])=>({
      address, balance:state.balance.toString(), nonce:state.nonce.toString(),
    })),
  };
}
