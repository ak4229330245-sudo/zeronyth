// ZERONYTH Scan front-end (no framework, no inline scripts/styles; every chain-sourced string is escaped).
const LANG_KEY = 'zeronyth.language.v1';
const T = {
  ja: {
    searchPh: 'アドレス / Tx ハッシュ / ブロック番号 / トークン名', heroTitle: 'ZERONYTH ブロックエクスプローラ', heroSub: 'ウォレット・トランザクション・ブロック・トークンをすべて確認できます（chain 9127）',
    search: '検索', navBlocks: 'ブロック', navTxs: 'トランザクション', navTokens: 'トークン', navValidators: 'バリデータ', navBridge: 'ブリッジ',
    footNote: 'テストネット専用・資産価値はありません。公開チェーンデータのみを表示します。',
    height: 'ブロック高', blockTime: '平均ブロック時間', tps: 'TPS（直近100ブロック）', txsTotal: '総トランザクション', txs24h: '24時間', validators: 'バリデータ', gasPrice: 'ガス価格',
    supply: '総供給量', burned: 'バーン済み', indexing: 'インデックス中', synced: '同期済み', latestBlocks: '最新ブロック', latestTxs: '最新トランザクション', viewAll: 'すべて見る',
    block: 'ブロック', blocks: 'ブロック', tx: 'トランザクション', txs: 'トランザクション', age: '経過', proposer: '提案者', txCount: 'Tx 数', gasUsed: '使用ガス', gasLimit: 'ガス上限',
    hash: 'ハッシュ', parentHash: '親ハッシュ', timestamp: 'タイムスタンプ', size: 'サイズ', confirmations: '承認数', status: 'ステータス', success: '成功', failed: '失敗', pending: '保留中',
    from: '送信元', to: '送信先', value: '金額', fee: '手数料', gas: 'ガス', nonce: 'ナンス', method: 'メソッド', input: '入力データ', decodedInput: 'デコード済み入力', logs: 'イベントログ',
    tokenTransfers: 'トークン転送', created: '作成したコントラクト', address: 'アドレス', balance: 'ZNYT 残高', contract: 'コントラクト', eoa: 'ウォレット（EOA）', tokens: 'トークン',
    tokenBalances: 'トークン残高', creator: '作成者', points: 'ポイントを見る', bridgeActivity: 'ブリッジ / wZNYT', holders: 'ホルダー', transfers: '転送', totalSupply: '総供給量', decimals: '小数桁',
    rank: '順位', quantity: '数量', share: '割合', page: 'ページ', prev: '前へ', next: '次へ', notFound: '見つかりませんでした', noData: 'データはありません', copy: 'コピー', copied: 'コピーしました',
    in: '受信', out: '送信', self: '自分宛', blocksProposed: '提案したブロック', last1000: '直近1000ブロック', lastProposed: '最後の提案', latestProposer: '最新ブロックの提案者',
    consensus: 'コンセンサス', vault: 'ブリッジ Vault', vaultEvents: 'Vault イベント（ZERONYTH 側）', remoteTransfers: 'クロスチェーン転送', remoteExplorers: '接続チェーンのエクスプローラ',
    srcTx: '送信元 Tx', dstTx: '宛先 Tx', route: '経路', amount: '数量', results: '検索結果', contractCreation: 'コントラクト作成', label: 'ラベル', type: 'タイプ', topics: 'トピック', data: 'データ',
    internalNote: '内部トランザクション', addWallet: 'ウォレットに追加', wznytNote: 'wZNYT は ZNYT を 1:1 でラップした ERC-20 です（Deposit/Withdrawal をミント/バーンとして集計）。', raw: '生データ',
    rateLimited: 'リクエストが多すぎます。少し待ってから再読み込みしてください。', error: 'エラーが発生しました', indexedNote: 'このデータはノードから直接取得しました（まだインデックスされていません）。',
    holderOf: '保有', allTxs: '全トランザクション（入出金）', validatorBlocks: '提案ブロック', network: 'ネットワーク', live: '自動更新中', yes: 'はい', no: 'いいえ',
    home: 'ホーム', loading: '読み込み中…', metaDesc: 'ZERONYTH テストネット（chain 9127）のブロックエクスプローラ。アドレス・トランザクション・ブロック・トークンを検索できます。', titleSuffix: 'ブロックエクスプローラ',
  },
  en: {
    searchPh: 'Address / Tx hash / Block / Token name', heroTitle: 'ZERONYTH Block Explorer', heroSub: 'Look up any wallet, transaction, block or token on chain 9127',
    search: 'Search', navBlocks: 'Blocks', navTxs: 'Transactions', navTokens: 'Tokens', navValidators: 'Validators', navBridge: 'Bridge',
    footNote: 'Testnet only — tokens have no value. Shows public chain data only.',
    height: 'Block height', blockTime: 'Avg block time', tps: 'TPS (last 100 blocks)', txsTotal: 'Total transactions', txs24h: '24h', validators: 'Validators', gasPrice: 'Gas price',
    supply: 'Total supply', burned: 'Burned', indexing: 'Indexing', synced: 'Synced', latestBlocks: 'Latest blocks', latestTxs: 'Latest transactions', viewAll: 'View all',
    block: 'Block', blocks: 'Blocks', tx: 'Transaction', txs: 'Transactions', age: 'Age', proposer: 'Proposer', txCount: 'Txs', gasUsed: 'Gas used', gasLimit: 'Gas limit',
    hash: 'Hash', parentHash: 'Parent hash', timestamp: 'Timestamp', size: 'Size', confirmations: 'Confirmations', status: 'Status', success: 'Success', failed: 'Failed', pending: 'Pending',
    from: 'From', to: 'To', value: 'Value', fee: 'Fee', gas: 'Gas', nonce: 'Nonce', method: 'Method', input: 'Input data', decodedInput: 'Decoded input', logs: 'Event logs',
    tokenTransfers: 'Token transfers', created: 'Contract created', address: 'Address', balance: 'ZNYT balance', contract: 'Contract', eoa: 'Wallet (EOA)', tokens: 'Tokens',
    tokenBalances: 'Token balances', creator: 'Creator', points: 'View points', bridgeActivity: 'Bridge / wZNYT', holders: 'Holders', transfers: 'Transfers', totalSupply: 'Total supply', decimals: 'Decimals',
    rank: 'Rank', quantity: 'Quantity', share: 'Share', page: 'Page', prev: 'Prev', next: 'Next', notFound: 'Not found', noData: 'No data', copy: 'Copy', copied: 'Copied',
    in: 'IN', out: 'OUT', self: 'SELF', blocksProposed: 'Blocks proposed', last1000: 'Last 1000 blocks', lastProposed: 'Last proposed', latestProposer: 'Latest block proposer',
    consensus: 'Consensus', vault: 'Bridge vault', vaultEvents: 'Vault events (ZERONYTH side)', remoteTransfers: 'Cross-chain transfers', remoteExplorers: 'Connected chain explorers',
    srcTx: 'Source tx', dstTx: 'Destination tx', route: 'Route', amount: 'Amount', results: 'Results', contractCreation: 'Contract creation', label: 'Label', type: 'Type', topics: 'Topics', data: 'Data',
    internalNote: 'Internal transactions', addWallet: 'Add to wallet', wznytNote: 'wZNYT is ZNYT wrapped 1:1 as an ERC-20 (Deposit/Withdrawal counted as mint/burn).', raw: 'Raw',
    rateLimited: 'Too many requests — please wait a moment and reload.', error: 'Something went wrong', indexedNote: 'Fetched directly from the node (not indexed yet).',
    holderOf: 'Holding', allTxs: 'All transactions (in & out)', validatorBlocks: 'Proposed blocks', network: 'Network', live: 'Live', yes: 'Yes', no: 'No',
    home: 'Home', loading: 'Loading…', metaDesc: 'Block explorer for the ZERONYTH testnet (chain 9127). Search addresses, transactions, blocks and tokens.', titleSuffix: 'Block Explorer',
    internalTxNote: 'This node does not expose a trace API, so internal (contract-to-contract) ZNYT transfers are not shown — see the decoded event logs.',
  },
  'zh-CN': {
    searchPh: "地址 / 交易哈希 / 区块号 / 代币名称", heroTitle: "ZERONYTH 区块浏览器", heroSub: "可查看钱包、交易、区块和代币的全部信息（chain 9127）", search: "搜索", navBlocks: "区块", navTxs: "交易", navTokens: "代币", navValidators: "验证者", navBridge: "跨链桥", footNote: "仅限测试网，资产没有价值。只显示公开的链上数据。", height: "区块高度", blockTime: "平均出块时间", tps: "TPS（最近 100 个区块）", txsTotal: "交易总数", txs24h: "24 小时", validators: "验证者", gasPrice: "Gas 价格", supply: "总供应量", burned: "已销毁", indexing: "索引中", synced: "已同步", latestBlocks: "最新区块", latestTxs: "最新交易", viewAll: "查看全部", block: "区块", blocks: "区块", tx: "交易", txs: "交易", age: "时间", proposer: "提议者", txCount: "交易数", gasUsed: "已用 Gas", gasLimit: "Gas 上限", hash: "哈希", parentHash: "父哈希", timestamp: "时间戳", size: "大小", confirmations: "确认数", status: "状态", success: "成功", failed: "失败", pending: "待处理", from: "发送方", to: "接收方", value: "金额", fee: "手续费", gas: "Gas", nonce: "Nonce", method: "方法", input: "输入数据", decodedInput: "解码后的输入", logs: "事件日志", tokenTransfers: "代币转账", created: "创建的合约", address: "地址", balance: "ZNYT 余额", contract: "合约", eoa: "钱包（EOA）", tokens: "代币", tokenBalances: "代币余额", creator: "创建者", points: "查看积分", bridgeActivity: "跨链桥 / wZNYT", holders: "持有者", transfers: "转账", totalSupply: "总供应量", decimals: "小数位", rank: "排名", quantity: "数量", share: "占比", page: "页", prev: "上一页", next: "下一页", notFound: "未找到", noData: "暂无数据", copy: "复制", copied: "已复制", in: "转入", out: "转出", self: "自己", blocksProposed: "提议的区块", last1000: "最近 1000 个区块", lastProposed: "最后提议", latestProposer: "最新区块提议者", consensus: "共识", vault: "跨链桥 Vault", vaultEvents: "Vault 事件（ZERONYTH 侧）", remoteTransfers: "跨链转账", remoteExplorers: "已连接链的浏览器", srcTx: "源交易", dstTx: "目标交易", route: "路径", amount: "数量", results: "搜索结果", contractCreation: "合约创建", label: "标签", type: "类型", topics: "主题", data: "数据", internalNote: "内部交易", addWallet: "添加到钱包", wznytNote: "wZNYT 是将 ZNYT 按 1:1 封装的 ERC-20（Deposit/Withdrawal 计为铸造/销毁）。", raw: "原始数据", rateLimited: "请求过多，请稍等片刻后重新加载。", error: "发生错误", indexedNote: "此数据直接从节点获取（尚未建立索引）。", holderOf: "持有", allTxs: "全部交易（转入和转出）", validatorBlocks: "提议的区块", network: "网络", live: "自动更新中", yes: "是", no: "否", home: "首页", loading: "加载中…", metaDesc: "ZERONYTH 测试网（chain 9127）的区块浏览器。可搜索地址、交易、区块和代币。", titleSuffix: "区块浏览器", internalTxNote: "此节点未开放 trace API，因此无法显示内部交易（合约内的 ZNYT 转账）。请查看已解码的事件日志。",
  },
  ko: {
    searchPh: "주소 / Tx 해시 / 블록 번호 / 토큰 이름", heroTitle: "ZERONYTH 블록 익스플로러", heroSub: "지갑·거래·블록·토큰을 모두 확인할 수 있습니다 (chain 9127)", search: "검색", navBlocks: "블록", navTxs: "거래", navTokens: "토큰", navValidators: "검증자", navBridge: "브리지", footNote: "테스트넷 전용이며 자산 가치는 없습니다. 공개 체인 데이터만 표시합니다.", height: "블록 높이", blockTime: "평균 블록 시간", tps: "TPS (최근 100블록)", txsTotal: "전체 거래", txs24h: "24시간", validators: "검증자", gasPrice: "가스 가격", supply: "총공급량", burned: "소각됨", indexing: "인덱싱 중", synced: "동기화됨", latestBlocks: "최신 블록", latestTxs: "최신 거래", viewAll: "모두 보기", block: "블록", blocks: "블록", tx: "거래", txs: "거래", age: "경과", proposer: "제안자", txCount: "Tx 수", gasUsed: "사용 가스", gasLimit: "가스 한도", hash: "해시", parentHash: "부모 해시", timestamp: "타임스탬프", size: "크기", confirmations: "확인 수", status: "상태", success: "성공", failed: "실패", pending: "대기 중", from: "보낸 곳", to: "받는 곳", value: "금액", fee: "수수료", gas: "가스", nonce: "논스", method: "메서드", input: "입력 데이터", decodedInput: "디코딩된 입력", logs: "이벤트 로그", tokenTransfers: "토큰 전송", created: "생성한 컨트랙트", address: "주소", balance: "ZNYT 잔액", contract: "컨트랙트", eoa: "지갑 (EOA)", tokens: "토큰", tokenBalances: "토큰 잔액", creator: "생성자", points: "포인트 보기", bridgeActivity: "브리지 / wZNYT", holders: "보유자", transfers: "전송", totalSupply: "총공급량", decimals: "소수 자릿수", rank: "순위", quantity: "수량", share: "비율", page: "페이지", prev: "이전", next: "다음", notFound: "찾을 수 없습니다", noData: "데이터가 없습니다", copy: "복사", copied: "복사했습니다", in: "받음", out: "보냄", self: "자기 자신", blocksProposed: "제안한 블록", last1000: "최근 1000블록", lastProposed: "마지막 제안", latestProposer: "최신 블록 제안자", consensus: "합의", vault: "브리지 Vault", vaultEvents: "Vault 이벤트 (ZERONYTH 측)", remoteTransfers: "크로스체인 전송", remoteExplorers: "연결된 체인의 익스플로러", srcTx: "출발 Tx", dstTx: "도착 Tx", route: "경로", amount: "수량", results: "검색 결과", contractCreation: "컨트랙트 생성", label: "라벨", type: "유형", topics: "토픽", data: "데이터", internalNote: "내부 거래", addWallet: "지갑에 추가", wznytNote: "wZNYT는 ZNYT를 1:1로 래핑한 ERC-20입니다 (Deposit/Withdrawal을 민트/소각으로 집계).", raw: "원본 데이터", rateLimited: "요청이 너무 많습니다. 잠시 후 다시 불러와 주세요.", error: "오류가 발생했습니다", indexedNote: "이 데이터는 노드에서 직접 가져왔습니다 (아직 인덱싱되지 않음).", holderOf: "보유", allTxs: "전체 거래 (입출금)", validatorBlocks: "제안한 블록", network: "네트워크", live: "자동 업데이트 중", yes: "예", no: "아니요", home: "홈", loading: "불러오는 중…", metaDesc: "ZERONYTH 테스트넷(chain 9127)의 블록 익스플로러. 주소·거래·블록·토큰을 검색할 수 있습니다.", titleSuffix: "블록 익스플로러", internalTxNote: "이 노드는 trace API를 공개하지 않으므로 내부 거래(컨트랙트 내 ZNYT 송금)는 표시할 수 없습니다. 디코딩된 이벤트 로그를 확인해 주세요.",
  },
};
const LOCALES = ['ja', 'en', 'zh-CN', 'ko'];
const normLang = (v) => { if (!v) return null; const x = String(v).toLowerCase(); return x.startsWith('ja') ? 'ja' : x.startsWith('en') ? 'en' : x.startsWith('zh') ? 'zh-CN' : x.startsWith('ko') ? 'ko' : null; };
// ?lang= (set by links from the main site) wins, then the saved choice. The choice is saved so it sticks while browsing Scan.
let lang = (() => {
  let q = null; try { q = normLang(new URLSearchParams(location.search).get('lang')); } catch { /* ignore */ }
  let saved = null; try { saved = normLang(localStorage.getItem(LANG_KEY)); } catch { /* ignore */ }
  const v = q || saved || 'ja';
  if (q) { try { localStorage.setItem(LANG_KEY, q); } catch { /* ignore */ } }
  return v;
})();
const NUM_LOCALE = { ja: 'ja-JP', en: 'en-US', 'zh-CN': 'zh-CN', ko: 'ko-KR' };
// Server-side labels are written in Japanese ("Name（説明）"); translate the note for other languages.
const SRV = {
  'QBFT（1 秒ブロック・即時ファイナリティ）': { en: 'QBFT (1 s blocks, instant finality)', 'zh-CN': 'QBFT（1 秒出块，即时最终确定）', ko: 'QBFT (1초 블록, 즉시 완결성)' },
  '10日プラン': { en: '10-day plans', 'zh-CN': '10 天套餐', ko: '10일 플랜' },
  '報酬プール': { en: 'reward pool', 'zh-CN': '奖励池', ko: '보상 풀' },
  '手数料の分配・バーン': { en: 'fee split / burn', 'zh-CN': '手续费分配与销毁', ko: '수수료 분배·소각' },
  '蛇口': { en: 'faucet', 'zh-CN': '水龙头', ko: '파우셋' },
  '運営・デプロイ用': { en: 'operator / deployment', 'zh-CN': '运营与部署用', ko: '운영·배포용' },
  'テストトークン': { en: 'test token', 'zh-CN': '测试代币', ko: '테스트 토큰' },
  '廃止': { en: 'retired', 'zh-CN': '已停用', ko: '폐지' },
  'ZNYT ブリッジ': { en: 'ZNYT bridge', 'zh-CN': 'ZNYT 跨链桥', ko: 'ZNYT 브리지' },
};
function srvT(str) {
  if (lang === 'ja' || typeof str !== 'string') return str;
  if (SRV[str]?.[lang]) return SRV[str][lang];
  const m = /^(.*?)（([^（）]+)）$/.exec(str); const n = m && SRV[m[2]]?.[lang];
  if (!n) return str;
  return lang === 'zh-CN' ? `${m[1]}（${n}）` : `${m[1]} (${n})`;
}
const t = (k) => T[lang][k] ?? T.ja[k] ?? k;

// ---------- safe HTML ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(s);
const h = (strs, ...vals) => raw(strs.reduce((o, s, i) => o + s + (i < vals.length ? fmtVal(vals[i]) : ''), ''));
const fmtVal = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(fmtVal).join('') : v == null || v === false ? '' : esc(v));

// ---------- formatting ----------
function units(v, dec = 18, max = 6) {
  if (v == null) return '—';
  let b; try { b = BigInt(v); } catch { return esc(v); }
  const neg = b < 0n; if (neg) b = -b;
  const base = 10n ** BigInt(dec); const i = b / base; let f = (b % base).toString().padStart(dec, '0').slice(0, max).replace(/0+$/, '');
  const is = i.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + is + (f ? '.' + f : '');
}
const num = (n) => (n == null ? '—' : Number(n).toLocaleString(NUM_LOCALE[lang] || 'en-US'));
const gwei = (w) => (w == null ? '—' : `${units(w, 9, 4)} gwei`);
function ago(ts) {
  if (!ts) return '—'; const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (lang === 'ja') return s < 60 ? `${s}秒前` : s < 3600 ? `${Math.floor(s / 60)}分前` : s < 86400 ? `${Math.floor(s / 3600)}時間前` : `${Math.floor(s / 86400)}日前`;
  if (lang === 'zh-CN') return s < 60 ? `${s} 秒前` : s < 3600 ? `${Math.floor(s / 60)} 分钟前` : s < 86400 ? `${Math.floor(s / 3600)} 小时前` : `${Math.floor(s / 86400)} 天前`;
  if (lang === 'ko') return s < 60 ? `${s}초 전` : s < 3600 ? `${Math.floor(s / 60)}분 전` : s < 86400 ? `${Math.floor(s / 3600)}시간 전` : `${Math.floor(s / 86400)}일 전`;
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
}
const dt = (ts) => (ts ? new Date(ts * 1000).toLocaleString(NUM_LOCALE[lang] || 'en-US', { timeZone: 'Asia/Tokyo', hour12: false }) + ' JST' : '—');
const short = (s, a = 8, b = 6) => (s && s.length > a + b + 2 ? `${s.slice(0, a)}…${s.slice(-b)}` : s || '');
let LABELS = {};
const lab = (a) => { const l = a ? LABELS[a.toLowerCase()] : null; return l ? { ...l, name: srvT(l.name) } : null; };
function addr(a, { full = false, self = null } = {}) {
  if (!a) return h`<span class="muted">—</span>`;
  const l = lab(a); const isSelf = self && self.toLowerCase() === a.toLowerCase();
  const text = l ? l.name : full ? a : short(a, 10, 8);
  return h`<a class="addr ${l ? 'k-' + l.kind : ''} ${isSelf ? 'self' : ''}" href="/address/${a}" data-link title="${a}">${text}</a>${l && full ? h` <span class="mono muted small brk">${a}</span>` : ''}`;
}
const txl = (hsh, full = false) => h`<a class="mono" href="/tx/${hsh}" data-link title="${hsh}">${full ? hsh : short(hsh, 10, 8)}</a>`;
const blk = (n) => h`<a href="/block/${n}" data-link>${num(n)}</a>`;
const copyBtn = (v) => h`<button type="button" class="copy" data-copy="${v}">${t('copy')}</button>`;
const statusBadge = (s, pending) => (pending ? h`<span class="badge warn">${t('pending')}</span>` : s === 1 ? h`<span class="badge ok">✓ ${t('success')}</span>` : s === 0 ? h`<span class="badge bad">✕ ${t('failed')}</span>` : h`<span class="badge">—</span>`);
let TOK = {};
const tokSym = (a) => { const x = TOK[a?.toLowerCase()]; return x?.symbol || short(a, 6, 4); };
const tokDec = (a) => TOK[a?.toLowerCase()]?.decimals ?? 18;

// ---------- data ----------
class HttpError extends Error { constructor(code) { super(String(code)); this.code = code; } }
async function get(p) {
  const r = await fetch(p, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new HttpError(r.status);
  const j = await r.json(); if (j.labels) Object.assign(LABELS, j.labels); if (j.tokens && !Array.isArray(j.tokens)) for (const [k, v] of Object.entries(j.tokens)) TOK[k.toLowerCase()] = v;
  return j;
}

// ---------- layout pieces ----------
const app = () => document.getElementById('app');
const card = (title, body, extra = '') => h`<section class="card"><div class="card-h"><h2>${title}</h2>${raw(String(extra))}</div>${body}</section>`;
const kv = (rows) => h`<dl class="kv">${rows.filter(Boolean).map(([k, v]) => h`<div class="kv-r"><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
function pager(base, page, total, size) {
  const pages = Math.max(1, Math.ceil(total / size));
  const link = (p, txt, dis) => (dis ? h`<span class="pg dis">${txt}</span>` : h`<a class="pg" href="${base}${base.includes('?') ? '&' : '?'}page=${p}" data-link>${txt}</a>`);
  return h`<div class="pager">${link(page - 1, '‹ ' + t('prev'), page <= 1)}<span class="pg cur">${t('page')} ${num(page)} / ${num(Math.min(pages, 400))}</span>${link(page + 1, t('next') + ' ›', page >= Math.min(pages, 400))}</div>`;
}
const table = (heads, rows, empty = t('noData')) => (rows.length ? h`<div class="tbl-w"><table class="tbl"><thead><tr>${heads.map((x) => h`<th>${x}</th>`)}</tr></thead><tbody>${rows}</tbody></table></div>` : h`<p class="muted pad">${empty}</p>`);
const searchBox = (big) => h`<form class="search ${big ? 'big' : ''}" data-search role="search"><input name="q" autocomplete="off" spellcheck="false" placeholder="${t('searchPh')}" aria-label="${t('search')}"><button type="submit">${t('search')}</button></form>`;
function dir(tx, me) {
  const f = tx.from?.toLowerCase(), to = (tx.to || tx.created)?.toLowerCase(); me = me.toLowerCase();
  if (f === me && to === me) return h`<span class="dir self">${t('self')}</span>`;
  return f === me ? h`<span class="dir out">${t('out')}</span>` : h`<span class="dir in">${t('in')}</span>`;
}
function txRows(txs, me) {
  return txs.map((x) => h`<tr><td>${txl(x.hash)}</td><td><span class="meth">${x.created ? t('contractCreation') : x.method || 'transfer'}</span></td><td>${blk(x.block)}</td><td class="nowrap" title="${dt(x.timestamp)}">${ago(x.timestamp)}</td><td>${addr(x.from, { self: me })}</td>${me ? h`<td>${dir(x, me)}</td>` : ''}<td>${x.to ? addr(x.to, { self: me }) : x.created ? addr(x.created) : '—'}</td><td class="num">${units(x.value)} ZNYT</td><td class="num muted">${units(x.fee, 18, 8)}</td><td>${statusBadge(x.status)}</td></tr>`);
}
const txHeads = (me) => [t('hash'), t('method'), t('block'), t('age'), t('from'), ...(me ? [''] : []), t('to'), t('value'), t('fee'), t('status')];
function trRows(trs, me, showToken = true) {
  return trs.map((x) => h`<tr><td>${txl(x.tx)}</td><td class="nowrap" title="${dt(x.timestamp)}">${ago(x.timestamp)}</td><td>${addr(x.from, { self: me })}</td>${me ? h`<td>${dir(x, me)}</td>` : ''}<td>${addr(x.to, { self: me })}</td><td class="num">${units(x.value, tokDec(x.token))}</td>${showToken ? h`<td><a href="/token/${x.token}" data-link>${tokSym(x.token)}</a></td>` : ''}</tr>`);
}
const trHeads = (me, showToken = true) => [t('tx'), t('age'), t('from'), ...(me ? [''] : []), t('to'), t('amount'), ...(showToken ? [t('tokens')] : [])];
function argVal(a) {
  const v = a.value;
  if (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)) return addr(v, { full: true });
  if (Array.isArray(v)) return h`<span class="mono">[${v.map((x, i) => h`${i ? ', ' : ''}${typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x) ? addr(x) : JSON.stringify(x)}`)}]</span>`;
  if (/^u?int/.test(a.type) && /^\d{19,}$/.test(String(v))) return h`<span class="mono">${v}</span> <span class="muted">(÷10¹⁸ = ${units(v)})</span>`;
  return h`<span class="mono brk">${String(v)}</span>`;
}
const decodedTable = (d) => h`<div class="dec"><div class="dec-sig"><span class="badge">${d.contract}</span> <code>${d.signature || d.method || d.event}</code></div>${d.args?.length ? h`<table class="tbl mini"><thead><tr><th>#</th><th>name</th><th>type</th><th>value</th></tr></thead><tbody>${d.args.map((a, i) => h`<tr><td>${i}</td><td>${a.name}</td><td class="muted">${a.type}</td><td>${argVal(a)}</td></tr>`)}</tbody></table>` : ''}</div>`;

// ---------- pages ----------
let liveTimer = null;
async function pageHome() {
  const render = async (first) => {
    const [s, b, x] = await Promise.all([get('/api/stats'), get('/api/blocks?size=10'), get('/api/txs?size=10')]);
    const stats = h`<div class="stats">
      ${[[t('height'), blk(s.head)], [t('blockTime'), s.blockTime ? `${s.blockTime.toFixed(2)} s` : '—'], [t('tps'), s.tps.toFixed(3)],
      [t('txsTotal'), h`${num(s.txs)} <small class="muted">${t('txs24h')} ${num(s.txs24h)}</small>`], [t('validators'), h`<a href="/validators" data-link>${num(s.validators)}</a> <small class="muted">QBFT</small>`],
      [t('gasPrice'), gwei(s.gasPrice)], [t('supply'), `${units(s.totalSupply, 18, 0)} ZNYT`], [t('burned'), h`${units(s.burned, 18, 4)} ZNYT`]]
      .map(([k, v]) => h`<div class="stat"><div class="stat-k">${k}</div><div class="stat-v">${v}</div></div>`)}
    </div><p class="sync ${s.lag > 5 ? 'warn' : ''}">${s.lag > 5 ? `${t('indexing')} ${num(s.indexed)} / ${num(s.head)}` : h`<span class="dot"></span>${t('synced')} · ${t('live')}`}</p>`;
    const lb = b.blocks.map((r) => h`<li class="row"><div class="ico">Bk</div><div class="grow"><div>${blk(r.number)} <span class="muted nowrap">${ago(r.timestamp)}</span></div><div class="muted small">${t('proposer')} ${addr(r.miner)}</div></div><div class="pill">${num(r.txCount)} tx</div></li>`);
    const lt = x.txs.map((r) => h`<li class="row"><div class="ico">Tx</div><div class="grow"><div>${txl(r.hash)} <span class="muted nowrap">${ago(r.timestamp)}</span></div><div class="muted small">${t('from')} ${addr(r.from)} → ${r.to ? addr(r.to) : t('contractCreation')}</div></div><div class="pill">${units(r.value, 18, 4)} ZNYT</div></li>`);
    const live = h`${stats}<div class="grid2">${card(t('latestBlocks'), h`<ul class="list">${lb}</ul>`, h`<a href="/blocks" data-link class="small">${t('viewAll')} →</a>`)}
      ${card(t('latestTxs'), h`<ul class="list">${lt}</ul>`, h`<a href="/txs" data-link class="small">${t('viewAll')} →</a>`)}</div>`;
    if (first) app().innerHTML = h`<div class="hero"><h1>${t('heroTitle')}</h1><p class="muted">${t('heroSub')}</p>${searchBox(true)}</div><div id="live">${live}</div>`;
    else { const el = document.getElementById('live'); if (el) el.innerHTML = String(live); }
  };
  await render(true);
  liveTimer = setInterval(() => { if (!document.hidden && location.pathname === '/') render(false).catch(() => {}); }, 4000);
}
async function pageBlocks(q) {
  const pg = Number(q.get('page') || 1); const d = await get(`/api/blocks?page=${pg}`);
  app().innerHTML = card(t('blocks'), h`${table([t('block'), t('age'), t('txCount'), t('proposer'), t('gasUsed'), t('hash')], d.blocks.map((b) => h`<tr><td>${blk(b.number)}</td><td class="nowrap" title="${dt(b.timestamp)}">${ago(b.timestamp)}</td><td>${num(b.txCount)}</td><td>${addr(b.miner)}</td><td class="num">${num(b.gasUsed)}</td><td class="mono muted">${short(b.hash, 10, 6)}</td></tr>`))}${pager('/blocks', d.page, d.total, d.size)}`);
}
async function pageTxs(q) {
  const pg = Number(q.get('page') || 1); const d = await get(`/api/txs?page=${pg}`);
  app().innerHTML = card(t('txs'), h`${table(txHeads(), txRows(d.txs))}${pager('/txs', d.page, d.total, d.size)}`);
}
async function pageBlock(id) {
  const b = await get(`/api/block/${id}`);
  app().innerHTML = h`${card(h`${t('block')} #${num(b.number)}`, kv([
    [t('block'), h`<span class="nav-n"><a href="/block/${b.number - 1}" data-link class="pg">‹</a> ${num(b.number)} <a href="/block/${b.number + 1}" data-link class="pg">›</a></span>`],
    [t('timestamp'), h`${dt(b.timestamp)} <span class="muted">(${ago(b.timestamp)})</span>`], [t('confirmations'), num(b.confirmations)],
    [t('proposer'), addr(b.miner, { full: true })], [t('txCount'), num(b.txCount)], [t('gasUsed'), h`${num(b.gasUsed)} / ${num(b.gasLimit)}`], [t('size'), `${num(b.size)} bytes`],
    [t('hash'), h`<span class="mono brk">${b.hash}</span>${copyBtn(b.hash)}`], [t('parentHash'), b.number > 0 ? h`<a class="mono brk" href="/block/${b.parentHash}" data-link>${b.parentHash}</a>` : h`<span class="mono brk">${b.parentHash}</span>`]]))}
    ${card(t('txs'), table(txHeads(), txRows(b.txs)))}`;
}
async function pageTx(hash) {
  const x = await get(`/api/tx/${hash}`);
  const tr = x.tokenTransfers.map((r) => h`<li>${addr(r.from)} → ${addr(r.to)} · <b>${units(r.value, tokDec(r.token))}</b> <a href="/token/${r.token}" data-link>${tokSym(r.token)}</a></li>`);
  const logs = x.logs.map((l) => h`<div class="log"><div class="log-h"><span class="pill">#${l.logIndex}</span> ${addr(l.address, { full: true })}</div>${l.decoded ? decodedTable(l.decoded) : ''}<details><summary>${t('raw')}</summary><div class="small"><b>${t('topics')}</b>${l.topics.map((tp, i) => h`<div class="mono brk">[${i}] ${tp}</div>`)}<b>${t('data')}</b><div class="mono brk">${l.data}</div></div></details></div>`);
  app().innerHTML = h`${card(t('tx'), h`${x.indexed ? '' : h`<p class="note">${t('indexedNote')}</p>`}${kv([
    [t('hash'), h`<span class="mono brk">${x.hash}</span>${copyBtn(x.hash)}`], [t('status'), statusBadge(x.status, x.pending)],
    [t('block'), x.block != null ? h`${blk(x.block)} <span class="muted">${num(x.confirmations)} ${t('confirmations')}</span>` : '—'],
    [t('timestamp'), h`${dt(x.timestamp)} <span class="muted">(${ago(x.timestamp)})</span>`], x.proposer && [t('proposer'), addr(x.proposer)],
    [t('from'), h`${addr(x.from, { full: true })}${copyBtn(x.from)}`], [x.created ? t('created') : t('to'), x.created ? h`${addr(x.created, { full: true })} <span class="badge">${t('contract')}</span>` : h`${addr(x.to, { full: true })}${x.to ? copyBtn(x.to) : ''}`],
    [t('method'), h`<span class="meth">${x.created ? t('contractCreation') : x.decoded?.method || (x.input === '0x' ? 'transfer' : x.decoded?.selector || '—')}</span>`],
    [t('value'), h`<b>${units(x.value)} ZNYT</b>`], [t('fee'), h`${units(x.fee, 18, 9)} ZNYT <span class="muted">(${num(x.gasUsed)} gas × ${gwei(x.gasPrice)})</span>`],
    [t('gas'), h`${num(x.gasUsed)} / ${num(x.gas)} ${x.gas ? h`<span class="muted">(${((x.gasUsed / x.gas) * 100).toFixed(1)}%)</span>` : ''}`], [t('nonce'), h`${num(x.nonce)} <span class="muted">type ${x.type}</span>`],
    x.tokenTransfers.length && [t('tokenTransfers'), h`<ul class="plain">${tr}</ul>`],
    [t('input'), h`${x.decoded?.method ? decodedTable(x.decoded) : ''}<details ${x.decoded?.method ? '' : 'open'}><summary>${t('raw')}</summary><pre class="mono brk input">${x.input}</pre></details>`],
  ])}`)}
  ${card(h`${t('logs')} (${x.logs.length})`, x.logs.length ? h`${logs}` : h`<p class="muted pad">${t('noData')}</p>`)}
  <p class="muted small pad">${t('internalNote')}: ${lang === 'ja' ? x.internalTxNote : t('internalTxNote')}</p>`;
}
const TABS_ADDR = ['txs', 'transfers', 'tokens', 'bridge', 'blocks'];
async function pageAddress(a, q) {
  const tab = TABS_ADDR.includes(q.get('tab')) ? q.get('tab') : 'txs'; const pg = Number(q.get('page') || 1);
  const d = await get(`/api/address/${a}`);
  if (d.token && !q.get('tab')) return go(`/token/${d.address}`, true);
  const me = d.address;
  const tabs = [['txs', h`${t('allTxs')} <span class="pill">${num(d.txCount)}</span>`], ['transfers', h`${t('tokenTransfers')} <span class="pill">${num(d.transferCount)}</span>`],
    ['tokens', h`${t('tokens')} <span class="pill">${num(d.tokens.length)}</span>`], ['bridge', h`${t('bridgeActivity')}`], ...(d.validator ? [['blocks', h`${t('validatorBlocks')} <span class="pill">${num(d.validator.blocksProposed)}</span>`]] : [])];
  let body;
  if (tab === 'txs') { const r = await get(`/api/address/${a}/txs?page=${pg}`); body = h`${table(txHeads(me), txRows(r.txs, me))}${pager(`/address/${me}?tab=txs`, r.page, r.total, r.size)}`; }
  else if (tab === 'transfers') { const r = await get(`/api/address/${a}/transfers?page=${pg}`); body = h`${table(trHeads(me), trRows(r.transfers, me))}${pager(`/address/${me}?tab=transfers`, r.page, r.total, r.size)}`; }
  else if (tab === 'tokens') body = table([t('tokens'), t('quantity'), t('address')], d.tokens.map((x) => h`<tr><td><a href="/token/${x.token}" data-link><b>${x.symbol || '?'}</b></a> <span class="muted small">${x.name || ''}</span></td><td class="num">${units(x.value, x.decimals)}</td><td>${addr(x.token)}</td></tr>`));
  else if (tab === 'bridge') body = bridgeBody(d.bridge.transfers, d.bridge.vaultEvents, d.bridge.remotes, me);
  else { const r = await get(`/api/address/${a}/blocks?page=${pg}`); body = h`${table([t('block'), t('age'), t('txCount'), t('gasUsed')], r.blocks.map((b) => h`<tr><td>${blk(b.number)}</td><td>${ago(b.timestamp)}</td><td>${num(b.txCount)}</td><td class="num">${num(b.gasUsed)}</td></tr>`))}${pager(`/address/${me}?tab=blocks`, r.page, r.total, r.size)}`; }
  const tokSum = d.tokens.slice(0, 8).map((x) => h`<a class="chip" href="/token/${x.token}" data-link>${units(x.value, x.decimals, 4)} ${x.symbol || '?'}</a>`);
  app().innerHTML = h`<section class="card addr-head"><div class="card-h"><h2>${d.isContract ? t('contract') : t('address')} ${d.label ? h`<span class="badge k-${d.label.kind}">${srvT(d.label.name)}</span>` : ''} ${d.isContract ? h`<span class="badge">${t('contract')}</span>` : h`<span class="badge">${t('eoa')}</span>`}</h2></div>
    <div class="addr-line"><span class="mono brk big">${me}</span>${copyBtn(me)}</div>
    <div class="ov">
      <div class="ov-c"><div class="stat-k">${t('balance')}</div><div class="stat-v big">${units(d.balance, 18, 6)} <small>ZNYT</small></div></div>
      <div class="ov-c"><div class="stat-k">${t('txs')}</div><div class="stat-v">${num(d.txCount)} <small class="muted">${t('nonce')} ${num(d.nonce)}</small></div></div>
      <div class="ov-c"><div class="stat-k">${t('tokenBalances')}</div><div class="chips">${tokSum.length ? tokSum : h`<span class="muted">—</span>`}</div></div>
    </div>
    ${kv([d.creator && [t('creator'), h`${addr(d.creator.address)} · ${txl(d.creator.tx)}`], d.validator && [t('blocksProposed'), num(d.validator.blocksProposed)], d.isContract && [t('size'), `${num(d.codeSize)} bytes`]])}
    <p class="links"><a class="btn" href="${d.points}" rel="noopener">★ ${t('points')}</a></p></section>
    <section class="card"><nav class="tabs">${tabs.map(([k, label]) => h`<a class="tab ${k === tab ? 'on' : ''}" href="/address/${me}?tab=${k}" data-link>${label}</a>`)}</nav>${body}</section>`;
}
function remoteTxLink(remotes, chainId, hash) {
  if (!hash) return h`<span class="muted">—</span>`;
  if (Number(chainId) === 9127) return txl(hash);
  const r = remotes.find((x) => Number(x.chainId) === Number(chainId));
  return r?.explorer ? h`<a class="mono" href="${r.explorer}/tx/${hash}" rel="noopener noreferrer" target="_blank">${short(hash, 8, 6)} ↗</a>` : h`<span class="mono">${short(hash, 8, 6)}</span>`;
}
const chainName = (remotes, id) => remotes.find((x) => Number(x.chainId) === Number(id))?.name || `chain ${id}`;
function bridgeBody(transfers, events, remotes, me) {
  const trs = table([t('route'), t('amount'), t('from'), t('to'), t('srcTx'), t('dstTx'), t('status'), t('age')], transfers.map((x) => h`<tr><td class="nowrap">${chainName(remotes, x.srcChainId)} → ${chainName(remotes, x.dstChainId)}</td><td class="num">${units(x.amount)} ZNYT</td><td>${addr(x.sender, { self: me })}</td><td>${addr(x.recipient, { self: me })}</td><td>${remoteTxLink(remotes, x.srcChainId, x.srcTx)}</td><td>${remoteTxLink(remotes, x.dstChainId, x.dstTx)}</td><td><span class="badge ${x.status === 'minted' || x.status === 'released' || x.status === 'done' ? 'ok' : ''}">${x.status}</span></td><td class="nowrap">${x.createdAt ? ago(Date.parse(x.createdAt) / 1000) : '—'}</td></tr>`));
  const ev = events.map((e) => h`<tr><td>${txl(e.tx)}</td><td>${blk(e.block)}</td><td>${e.decoded ? h`<span class="meth">${e.decoded.event}</span>` : '—'}</td><td class="small">${(e.decoded?.args || []).map((a) => h`<div><span class="muted">${a.name}:</span> ${a.type === 'uint256' && /amount/.test(a.name) ? `${units(a.value)} ZNYT` : /^0x[0-9a-fA-F]{40}$/.test(String(a.value)) ? addr(a.value) : a.type === 'uint256' && /chain/i.test(a.name) ? chainName(remotes, a.value) : String(a.value)}</div>`)}</td></tr>`);
  return h`<h3>${t('remoteTransfers')}</h3>${trs}<h3>${t('vaultEvents')}</h3>${table([t('tx'), t('block'), 'Event', 'Args'], ev)}
    <h3>${t('remoteExplorers')}</h3><ul class="plain cols">${remotes.map((r) => h`<li><a href="${r.explorer}" rel="noopener noreferrer" target="_blank">${r.name} ↗</a> <span class="muted small">${r.chainId} · ${r.status}</span></li>`)}</ul><p class="muted small">${t('wznytNote')}</p>`;
}
async function pageToken(a, q) {
  const tab = q.get('tab') === 'transfers' ? 'transfers' : 'holders'; const pg = Number(q.get('page') || 1);
  const d = await get(`/api/token/${a}`); TOK[d.address.toLowerCase()] = d;
  let body;
  if (tab === 'holders') {
    const r = await get(`/api/token/${a}/holders?page=${pg}`); const sup = d.totalSupply ? BigInt(d.totalSupply) : 0n;
    body = h`${table([t('rank'), t('address'), t('quantity'), t('share')], r.holders.map((x) => h`<tr><td>${x.rank}</td><td>${addr(x.address, { full: true })}</td><td class="num">${units(x.value, d.decimals)}</td><td class="num">${sup > 0n ? (Number((BigInt(x.value) * 1000000n) / sup) / 10000).toFixed(4) + '%' : '—'}</td></tr>`))}${pager(`/token/${d.address}?tab=holders`, r.page, r.total, r.size)}`;
  } else { const r = await get(`/api/token/${a}/transfers?page=${pg}`); body = h`${table(trHeads(null, false), trRows(r.transfers, null, false))}${pager(`/token/${d.address}?tab=transfers`, r.page, r.total, r.size)}`; }
  app().innerHTML = h`${card(h`${t('tokens')}: ${d.symbol || '?'} <span class="muted small">${d.name || ''}</span>`, h`${kv([
    [t('address'), h`<a class="mono brk" href="/address/${d.address}?tab=txs" data-link>${d.address}</a>${copyBtn(d.address)}`], [t('totalSupply'), h`${units(d.totalSupply, d.decimals)} ${d.symbol || ''}`],
    [t('holders'), num(d.holders)], [t('transfers'), num(d.transfers)], [t('decimals'), d.decimals], d.label && [t('label'), d.label]])}${d.isWrappedNative ? h`<p class="note">${t('wznytNote')}</p>` : ''}`)}
    <section class="card"><nav class="tabs"><a class="tab ${tab === 'holders' ? 'on' : ''}" href="/token/${d.address}?tab=holders" data-link>${t('holders')} <span class="pill">${num(d.holders)}</span></a><a class="tab ${tab === 'transfers' ? 'on' : ''}" href="/token/${d.address}?tab=transfers" data-link>${t('transfers')} <span class="pill">${num(d.transfers)}</span></a></nav>${body}</section>`;
}
async function pageTokens() {
  const d = await get('/api/tokens');
  app().innerHTML = card(t('tokens'), table([t('tokens'), t('address'), t('holders'), t('transfers'), t('decimals')], d.tokens.map((x) => h`<tr><td><a href="/token/${x.address}" data-link><b>${x.symbol || '?'}</b></a> <span class="muted small">${x.name || ''}</span></td><td>${addr(x.address)}</td><td class="num">${num(x.holders)}</td><td class="num">${num(x.transfers)}</td><td>${x.decimals}</td></tr>`)));
}
async function pageValidators() {
  const d = await get('/api/validators');
  app().innerHTML = card(t('validators'), h`${kv([[t('consensus'), srvT(d.consensus)], [t('latestProposer'), h`${addr(d.latestProposer, { full: true })} · ${blk(d.head)}`]])}
    ${table([t('address'), t('blocksProposed'), t('last1000'), t('lastProposed')], d.validators.map((v) => h`<tr><td>${addr(v.address, { full: true })}</td><td class="num">${num(v.blocksProposed)}</td><td class="num">${num(v.last1000)}</td><td>${v.lastBlock != null ? blk(v.lastBlock) : '—'}</td></tr>`))}`);
}
async function pageBridge() {
  const d = await get('/api/bridge');
  app().innerHTML = card(t('navBridge'), h`${kv([[t('vault'), addr(d.vault, { full: true })], ['wZNYT', h`<a href="/token/${d.wznyt}" data-link>${d.wznyt}</a>`]])}${bridgeBody(d.transfers, d.vaultEvents, d.remotes, null)}`);
}
async function pageSearch(q) {
  const s = q.get('q') || '';
  const r = await get(`/api/search?q=${encodeURIComponent(s)}`);
  if (r.type === 'tx') return go(`/tx/${r.id}`, true);
  if (r.type === 'block') return go(`/block/${r.id}`, true);
  if (r.type === 'address') return go(`/address/${r.id}`, true);
  if (r.type === 'token') return go(`/token/${r.id}`, true);
  app().innerHTML = card(h`${t('results')}: “${s}”`, h`${searchBox(false)}${r.type === 'list' ? h`<ul class="plain">${r.results.map((x) => h`<li><a href="/${x.type}/${x.id}" data-link><b>${x.name}</b></a> <span class="mono muted small">${x.id}</span></li>`)}</ul>` : h`<p class="muted pad">${t('notFound')}</p>`}`);
}

// ---------- router ----------
async function route() {
  clearInterval(liveTimer); liveTimer = null;
  const p = location.pathname, q = new URLSearchParams(location.search); let m;
  document.querySelectorAll('#nav a, #mnav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '/' ? p === '/' : p.startsWith(a.getAttribute('href'))));
  try {
    document.title = 'ZERONYTH Scan';
    if (p === '/' || p === '/explorer') await pageHome();
    else if (p === '/blocks') await pageBlocks(q);
    else if (p === '/txs') await pageTxs(q);
    else if ((m = p.match(/^\/block\/(\d+|0x[0-9a-fA-F]{64})\/?$/))) { document.title = `Block ${m[1]} | ZERONYTH Scan`; await pageBlock(m[1]); }
    else if ((m = p.match(/^\/tx\/(0x[0-9a-fA-F]{64})\/?$/))) { document.title = `Tx ${short(m[1])} | ZERONYTH Scan`; await pageTx(m[1]); }
    else if ((m = p.match(/^\/address\/(0x[0-9a-fA-F]{40})\/?$/))) { document.title = `Address ${short(m[1])} | ZERONYTH Scan`; await pageAddress(m[1], q); }
    else if ((m = p.match(/^\/token\/(0x[0-9a-fA-F]{40})\/?$/))) { document.title = `Token ${short(m[1])} | ZERONYTH Scan`; await pageToken(m[1], q); }
    else if (p === '/tokens') await pageTokens();
    else if (p === '/validators') await pageValidators();
    else if (p === '/bridge') await pageBridge();
    else if (p === '/search') await pageSearch(q);
    else app().innerHTML = card(t('notFound'), searchBox(false));
  } catch (e) {
    app().innerHTML = card(e?.code === 404 ? t('notFound') : e?.code === 429 ? t('rateLimited') : t('error'), h`<p class="muted pad">${e?.code === 404 ? location.pathname : ''}</p>${searchBox(false)}`);
  }
}
function go(url, replace = false) { if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url); window.scrollTo(0, 0); return route(); }
function applyLang() {
  document.documentElement.lang = lang; const sel = document.getElementById('lang'); if (sel) sel.value = lang;
  document.title = `ZERONYTH Scan — ${t('titleSuffix')}`;
  const md = document.querySelector('meta[name="description"]'); if (md) md.setAttribute('content', t('metaDesc'));
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
}
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-copy]');
  if (c) { navigator.clipboard?.writeText(c.dataset.copy).then(() => { c.textContent = t('copied'); setTimeout(() => { c.textContent = t('copy'); }, 1200); }).catch(() => {}); return; }
  const a = e.target.closest('a[data-link]');
  if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) { e.preventDefault(); go(a.getAttribute('href')); }
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-search], #top-search'); if (!f) return;
  e.preventDefault(); const v = f.q.value.trim(); if (v) { f.q.blur(); go(`/search?q=${encodeURIComponent(v)}`); }
});
document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('lang');
  sel.addEventListener('change', () => {
    lang = normLang(sel.value) || 'ja'; try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
    try { const u = new URL(location.href); if (u.searchParams.has('lang')) { u.searchParams.set('lang', lang); history.replaceState(null, '', u); } } catch { /* ignore */ }
    applyLang(); route();
  });
  // Another tab changed the language.
  window.addEventListener('storage', (e) => { if (e.key === LANG_KEY) { const v = normLang(e.newValue); if (v && v !== lang) { lang = v; applyLang(); route(); } } });
  applyLang(); route();
});
window.addEventListener('popstate', route);
