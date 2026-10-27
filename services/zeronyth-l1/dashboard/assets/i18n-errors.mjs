// Maps known technical messages to catalog keys. Unknown messages stay raw.
export class KeyedError extends Error {
  constructor(key, params) { super(key); this.key = key; this.params = params; }
}

const WALLET = new Map([
  ['接続・ネットワーク変更はキャンセルされました。', 'wallet.err.cancelled'],
  ['ウォレットに確認待ちの要求があります。ウォレットを開いて確認してください。', 'wallet.err.pending'],
  ['ウォレットでエラーが発生しました。', 'wallet.err.generic'],
  ['先にウォレットを接続してください。', 'wallet.err.connectFirst'],
  ['確認待ちの操作を完了してください。', 'wallet.err.finishPending'],
  ['ウォレットの確認を完了してから操作してください。', 'wallet.err.finishPending'],
  ['ウォレットが見つかりません。', 'wallet.err.noWallet'],
  ['接続するアカウントが選択されていません。', 'wallet.err.noAccount'],
  ['ウォレットから不正なアカウント・ネットワーク情報が返されました。', 'wallet.err.badReturn'],
  ['ウォレット用RPC URLが未設定です。', 'wallet.err.rpcUnset'],
  ['RPCのChain IDが9127と一致しません。', 'wallet.err.rpcMismatch'],
  ['接続状態が変わりました。もう一度操作してください。', 'wallet.err.stateChanged'],
  ['ウォレットのネットワーク切替が完了していません。', 'wallet.err.switchIncomplete'],
  ['RPC URLは認証情報やクエリーを含まないHTTPS URLにしてください。', 'wallet.err.rpcHttps'],
  ['外部のウォレットにはlocalhostのRPCを設定できません。', 'wallet.err.rpcLocalhost'],
]);

const GUARD = [
  [/must be a full 0x-prefixed EVM address/, 'guard.e.address'],
  [/positive decimal amount/, 'guard.e.decimal'],
  [/amount must be positive/i, 'guard.e.uint'],
  [/supports EVM, BNB and ZNYT only/, 'guard.e.network'],
  [/destination differs from the independently/, 'guard.e.mismatch'],
  [/not an entirely decoded native transfer/, 'guard.e.notNative'],
  [/EIP-1193 wallet provider is required/, 'guard.e.provider'],
  [/form changed since review/, 'guard.e.formChanged'],
  [/invalid chain ID/, 'guard.e.badChain'],
  [/wallet chain (\d+) does not match reviewed chain (\d+)/, 'guard.e.chainMismatch', (m) => ({ active: m[1], reviewed: m[2] })],
  [/account changed or is unavailable/, 'guard.e.accountChanged'],
  [/recipient is a contract/, 'guard.e.contract'],
];

const NODE = new Map([['ワーカーが停止したため、安全側で処理を終了しました', 'node.err.worker']]);
const P2P = new Map([
  ['P2P参加に失敗しました', 'p2p.err.join'],
  ['シグナリング一時停止', 'p2p.err.signal'],
  ['WebRTC PeerConnectionを生成できません', 'p2p.err.rtc'],
]);

const message = (error) => String(error?.message ?? error ?? '');
const asDescriptor = (key, params) => (params ? { key, params } : { key });

/** Returns { key, params? } for a known message, or the raw string. */
export function localizeWalletError(raw) {
  const text = message(raw);
  const key = WALLET.get(text);
  return key ? { key } : text;
}

export function localizeGuardError(error) {
  if (error instanceof KeyedError) return asDescriptor(error.key, error.params);
  const text = message(error).replace(/^BLOCKED:\s*/, '');
  for (const [pattern, key, extract] of GUARD) {
    const match = pattern.exec(text);
    if (match) return asDescriptor(key, extract?.(match));
  }
  const wallet = localizeWalletError(text);
  return wallet;
}

export function localizeNodeError(raw) {
  const text = message(raw);
  return NODE.has(text) ? { key: NODE.get(text) } : text;
}

export function localizeP2pError(raw) {
  const text = message(raw);
  return P2P.has(text) ? { key: P2P.get(text) } : text;
}
