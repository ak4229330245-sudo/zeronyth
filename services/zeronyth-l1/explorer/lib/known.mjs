// Known contracts / role addresses on the ZERONYTH main testnet (chain 9127), read from the deployment records
// already in this repo (public addresses only; never reads key files). Reloaded periodically by the service.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Interface } from 'ethers';

const ERC20 = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'function transfer(address to, uint256 value) returns (bool)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function transferFrom(address from, address to, uint256 value) returns (bool)',
  'function name() view returns (string)', 'function symbol() view returns (string)',
  'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
];
export const erc20 = new Interface(ERC20);

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const lc = (a) => (typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a) ? a.toLowerCase() : null);

export function loadKnown(root) {
  const abis = new Map(); // contract name -> Interface
  const abiFile = (name, file) => {
    const j = readJson(path.join(root, file)); const abi = Array.isArray(j) ? j : j?.abi;
    if (abi) try { abis.set(name, new Interface(abi)); } catch { /* skip */ }
  };
  for (const n of ['ZnytEconomy', 'EmissionPool', 'FeeSplitter', 'RewardPool', 'DevVesting', 'Incinerator']) abiFile(n, `economy/build/${n}.json`);
  for (const n of ['ZnytBridgeVault', 'BridgeAttestationBoard', 'BridgeTimelock', 'BridgeMinter', 'WrappedZnyt']) abiFile(n, `bridge/abi/${n}.json`);
  for (const n of ['WZNYT', 'ZTestToken', 'ZnytAmmRouter', 'ZnytTokenRouter', 'SwapLabPair']) abiFile(n, `points/amm/build/${n}.json`);
  abis.set('ERC20', erc20);

  const labels = new Map(); // lower addr -> { name, kind, abi }
  const add = (a, name, kind, abi) => { const k = lc(a); if (k && !labels.has(k)) labels.set(k, { name, kind, ...(abi ? { abi } : {}) }); };

  const eco = readJson(path.join(root, 'economy/deployments/main.json')) || {};
  add(eco.v2?.ZnytEconomy, 'ZnytEconomy（10日プラン）', 'system', 'ZnytEconomy');
  add(eco.v2?.EmissionPool, 'EmissionPool（報酬プール）', 'system', 'EmissionPool');
  add(eco.RewardPool, 'RewardPool', 'system', 'RewardPool');
  add(eco.FeeSplitter, 'FeeSplitter（手数料の分配・バーン）', 'system', 'FeeSplitter');
  add(eco.funder, 'Faucet（蛇口）', 'role');
  add(eco.deployer, 'Deployer（運営・デプロイ用）', 'role');
  add(eco.coordinator, 'Economy coordinator', 'role');
  (eco.validators || []).forEach((v, i) => add(v, `Validator ${i + 1}`, 'validator'));

  const amm = readJson(path.join(root, 'deployments/main-amm.json')) || {};
  add(amm.wznyt, 'wZNYT（Wrapped ZNYT）', 'token', 'WZNYT');
  add(amm.keeper, 'AMM price keeper', 'role');
  for (const [sym, t] of Object.entries(amm.tokens || {})) add(t.address, `${sym}（テストトークン）`, 'token', 'ZTestToken');
  for (const p of amm.pools || []) { add(p.pair, `AMM pair ${p.id}`, 'amm', 'SwapLabPair'); add(p.router, `AMM router ${p.id}`, 'amm', p.routerContract || 'ZnytAmmRouter'); }
  for (const r of amm.retired || []) { r.symbol = r.symbol || r.id || 'old'; if (r.token) add(r.token, `${r.symbol}（廃止）`, 'token', 'ZTestToken'); add(r.pair, `AMM pair ${r.symbol}（廃止）`, 'amm', 'SwapLabPair'); add(r.router, `AMM router ${r.symbol}（廃止）`, 'amm', r.routerContract || 'ZnytAmmRouter'); }

  const br = readJson(path.join(root, 'bridge/deployments/main.json')) || {};
  add(br.home?.vault, 'Bridge vault（ZNYT ブリッジ）', 'bridge', 'ZnytBridgeVault');
  add(br.home?.board, 'Bridge attestation board', 'bridge', 'BridgeAttestationBoard');
  add(br.home?.timelock || br.timelock, 'Bridge timelock', 'bridge', 'BridgeTimelock');
  add(br.admin, 'Bridge admin', 'role'); add(br.guardian, 'Bridge guardian', 'role');
  (br.relayers || []).forEach((r, i) => add(r.address, `Bridge relayer ${i}`, 'bridge'));
  add('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', 'Genesis (public dev key #0)', 'role');
  add('0x0000000000000000000000000000000000000000', 'Zero address (mint/burn)', 'system');

  const remotes = Object.values(br.remotes || {}).filter((r) => r && r.explorer)
    .map((r) => ({ chainId: r.chainId, id: r.id, name: r.name, explorer: r.explorer, status: r.status, token: r.token, minter: r.minter }));
  const genesis = readJson(path.join(root, 'config/genesis.json'));
  const genesisSupply = Object.values(genesis?.alloc || {}).reduce((s, v) => s + BigInt(v.balance || 0), 0n);
  return { abis, labels, remotes, wznyt: lc(amm.wznyt), vault: lc(br.home?.vault), board: lc(br.home?.board),
    feeSplitter: lc(eco.FeeSplitter), validators: (eco.validators || []).map(lc), genesisSupply, ammTokens: amm.tokens || {} };
}

// selector -> [{ contract, iface }] and topic0 -> [...] across every known ABI (for unlabeled addresses)
export function buildIndexes(abis) {
  const fn = new Map(), ev = new Map();
  for (const [name, iface] of abis) {
    iface.forEachFunction((f) => { const s = f.selector; if (!fn.has(s)) fn.set(s, { contract: name, iface }); });
    iface.forEachEvent((e) => { const t = e.topicHash; if (!ev.has(t)) ev.set(t, { contract: name, iface }); });
  }
  // ERC20 first for the generic Transfer/Approval
  for (const f of ['transfer', 'approve', 'transferFrom']) fn.set(erc20.getFunction(f).selector, { contract: 'ERC20', iface: erc20 });
  ev.set(erc20.getEvent('Transfer').topicHash, { contract: 'ERC20', iface: erc20 });
  ev.set(erc20.getEvent('Approval').topicHash, { contract: 'ERC20', iface: erc20 });
  return { fn, ev };
}
export { existsSync };
