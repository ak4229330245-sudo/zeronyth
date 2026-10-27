/** Public checkpoint evidence only; no private key or environment reads. */
async function rpc(method, params = []) {
  const body = await (await fetch('http://127.0.0.1:8545', { method: 'POST',
    headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(5000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })).json();
  if (body.error) throw Error(JSON.stringify(body.error));
  return body.result;
}
const block = await rpc('eth_getBlockByNumber', ['latest', false]);
console.log(JSON.stringify({ chainId: await rpc('eth_chainId'),
  block: { number: block.number, hash: block.hash, stateRoot: block.stateRoot },
  validators: await rpc('qbft_getValidatorsByBlockNumber', [block.number]),
  peers: await rpc('net_peerCount'), clientVersion: await rpc('web3_clientVersion'),
}, null, 2));
