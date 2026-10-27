import { i18n, LOCALES, NATIVE_NAMES } from './i18n.mjs';
import { discoverWallets, validAccount } from './wallet-core.mjs';

const $ = (id) => document.getElementById(id);
const CHAIN = 29129;
const CHAIN_HEX = '0x71c9';
const UNIT = 10n ** 18n;
const copy = {
  ja: {
    'nav.console':'ネットワークコンソール','nav.swap':'スワップ実験室','network.tag':'隔離実験 / チェーン29129',
    'hero.eyebrow':'ZERONYTH L1 / 開発用サンドボックス','hero.title':'スワップ実験室','hero.lead':'交換と流動性提供のための、無価値なトークンだけを使う隔離環境。',
    'boundary.label':'取引の範囲','boundary.text':'テストネット上の取引のみ。金銭的価値はありません。未監査です。本番利用の安全性は保証しません。',
    'wallet.title':'ウォレットとネットワーク','wallet.connect':'ウォレット接続','wallet.account.label':'接続中のアカウント',
    'wallet.network.label':'検出したネットワーク','wallet.network.unknown':'未検出','wallet.provider':'ウォレット','wallet.provider.empty':'ウォレット未検出',
    'wallet.warning.title':'未接続','wallet.warning.text':'まずChain ID 29129のウォレットを接続してください。Chain ID 9127とは別の実験環境です。',
    'wallet.wrong.title':'ネットワークが違います','wallet.wrong.text':'Chain ID 29129へ切り替えてから続けてください。','wallet.switch':'Chain 29129を追加・切替',
    'trade.title':'トークンスワップ','trade.intro':'許可または取引を行う前に、プールと見積りを確認してください。',
    'trade.from':'支払う','trade.to':'受け取る','trade.quote.waiting':'プール情報を取得中です。見積りはまだありません。',
    'trade.quote.empty':'このペアの見積りはありません。','trade.quote.error':'見積りを取得できませんでした。',
    'trade.review.title':'署名前に確認','trade.reserve':'プール残高','trade.price':'参考価格','trade.minout':'最低受取額',
    'trade.slippage':'スリッページ許容度','trade.review.note':'見積り、残高、価格、最低受取額はチェーンから取得します。',
    'trade.approve':'選択中トークンを許可','trade.execute':'スワップ内容を確認',
    'pool.title':'プール状況','pool.loading':'プールを読込中','pool.empty':'まだ流動性プールがありません。',
    'pool.error':'プール情報を取得できません。','pool.note':'残高と価格は実験チェーンから読み取ります。',
    'claim.title':'テストトークンを取得','claim.intro':'テスト用トークンのみです。各アカウント1回まで取得できます。',
    'claim.a':'TestAを取得','claim.b':'TestBを取得','claim.waiting':'接続後に取得状況を表示します。',
    'liquidity.title':'プールへの参加','liquidity.intro':'追加・解除はウォレット取引です。正確な数量を確認してください。',
    'liquidity.add.title':'流動性を追加','liquidity.amount.a':'TestA数量','liquidity.amount.b':'TestB数量',
    'liquidity.add.action':'追加内容を確認','liquidity.remove.title':'流動性を解除',
    'liquidity.remove.amount':'LPトークン数量','liquidity.remove.note':'位置と受取額はプールから取得します。',
    'liquidity.remove.action':'解除内容を確認','liquidity.approve.a':'TestAを許可','liquidity.approve.b':'TestBを許可',
    'liquidity.approve.lp':'LPトークンを許可','status.title':'直近の操作','status.none':'このページで操作は行われていません。',
    'status.pending':'ウォレット確認またはブロック確定を待っています。','status.success':'チェーンで取引が確定しました。',
    'status.error':'操作できませんでした。ウォレットとネットワークを確認してください。',
    'value.unavailable':'取得できません','value.unknown':'未検出','language.label':'表示言語','language.aria':'表示言語',
    'wallet.provider.aria':'ウォレットの選択','review.title':'取引内容を確認','review.network':'ネットワーク',
    'review.contract':'コントラクト','review.amount':'数量','review.minimum':'最低受取額',
    'review.note':'ウォレットで詳細を確認してから承認してください。','review.cancel':'キャンセル','review.continue':'ウォレットで確認',
  },
  'zh-CN': {
    'nav.console':'网络控制台','nav.swap':'兑换实验室','network.tag':'隔离实验 / 链 29129',
    'hero.eyebrow':'ZERONYTH L1 / 开发沙盒','hero.title':'兑换实验室','hero.lead':'仅使用无价值测试代币进行兑换和流动性测试。',
    'boundary.label':'交易范围','boundary.text':'仅限测试网交易。无货币价值。未经审计，不适用于生产环境。',
    'wallet.title':'钱包与网络','wallet.connect':'连接钱包','wallet.account.label':'已连接账户','wallet.network.label':'当前网络',
    'wallet.network.unknown':'未检测到','wallet.provider':'钱包','wallet.provider.empty':'未检测到钱包',
    'wallet.warning.title':'尚未连接','wallet.warning.text':'请先连接 Chain ID 29129 钱包。本实验与 Chain ID 9127 分离。',
    'wallet.wrong.title':'网络错误','wallet.wrong.text':'请切换到 Chain ID 29129 后继续。','wallet.switch':'添加或切换到 29129',
    'trade.title':'代币兑换','trade.intro':'授权或提交交易前，请检查池状态和报价。',
    'trade.from':'支付','trade.to':'接收','trade.quote.waiting':'正在读取池数据，暂时没有报价。',
    'trade.quote.empty':'该交易对暂无报价。','trade.quote.error':'无法读取报价。',
    'trade.review.title':'签名前检查','trade.reserve':'池储备','trade.price':'参考价格','trade.minout':'最低接收量',
    'trade.slippage':'滑点容差','trade.review.note':'报价、储备、价格和最低接收量由链上数据读取。',
    'trade.approve':'授权所选代币','trade.execute':'检查兑换交易',
    'pool.title':'池状态','pool.loading':'正在读取池数据','pool.empty':'流动性池尚未创建。',
    'pool.error':'无法读取池数据。','pool.note':'储备和价格从实验链读取。',
    'claim.title':'领取测试代币','claim.intro':'仅测试代币，每个账户限领一次。','claim.a':'领取 TestA','claim.b':'领取 TestB',
    'claim.waiting':'连接后显示领取状态。','liquidity.title':'参与流动性池','liquidity.intro':'添加和移除都是钱包交易，请核对确切数量。',
    'liquidity.add.title':'添加流动性','liquidity.amount.a':'TestA 数量','liquidity.amount.b':'TestB 数量',
    'liquidity.add.action':'检查添加交易','liquidity.remove.title':'移除流动性','liquidity.remove.amount':'LP 代币数量',
    'liquidity.remove.note':'持仓和取回数量通过池数据读取。','liquidity.remove.action':'检查移除交易',
    'liquidity.approve.a':'授权 TestA','liquidity.approve.b':'授权 TestB','liquidity.approve.lp':'授权 LP 代币',
    'status.title':'最近操作','status.none':'尚未在此页面执行操作。','status.pending':'等待钱包确认或区块确认。',
    'status.success':'交易已在链上确认。','status.error':'操作失败，请检查钱包和网络。',
    'value.unavailable':'不可用','value.unknown':'未检测到','language.label':'语言','language.aria':'显示语言',
    'wallet.provider.aria':'选择钱包','review.title':'检查交易','review.network':'网络','review.contract':'合约',
    'review.amount':'数量','review.minimum':'最低接收量','review.note':'请先在钱包中核对交易详情。',
    'review.cancel':'取消','review.continue':'继续到钱包',
  },
  ko: {
    'nav.console':'네트워크 콘솔','nav.swap':'스왑 실험실','network.tag':'격리 실험 / 체인 29129',
    'hero.eyebrow':'ZERONYTH L1 / 개발 샌드박스','hero.title':'스왑 실험실','hero.lead':'가치 없는 테스트 토큰만 사용하는 격리된 교환 및 유동성 실험입니다.',
    'boundary.label':'거래 범위','boundary.text':'테스트넷 거래만 가능합니다. 금전적 가치가 없으며 감사되지 않았습니다. 운영 환경용이 아닙니다.',
    'wallet.title':'지갑 및 네트워크','wallet.connect':'지갑 연결','wallet.account.label':'연결된 계정','wallet.network.label':'감지된 네트워크',
    'wallet.network.unknown':'감지되지 않음','wallet.provider':'지갑','wallet.provider.empty':'지갑을 찾을 수 없음',
    'wallet.warning.title':'연결되지 않음','wallet.warning.text':'Chain ID 29129 지갑을 연결하세요. Chain ID 9127과는 별개의 실험입니다.',
    'wallet.wrong.title':'잘못된 네트워크','wallet.wrong.text':'계속하려면 Chain ID 29129로 전환하세요.','wallet.switch':'Chain 29129 추가 또는 전환',
    'trade.title':'토큰 스왑','trade.intro':'승인 또는 거래 전에 풀과 견적을 확인하세요.',
    'trade.from':'지불','trade.to':'수령','trade.quote.waiting':'풀 데이터를 확인하는 중입니다. 견적을 사용할 수 없습니다.',
    'trade.quote.empty':'이 페어의 견적이 없습니다.','trade.quote.error':'견적을 불러오지 못했습니다.',
    'trade.review.title':'서명 전 검토','trade.reserve':'풀 준비금','trade.price':'참고 가격','trade.minout':'최소 수령량',
    'trade.slippage':'슬리피지 허용치','trade.review.note':'견적, 준비금, 가격 및 최소 수령량은 체인에서 읽습니다.',
    'trade.approve':'선택한 토큰 승인','trade.execute':'스왑 거래 검토',
    'pool.title':'풀 상태','pool.loading':'풀 데이터를 불러오는 중','pool.empty':'아직 유동성 풀이 없습니다.',
    'pool.error':'풀 데이터를 불러오지 못했습니다.','pool.note':'준비금과 가격을 실험 체인에서 읽습니다.',
    'claim.title':'테스트 토큰 받기','claim.intro':'테스트 토큰 전용입니다. 계정당 한 번만 받을 수 있습니다.',
    'claim.a':'TestA 받기','claim.b':'TestB 받기','claim.waiting':'지갑 연결 후 수령 상태가 표시됩니다.',
    'liquidity.title':'풀 참여','liquidity.intro':'추가와 제거는 지갑 거래입니다. 정확한 수량을 확인하세요.',
    'liquidity.add.title':'유동성 추가','liquidity.amount.a':'TestA 수량','liquidity.amount.b':'TestB 수량',
    'liquidity.add.action':'추가 거래 검토','liquidity.remove.title':'유동성 제거','liquidity.remove.amount':'LP 토큰 수량',
    'liquidity.remove.note':'포지션과 수령액은 풀에서 확인합니다.','liquidity.remove.action':'제거 거래 검토',
    'liquidity.approve.a':'TestA 승인','liquidity.approve.b':'TestB 승인','liquidity.approve.lp':'LP 토큰 승인',
    'status.title':'최근 작업','status.none':'이 페이지에서 작업을 시작하지 않았습니다.','status.pending':'지갑 또는 블록 확인을 기다립니다.',
    'status.success':'거래가 체인에서 확인되었습니다.','status.error':'작업에 실패했습니다. 지갑과 네트워크를 확인하세요.',
    'value.unavailable':'사용할 수 없음','value.unknown':'감지되지 않음','language.label':'언어','language.aria':'표시 언어',
    'wallet.provider.aria':'지갑 선택','review.title':'거래 검토','review.network':'네트워크','review.contract':'컨트랙트',
    'review.amount':'수량','review.minimum':'최소 수령량','review.note':'지갑에서 세부 정보를 확인한 후 승인하세요.',
    'review.cancel':'취소','review.continue':'지갑에서 확인',
  },
};

const text = (key) => copy[i18n.locale]?.[key] || key.replaceAll('.', ' ');
const set = (node, value) => { if (node) node.textContent = value; };
function localize() {
  document.documentElement.lang = i18n.locale;
  document.title = `ZERONYTH | ${text('hero.title')}`;
  for (const el of document.querySelectorAll('[data-swap-key]')) {
    const key = el.dataset.swapKey;
    for (const pair of (el.dataset.swapAttr || '').split(';').filter(Boolean)) {
      const [attr, attrKey] = pair.split(':').map((part) => part.trim());
      if (attr && attrKey) el.setAttribute(attr, text(attrKey));
    }
    if (!el.dataset.swapAttr || !el.matches('input, textarea, select')) set(el, text(key));
  }
  const language = $('languageSelect');
  if (language) language.value = i18n.locale;
}

const language = $('languageSelect');
for (const locale of LOCALES) {
  const option = document.createElement('option');
  option.value = locale;
  option.textContent = NATIVE_NAMES[locale];
  option.lang = locale;
  language.appendChild(option);
}
language.addEventListener('change', () => i18n.setLocale(language.value));
i18n.subscribe(localize);
localize();

const providerSelect = $('swap-lab-wallet-provider');
const discovered = discoverWallets(window, (items) => {
  providers = items;
  renderProviders();
});
let providers = discovered.entries;
let provider = null;
let account = null;
let chainId = null;
let deployment = null;
let pairToken0 = null;
let reserves = null;
let pending = null;
let quoteSequence = 0;
let busy = false;

const buttonIds = [
  'swap-lab-switch-network', 'swap-lab-approve', 'swap-lab-execute',
  'swap-lab-claim-a', 'swap-lab-claim-b', 'swap-lab-add', 'swap-lab-remove',
  'swap-lab-approve-a', 'swap-lab-approve-b', 'swap-lab-approve-lp',
];
function renderProviders() {
  const selected = providerSelect.value;
  providerSelect.replaceChildren();
  if (!providers.length) {
    providerSelect.add(new Option(text('wallet.provider.empty'), ''));
  } else {
    for (const item of providers) providerSelect.add(new Option(item.name, item.id));
  }
  if (providers.some((item) => item.id === selected)) providerSelect.value = selected;
  else if (providers.length === 1) providerSelect.value = providers[0].id;
  $('swap-lab-connect').disabled = !providers.length || busy;
}
renderProviders();

function renderButtons() {
  const enabled = Boolean(provider && account && chainId === CHAIN_HEX && deployment && !busy);
  for (const id of buttonIds) if ($(id)) $(id).disabled = !enabled;
  $('swap-lab-connect').disabled = busy || !providers.length;
}
function status(key, detail = '') {
  const root = $('swap-lab-status');
  root.replaceChildren();
  const label = document.createElement('span');
  label.className = 'swap-status-time';
  label.textContent = key === 'status.success' ? 'CONFIRMED' : key === 'status.pending' ? 'PENDING' : 'LOCAL STATUS';
  const message = document.createElement('p');
  message.textContent = detail || text(key);
  root.append(label, message);
}
function localError(error) {
  const message = String(error?.message || error || '').slice(0, 240);
  status('status.error', message || text('status.error'));
}
function word(value) {
  const hex = BigInt(value).toString(16);
  if (hex.length > 64 || BigInt(value) < 0n) throw Error('Invalid ABI integer');
  return hex.padStart(64, '0');
}
function addressWord(value) {
  if (!validAccount(value)) throw Error('Invalid contract address');
  return value.slice(2).toLowerCase().padStart(64, '0');
}
function calldata(contract, signature, args = []) {
  const selector = deployment?.methods?.[contract]?.[signature];
  if (!/^[\da-f]{8}$/i.test(selector || '')) throw Error('Contract method unavailable');
  return `0x${selector}${args.map((arg) => typeof arg === 'string' && arg.startsWith('0x') && arg.length === 42
    ? addressWord(arg) : word(arg)).join('')}`;
}
function decodeWords(data) {
  if (typeof data !== 'string' || !/^0x(?:[\da-f]{64})+$/i.test(data)) throw Error('Invalid contract response');
  const body = data.slice(2);
  const result = [];
  for (let offset = 0; offset < body.length; offset += 64) result.push(BigInt(`0x${body.slice(offset, offset + 64)}`));
  return result;
}
function decodeAddress(data) { return `0x${data.slice(-40)}`.toLowerCase(); }
function parseAmount(value) {
  const input = String(value).trim();
  if (!/^(?:0|[1-9]\d{0,35})(?:\.\d{0,18})?$/.test(input)) throw Error('Enter a valid amount with up to 18 decimal places.');
  const [whole, fraction = ''] = input.split('.');
  return BigInt(whole) * UNIT + BigInt(fraction.padEnd(18, '0') || '0');
}
function formatAmount(value, maxDecimals = 6) {
  const number = BigInt(value);
  const fraction = (number % UNIT).toString().padStart(18, '0').slice(0, maxDecimals).replace(/0+$/, '');
  return `${number / UNIT}${fraction ? `.${fraction}` : ''}`;
}
function displayAmount(value) { return formatAmount(value, 5); }

async function call(address, data, from = account) {
  const tx = { to: address, data };
  if (from) tx.from = from;
  return provider.request({ method: 'eth_call', params: [tx, 'latest'] });
}
async function readNumber(address, methodName, signature, args = []) {
  const result = await call(address, calldata(methodName, signature, args));
  return decodeWords(result)[0];
}

async function loadDeployment() {
  const response = await fetch('/api/faucet/health?network=swap-lab', {
    credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw Error(`Swap-lab not ready (HTTP ${response.status})`);
  const health = await response.json();
  const config = health.deployment;
  if (!health.ready || health.chainId !== CHAIN ||
      config?.chainId !== CHAIN || !validAccount(config.pair) || !validAccount(config.router) ||
      !Array.isArray(config.tokens) || config.tokens.length !== 2 ||
      config.tokens.some((item) => !validAccount(item.address) || item.decimals !== 18)) {
    throw Error('Swap-lab deployment data failed validation.');
  }
  deployment = config;
  const actualChain = await rawRpc('eth_chainId');
  if (actualChain !== CHAIN_HEX) throw Error('The swap-lab RPC returned the wrong Chain ID.');
  for (const address of [config.pair, config.router, ...config.tokens.map((token) => token.address)]) {
    const code = await rawRpc('eth_getCode', [address, 'latest']);
    if (!code || code === '0x') throw Error('A verified swap-lab contract has no deployed code.');
  }
  const [token0, pairAddress, routerAddress, routerA, routerB] = await Promise.all([
    call(config.pair, calldata('SwapLabPair', 'token0()')).then(decodeAddress),
    call(config.router, calldata('SwapLabRouter', 'pair()')).then(decodeAddress),
    call(config.pair, calldata('SwapLabPair', 'router()')).then(decodeAddress),
    call(config.router, calldata('SwapLabRouter', 'tokenA()')).then(decodeAddress),
    call(config.router, calldata('SwapLabRouter', 'tokenB()')).then(decodeAddress),
  ]);
  const expected = config.tokens.map((token) => token.address.toLowerCase());
  if (pairAddress !== config.pair.toLowerCase() || routerAddress !== config.router.toLowerCase() ||
      [routerA, routerB].some((address) => !expected.includes(address)) ||
      !expected.includes(token0)) throw Error('Swap-lab contract linkage does not match its deployment record.');
  pairToken0 = token0;
  await refreshState();
  $('swap-lab-pool').dataset.swapState = '';
  renderButtons();
}

async function rawRpc(method, params = []) {
  const response = await fetch('/rpc?network=swap-lab', {
    method: 'POST', credentials: 'omit', redirect: 'error',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw Error(`Swap-lab RPC HTTP ${response.status}`);
  const result = await response.json();
  if (result.error || result.result === undefined) throw Error(result.error?.message || 'Swap-lab RPC failed');
  return result.result;
}

function reservesForA() {
  if (!reserves || !pairToken0 || !deployment) return null;
  const a = deployment.tokens[0].address.toLowerCase();
  return pairToken0 === a ? [reserves[0], reserves[1]] : [reserves[1], reserves[0]];
}

async function refreshState() {
  if (!deployment) return;
  const [reserveData, totalSupply] = await Promise.all([
    call(deployment.pair, calldata('SwapLabPair', 'getReserves()')).then(decodeWords),
    readNumber(deployment.pair, 'SwapLabPair', 'totalSupply()'),
  ]);
  reserves = [reserveData[0], reserveData[1]];
  const [reserveA, reserveB] = reservesForA();
  set($('swap-lab-pool'), totalSupply > 0n ? `ZLP supply ${displayAmount(totalSupply)}` : text('pool.empty'));
  set($('swap-lab-reserve-a'), displayAmount(reserveA));
  set($('swap-lab-reserve-b'), displayAmount(reserveB));
  set($('swap-lab-reserves'), `${displayAmount(reserveA)} TestA / ${displayAmount(reserveB)} TestB`);
  await refreshWalletDetails();
  await updateQuote();
}

async function refreshWalletDetails() {
  if (!deployment || !account || chainId !== CHAIN_HEX) return;
  const [claimedA, claimedB, balanceA, balanceB, lp] = await Promise.all([
    readNumber(deployment.tokens[0].address, 'SwapTestToken', 'claimed(address)', [account]),
    readNumber(deployment.tokens[1].address, 'SwapTestToken', 'claimed(address)', [account]),
    readNumber(deployment.tokens[0].address, 'SwapTestToken', 'balanceOf(address)', [account]),
    readNumber(deployment.tokens[1].address, 'SwapTestToken', 'balanceOf(address)', [account]),
    readNumber(deployment.pair, 'SwapLabPair', 'balanceOf(address)', [account]),
  ]);
  const claimA = $('swap-lab-claim-a'), claimB = $('swap-lab-claim-b');
  claimA.disabled = Boolean(claimedA) || busy;
  claimB.disabled = Boolean(claimedB) || busy;
  claimA.textContent = `${text('claim.a')} · ${displayAmount(balanceA)}`;
  claimB.textContent = `${text('claim.b')} · ${displayAmount(balanceB)}`;
  $('swap-lab-remove-amount').setAttribute('placeholder', displayAmount(lp));
  $('swap-lab-claim-state').textContent = `${text('token.testa')}: ${displayAmount(balanceA)} · ${text('token.testb')}: ${displayAmount(balanceB)} · ZLP: ${displayAmount(lp)}`;
  renderButtons();
}

async function updateQuote() {
  const seq = ++quoteSequence;
  if (!deployment || !reserves) return;
  const input = $('swap-lab-amount-in').value.trim();
  if (!input) {
    set($('swap-lab-quote'), '');
    set($('swap-lab-quote').closest('.swap-pair')?.querySelector('.swap-quote-state span:last-child'), text('trade.quote.waiting'));
    return;
  }
  try {
    const amount = parseAmount(input);
    const inputIsA = $('swap-lab-token-in').value === 'TestA';
    const [reserveA, reserveB] = reservesForA();
    const reserveIn = inputIsA ? reserveA : reserveB;
    const reserveOut = inputIsA ? reserveB : reserveA;
    if (reserveIn === 0n || reserveOut === 0n) throw Error('empty-pool');
    const tokenIn = deployment.tokens[inputIsA ? 0 : 1].address;
    const encoded = calldata('SwapLabRouter', 'getAmountOut(uint256,uint256,uint256)', [amount, reserveIn, reserveOut]);
    const quote = decodeWords(await call(deployment.router, encoded))[0];
    if (seq !== quoteSequence) return;
    const minOut = quote * 9950n / 10000n;
    set($('swap-lab-quote'), displayAmount(quote));
    $('swap-lab-min-out').value = displayAmount(minOut);
    set($('swap-lab-price'), `1 ${inputIsA ? 'TestA' : 'TestB'} ≈ ${displayAmount(quote * UNIT / amount)} ${inputIsA ? 'TestB' : 'TestA'}`);
    set($('swap-lab-slippage-label'), '0.50%');
    const message = $('swap-lab-quote').closest('.swap-trade').querySelector('.swap-quote-state span:last-child');
    set(message, `${text('trade.minout')}: ${displayAmount(minOut)} ${inputIsA ? 'TestB' : 'TestA'} · 0.30% pool fee`);
    const outputSelector = $('swap-lab-token-out');
    outputSelector.value = inputIsA ? 'TestB' : 'TestA';
    void tokenIn;
  } catch (error) {
    if (seq !== quoteSequence) return;
    set($('swap-lab-quote'), '');
    const message = $('swap-lab-quote').closest('.swap-trade').querySelector('.swap-quote-state span:last-child');
    set(message, error.message === 'empty-pool' ? text('trade.quote.empty') : text('trade.quote.error'));
  }
}

function deadline() { return BigInt(Math.floor(Date.now() / 1000) + 600); }

function review({ summary, to, data, amount = '', minimum = '', after }) {
  if (!provider || !account || chainId !== CHAIN_HEX) throw Error('Connect the wallet to Chain ID 29129 first.');
  pending = { to, data, after };
  set($('swap-lab-review-summary'), summary);
  set($('swap-lab-review-contract'), `${to.slice(0, 8)}…${to.slice(-6)}`);
  set($('swap-lab-review-amount'), amount || '—');
  set($('swap-lab-review-minimum'), minimum || '—');
  $('swap-lab-review').showModal();
}

async function submitTransaction() {
  if (busy || !pending || !provider || !account || chainId !== CHAIN_HEX) return;
  const action = pending;
  pending = null;
  $('swap-lab-review').close();
  busy = true; renderButtons(); status('status.pending');
  try {
    const data = action.data;
    const estimate = BigInt(await provider.request({
      method: 'eth_estimateGas', params: [{ from: account, to: action.to, data, value: '0x0' }],
    }));
    const hash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ from: account, to: action.to, data, value: '0x0', gas: `0x${(estimate * 120n / 100n).toString(16)}` }],
    });
    if (!/^0x[\da-f]{64}$/i.test(hash)) throw Error('Wallet returned an invalid transaction hash.');
    status('status.pending', `${text('status.pending')} ${hash.slice(0, 14)}…`);
    let receipt;
    for (let i = 0; i < 120; i++) {
      receipt = await provider.request({ method: 'eth_getTransactionReceipt', params: [hash] });
      if (receipt) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!receipt) throw Error('Confirmation timed out; the transaction may still be pending. Refresh before retrying.');
    if (receipt.status !== '0x1') throw Error('Transaction reverted. Check balances, allowances and minimum output.');
    status('status.success', `${text('status.success')} ${hash.slice(0, 14)}…`);
    await refreshState();
    await action.after?.();
  } catch (error) {
    localError(error);
  } finally {
    busy = false; renderButtons();
  }
}

async function ensureReady() {
  if (!provider || !account) throw Error('Connect a wallet first.');
  chainId = await provider.request({ method: 'eth_chainId' });
  if (chainId !== CHAIN_HEX) throw Error('Switch the wallet to Chain ID 29129.');
  if (!deployment) throw Error('The isolated swap-lab is not ready yet.');
}

async function approveToken(symbol, value, label) {
  await ensureReady();
  if (value <= 0n) throw Error('Enter a positive amount before approval.');
  const token = deployment.tokens[symbol === 'TestA' ? 0 : 1].address;
  review({
    summary: `${text('trade.approve')}: ${label} ${displayAmount(value)} ${symbol}`,
    to: token,
    data: calldata('SwapTestToken', 'approve(address,uint256)', [deployment.router, value]),
    amount: `${displayAmount(value)} ${symbol}`,
  });
}

async function claim(symbol) {
  await ensureReady();
  const token = deployment.tokens[symbol === 'TestA' ? 0 : 1].address;
  const claimed = await readNumber(token, 'SwapTestToken', 'claimed(address)', [account]);
  if (claimed) throw Error('This account already claimed this test token.');
  review({
    summary: `${text(`claim.${symbol === 'TestA' ? 'a' : 'b'}`)} — 10,000 ${symbol}`,
    to: token, data: calldata('SwapTestToken', 'claim()'), amount: `10,000 ${symbol}`,
  });
}

function amountsForA(amountIn, amountOut) {
  return [amountIn, amountOut];
}

async function addLiquidity() {
  await ensureReady();
  const amountA = parseAmount($('swap-lab-add-a').value);
  const amountB = parseAmount($('swap-lab-add-b').value);
  if (!amountA || !amountB) throw Error('Enter both positive token amounts.');
  const deadlineAt = deadline();
  const reservesAB = reservesForA();
  let usedA = amountA, usedB = amountB, minLiquidity = 1n;
  const totalSupply = await readNumber(deployment.pair, 'SwapLabPair', 'totalSupply()');
  if (totalSupply > 0n) {
    const [reserveA, reserveB] = reservesAB;
    if (amountA * reserveB > amountB * reserveA) usedA = amountB * reserveA / reserveB;
    else usedB = amountA * reserveB / reserveA;
    const liqA = usedA * totalSupply / reserveA;
    const liqB = usedB * totalSupply / reserveB;
    const expected = liqA < liqB ? liqA : liqB;
    if (!expected) throw Error('The resulting LP position would be zero.');
    minLiquidity = expected * 9950n / 10000n || 1n;
  } else {
    let root = 0n, x = amountA * amountB;
    for (let y = x / 2n + 1n; y < root || root === 0n; y = (x / y + y) / 2n) {
      root = y;
    }
    if (root <= 1000n) throw Error('Initial amounts are too small to create a pool.');
    minLiquidity = (root - 1000n) * 9950n / 10000n || 1n;
  }
  const data = calldata('SwapLabRouter', 'addLiquidity(uint256,uint256,uint256,uint256)',
    [amountA, amountB, minLiquidity, deadlineAt]);
  const simulation = decodeWords(await call(deployment.router, data));
  const [, usedAResult, usedBResult] = simulation;
  review({
    summary: `${text('liquidity.add.title')}: ${displayAmount(usedAResult)} TestA / ${displayAmount(usedBResult)} TestB`,
    to: deployment.router, data,
    amount: `${displayAmount(usedAResult)} TestA / ${displayAmount(usedBResult)} TestB`,
    minimum: `≥ ${displayAmount(minLiquidity)} ZLP`,
  });
}

async function removeLiquidity() {
  await ensureReady();
  const lp = parseAmount($('swap-lab-remove-amount').value);
  if (lp <= 0n) throw Error('Enter a positive LP token amount.');
  const [reserveA, reserveB] = reservesForA();
  const supply = await readNumber(deployment.pair, 'SwapLabPair', 'totalSupply()');
  if (lp > await readNumber(deployment.pair, 'SwapLabPair', 'balanceOf(address)', [account])) {
    throw Error('The LP amount exceeds your wallet balance.');
  }
  const minA = lp * reserveA / supply * 9950n / 10000n;
  const minB = lp * reserveB / supply * 9950n / 10000n;
  const data = calldata('SwapLabRouter', 'removeLiquidity(uint256,uint256,uint256,uint256)', [lp, minA, minB, deadline()]);
  const simulated = decodeWords(await call(deployment.router, data));
  review({
    summary: `${text('liquidity.remove.title')}: ${displayAmount(lp)} ZLP`,
    to: deployment.router, data,
    amount: `${displayAmount(lp)} ZLP`,
    minimum: `${displayAmount(simulated[0])} TestA / ${displayAmount(simulated[1])} TestB`,
  });
}

$('swap-lab-connect').addEventListener('click', async () => {
  const entry = providers.find((item) => item.id === providerSelect.value);
  if (!entry) return status('status.error', text('wallet.provider.empty'));
  try {
    provider = entry.provider;
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (!Array.isArray(accounts) || !validAccount(accounts[0])) throw Error('Wallet returned no valid account.');
    account = accounts[0];
    chainId = await provider.request({ method: 'eth_chainId' });
    $('swap-lab-account').textContent = `${account.slice(0, 8)}…${account.slice(-6)}`;
    $('swap-lab-network-current').textContent = chainId === CHAIN_HEX ? 'ZERONYTH Swap Lab · 29129' : `Chain ID ${BigInt(chainId).toString()}`;
    $('swap-lab-chain-warning').classList.toggle('is-wrong-network', chainId !== CHAIN_HEX);
    if (chainId !== CHAIN_HEX) set($('swap-lab-chain-warning'), text('wallet.wrong.text'));
    else await refreshState();
    provider.on?.('accountsChanged', (items) => {
      account = Array.isArray(items) && validAccount(items[0]) ? items[0] : null;
      $('swap-lab-account').textContent = account ? `${account.slice(0, 8)}…${account.slice(-6)}` : text('wallet.warning.title');
      void refreshWalletDetails().catch(localError);
    });
    provider.on?.('chainChanged', (next) => {
      chainId = next;
      $('swap-lab-network-current').textContent = next === CHAIN_HEX ? 'ZERONYTH Swap Lab · 29129' : `Chain ID ${BigInt(next).toString()}`;
      $('swap-lab-chain-warning').classList.toggle('is-wrong-network', next !== CHAIN_HEX);
      renderButtons();
      if (next === CHAIN_HEX) void refreshState().catch(localError);
    });
    renderButtons();
    status('status.success', text('wallet.connect'));
  } catch (error) { localError(error); }
});

$('swap-lab-switch-network').addEventListener('click', async () => {
  if (!provider) return localError(Error('Connect a wallet first.'));
  const rpc = new URL('/rpc?network=swap-lab', window.location.origin).href;
  try {
    await provider.request({ method: 'wallet_addEthereumChain', params: [{
      chainId: CHAIN_HEX, chainName: 'ZERONYTH Swap Lab (no-value sandbox)',
      nativeCurrency: { name: 'Zero-fee test unit', symbol: 'zETH', decimals: 18 },
      rpcUrls: [rpc],
    }] });
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
  } catch (error) { localError(error); }
});

$('swap-lab-approve').addEventListener('click', () => {
  const symbol = $('swap-lab-token-in').value;
  try { void approveToken(symbol, parseAmount($('swap-lab-amount-in').value), symbol); } catch (error) { localError(error); }
});
$('swap-lab-claim-a').addEventListener('click', () => void claim('TestA').catch(localError));
$('swap-lab-claim-b').addEventListener('click', () => void claim('TestB').catch(localError));
$('swap-lab-approve-a').addEventListener('click', () => {
  try { void approveToken('TestA', parseAmount($('swap-lab-add-a').value), 'pool'); } catch (error) { localError(error); }
});
$('swap-lab-approve-b').addEventListener('click', () => {
  try { void approveToken('TestB', parseAmount($('swap-lab-add-b').value), 'pool'); } catch (error) { localError(error); }
});
$('swap-lab-approve-lp').addEventListener('click', () => {
  try { void approveToken('TestA', parseAmount($('swap-lab-remove-amount').value), 'LP'); } catch (error) { localError(error); }
});
$('swap-lab-add').addEventListener('click', () => void addLiquidity().catch(localError));
$('swap-lab-remove').addEventListener('click', () => void removeLiquidity().catch(localError));
$('swap-lab-execute').addEventListener('click', async () => {
  try {
    await ensureReady();
    const amount = parseAmount($('swap-lab-amount-in').value);
    const minimum = parseAmount($('swap-lab-min-out').value);
    const inputIsA = $('swap-lab-token-in').value === 'TestA';
    const token = deployment.tokens[inputIsA ? 0 : 1];
    const outputToken = deployment.tokens[inputIsA ? 1 : 0];
    const [reserveA, reserveB] = reservesForA();
    const quote = decodeWords(await call(deployment.router,
      calldata('SwapLabRouter', 'getAmountOut(uint256,uint256,uint256)',
        [amount, inputIsA ? reserveA : reserveB, inputIsA ? reserveB : reserveA])))[0];
    if (minimum <= 0n || minimum > quote) throw Error('Minimum output must be positive and no greater than the latest quote.');
    const data = calldata('SwapLabRouter', 'swapExactInput(address,uint256,uint256,address,uint256)',
      [token.address, amount, minimum, account, deadline()]);
    review({
      summary: `${displayAmount(amount)} ${token.symbol} → ${displayAmount(quote)} ${outputToken.symbol}`,
      to: deployment.router, data,
      amount: `${displayAmount(amount)} ${token.symbol}`,
      minimum: `${displayAmount(minimum)} ${outputToken.symbol}`,
    });
  } catch (error) { localError(error); }
});
$('swap-lab-review-confirm').addEventListener('click', () => void submitTransaction());
$('swap-lab-review-cancel').addEventListener('click', () => {
  pending = null; $('swap-lab-review').close();
});
$('swap-lab-token-in').addEventListener('change', () => {
  const other = $('swap-lab-token-in').value === 'TestA' ? 'TestB' : 'TestA';
  $('swap-lab-token-out').value = other;
  void updateQuote();
});
$('swap-lab-token-out').addEventListener('change', () => {
  const other = $('swap-lab-token-out').value === 'TestA' ? 'TestB' : 'TestA';
  $('swap-lab-token-in').value = other;
  void updateQuote();
});
$('swap-lab-amount-in').addEventListener('input', () => void updateQuote());
$('swap-lab-min-out').addEventListener('input', () => {
  const quote = $('swap-lab-quote').value;
  if (!quote) return set($('swap-lab-slippage-label'), '—');
  try {
    const q = parseAmount(quote), m = parseAmount($('swap-lab-min-out').value);
    if (m < 0n || m > q) throw Error();
    set($('swap-lab-slippage-label'), `${((q - m) * 10000n / q).toString()} bps`);
  } catch { set($('swap-lab-slippage-label'), text('value.unavailable')); }
});

window.addEventListener('focus', () => { if (deployment) void refreshState().catch(localError); });
void loadDeployment().catch((error) => {
  $('swap-lab-pool').dataset.swapState = 'error';
  set($('swap-lab-pool'), text('pool.error'));
  status('status.error', error.message);
});
