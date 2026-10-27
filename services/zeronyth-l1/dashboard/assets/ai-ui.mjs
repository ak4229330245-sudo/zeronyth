import { i18n, LOCALES, NATIVE_NAMES } from './i18n.mjs';
import { AI_PUBLIC_EVALUATION_PROMPTS } from './ai-public-prompts.mjs';

const $ = (id) => document.getElementById(id);
function aiUrl(route) {
  const base = new URL('./', window.location.href);
  const relative = route.replace(/^\/ai-lab\/?/, '');
  return new URL(`ai-lab/${relative}`, base);
}
const statusCopy = {
  en: {
    connecting: 'Checking the isolated AI lab…', online: 'Isolated AI lab is online.',
    offline: 'AI lab coordinator is unavailable.', loading: 'Downloading the public model…',
    loaded: 'Pinned public model is ready in this browser.', downloadConsent: 'Confirm model download consent first.',
    chooseModels: 'Select both public language models before starting the comparison.',
    evaluationConsent: 'Consent to public evaluation work first.',
    trainingConsent: 'Consent to training work first.', workerRunning: 'Worker joined. Waiting for an assigned task…',
    workerLeft: 'Worker participation stopped.', evaluationStarted: 'Public evaluation campaign started.',
    trainingStarted: 'Federated training round started. Two training workers are required.',
    noImprovement: 'No improved candidate was produced. The active model was not changed.',
    adopted: 'The better-scoring model was explicitly adopted in this memory-only registry.',
    confirmAdopt: 'Adopt this higher-scoring candidate? This changes only the temporary AI lab registry.',
    confirmEvaluation: 'Start a comparison using only the fixed public test set? Model outputs from opted-in browsers will be sent to this lab.',
    confirmTraining: 'Start the toy classifier round? Two opted-in browser workers will contribute gradients.',
    taskWait: 'No task is ready yet. This worker is waiting…',
    error: 'The action failed. Check the details and try again.',
    evalDone: 'Comparison complete. Scores are simple keyword checks, not a human quality review.',
    modelNeed: 'Download both pinned models with their consent boxes before joining evaluation.',
    roleExists: 'This browser already has a worker session. Leave it before changing roles.',
    scorePending: 'Waiting for two browser sessions per public test case.',
    downloadFailed: 'Model download or initialization failed. No model answer was fabricated.',
    gpuFallback: 'WebGPU initialization failed; retrying on CPU/WASM.',
  },
  ja: {
    connecting: '隔離AIラボを確認中…', online: '隔離AIラボに接続しました。',
    offline: 'AIラボの調整サーバーに接続できません。', loading: '公開モデルをダウンロード中…',
    loaded: '固定リビジョンの公開モデルをこのブラウザーで読み込みました。', downloadConsent: '先にモデルのダウンロードへ同意してください。',
    chooseModels: '比較を始める前に公開モデルを2つ選択してください。',
    evaluationConsent: '先に公開評価ワーカーへの参加に同意してください。',
    trainingConsent: '先に学習ワーカーへの参加に同意してください。', workerRunning: 'ワーカーとして参加しました。割当を待っています…',
    workerLeft: 'ワーカー参加を停止しました。', evaluationStarted: '公開評価を開始しました。',
    trainingStarted: '分散学習ラウンドを開始しました。2つの学習ワーカーが必要です。',
    noImprovement: '改善候補は得られませんでした。現在のモデルは変更していません。',
    adopted: '評価の高いモデルを一時レジストリへ明示的に採用しました。',
    confirmAdopt: '評価の高い候補を採用しますか？変更先は一時AIラボだけです。',
    confirmEvaluation: '固定の公開テストだけで比較を始めますか？参加ワーカーのモデル回答はこのラボに送信されます。',
    confirmTraining: '小型分類器の学習を始めますか？同意済みのブラウザワーカー2台が勾配を計算します。',
    taskWait: 'タスクを待っています…', error: '操作に失敗しました。詳細を確認してください。',
    evalDone: '比較が完了しました。スコアは単語一致の評価で、人による品質審査ではありません。',
    modelNeed: '評価へ参加する前に、同意欄を選択して2つのモデルをダウンロードしてください。',
    roleExists: 'このブラウザーはすでに参加しています。役割変更前に退出してください。',
    scorePending: '各公開テストについて、2つのブラウザー結果を待っています。',
    downloadFailed: 'モデルのダウンロードまたは読込に失敗しました。架空の回答は表示しません。',
    gpuFallback: 'WebGPUの初期化に失敗したため、CPU/WASMで再試行します。',
  },
  'zh-CN': {
    connecting: '正在检查隔离 AI 实验室…', online: '隔离 AI 实验室已连接。',
    offline: 'AI 协调服务当前不可用。', loading: '正在下载公开模型…',
    loaded: '已在此浏览器加载固定版本的公开模型。', downloadConsent: '请先同意下载模型。',
    chooseModels: '开始比较前，请选择两个公开模型。',
    evaluationConsent: '请先同意参与公开评估。', trainingConsent: '请先同意参与训练。',
    workerRunning: '工作节点已加入，等待任务…', workerLeft: '已停止工作节点参与。',
    evaluationStarted: '公开评估已启动。', trainingStarted: '联邦训练已启动，需要两个训练工作节点。',
    noImprovement: '没有产生改进候选，当前模型未更改。',
    adopted: '已将得分更高的模型明确加入临时注册表。',
    confirmAdopt: '要采用得分更高的候选模型吗？仅更改临时 AI 实验室注册表。',
    confirmEvaluation: '仅使用固定公开测试集开始比较吗？获同意的浏览器会将模型输出发送到本实验室。',
    confirmTraining: '开始玩具分类器训练吗？两个获同意的浏览器工作节点将提交梯度。',
    taskWait: '正在等待任务…', error: '操作失败，请查看详情。',
    evalDone: '比较完成。分数由简单关键词检查产生，并非人工质量评审。',
    modelNeed: '加入评估前，请同意并下载两个固定版本模型。',
    roleExists: '此浏览器已有工作节点会话。切换角色前请先退出。',
    scorePending: '每条公开测试正在等待两个浏览器会话的结果。',
    downloadFailed: '模型下载或初始化失败；没有伪造回答。',
    gpuFallback: 'WebGPU 初始化失败，正在尝试 CPU/WASM。',
  },
  ko: {
    connecting: '격리된 AI 실험실을 확인하는 중…', online: '격리된 AI 실험실에 연결되었습니다.',
    offline: 'AI 실험실 조정 서버를 사용할 수 없습니다.', loading: '공개 모델을 다운로드하는 중…',
    loaded: '고정 리비전의 공개 모델을 이 브라우저에서 준비했습니다.', downloadConsent: '먼저 모델 다운로드에 동의하세요.',
    chooseModels: '비교를 시작하기 전에 공개 모델 두 개를 선택하세요.',
    evaluationConsent: '먼저 공개 평가 작업에 동의하세요.', trainingConsent: '먼저 학습 작업에 동의하세요.',
    workerRunning: '작업자로 참여했습니다. 작업을 기다리는 중…', workerLeft: '작업자 참여를 중지했습니다.',
    evaluationStarted: '공개 평가를 시작했습니다.', trainingStarted: '분산 학습을 시작했습니다. 학습 작업자 두 명이 필요합니다.',
    noImprovement: '개선된 후보가 없어 활성 모델을 변경하지 않았습니다.',
    adopted: '더 높은 점수의 모델을 임시 레지스트리에 명시적으로 채택했습니다.',
    confirmAdopt: '점수가 더 높은 후보를 채택할까요? 임시 AI 실험실 레지스트리만 변경됩니다.',
    confirmEvaluation: '고정 공개 테스트 세트만 비교할까요? 동의한 브라우저의 모델 출력이 실험실로 전송됩니다.',
    confirmTraining: '장난감 분류기 학습을 시작할까요? 동의한 브라우저 작업자 두 명이 그래디언트를 계산합니다.',
    taskWait: '작업을 기다리는 중…', error: '작업에 실패했습니다. 세부 정보를 확인하세요.',
    evalDone: '비교가 끝났습니다. 점수는 간단한 키워드 검사이며 사람이 검토한 품질 점수가 아닙니다.',
    modelNeed: '평가에 참여하기 전에 동의한 뒤 고정 모델 두 개를 다운로드하세요.',
    roleExists: '이 브라우저에는 이미 작업자 세션이 있습니다. 역할 변경 전에 나가세요.',
    scorePending: '각 공개 테스트마다 두 브라우저 세션의 결과를 기다립니다.',
    downloadFailed: '모델 다운로드 또는 초기화에 실패했습니다. 가짜 답변은 만들지 않았습니다.',
    gpuFallback: 'WebGPU 초기화에 실패하여 CPU/WASM으로 다시 시도합니다.',
  },
};
const messages = (key) => statusCopy[i18n.locale]?.[key] || statusCopy.en[key] || key;
const pageCopy = {
  en: {
    title: 'Small models.\nClear boundaries.', status: 'Lab status', inference: 'Compare model responses',
    evalSet: 'Fixed public evaluation set', workers: 'Choose to contribute', training: 'Toy federated training',
    limits: 'Limits and safety', api: 'Active API contract', downloadA: 'Download model A',
    downloadB: 'Download model B', startEvaluation: 'Start fixed-set comparison',
    joinEvaluate: 'Join as evaluation worker', joinTrain: 'Join as training worker',
    leave: 'Stop participation and leave', startTraining: 'Start training round',
    adoptClassifier: 'Adopt improved classifier', adoptLanguage: 'Adopt improved language model',
    consentA: 'I consent to download model A from Hugging Face and load it for browser inference.',
    consentB: 'I consent to download model B from Hugging Face and load it for browser inference.',
    selectA: 'Select for comparison', selectB: 'Select for comparison',
    confirmSet: 'I confirm this public evaluation set may be run and, if I opt in, shared with remote evaluation workers.',
    consentEval: 'I agree to process only the published public prompts as an evaluation worker.',
    consentTrain: 'I agree to compute a gradient for the fixed public toy dataset as a training worker.',
    adoptConfirm: 'I reviewed the evaluation and confirm adopting only the higher-scoring model.',
    boundaryTitle: 'Not a Besu feature.',
    boundaryText: 'Validators do not train, evaluate, or approve models. This lab has no value and makes no chain, wallet, or production changes.',
    publicTitle: 'Fixed public evaluation set only.',
    publicText: 'Remote workers receive only the published test prompts shown below. Never submit private, personal, confidential, or sensitive information.',
    publicNote: 'The comparison uses only this pre-defined set. No free-form prompt field is available.',
    valueTitle: 'No value.', valueText: 'No payments, rewards, tokens, or wallet actions.',
    sybilTitle: 'Not Sybil resistant.', sybilText: 'Worker identity and participation do not establish uniqueness.',
    llmTitle: 'Not a trained LLM.', llmText: 'The training example is a toy logistic classifier, entirely separate from public ONNX inference.',
    chainTitle: 'No production or chain changes.', chainText: 'No Besu validator training, candidate approval, chain writes, or deployment changes.',
    consentTitle: 'Consent first.', consentText: 'Remote evaluation and training require separate explicit opt-in and a user click.',
  },
  ja: {
    title: '小さなモデル。\n明確な境界。', status: 'ラボの状態', inference: 'モデル回答を比較',
    evalSet: '固定された公開評価セット', workers: '参加方法を選ぶ', training: '小型分類器の分散学習',
    limits: '制限と安全性', api: '有効なAPI', downloadA: 'モデルAをダウンロード',
    downloadB: 'モデルBをダウンロード', startEvaluation: '固定セットの比較を開始',
    joinEvaluate: '評価ワーカーとして参加', joinTrain: '学習ワーカーとして参加',
    leave: '参加を停止して退出', startTraining: '学習ラウンドを開始',
    adoptClassifier: '改善した分類器を採用', adoptLanguage: '改善した言語モデルを採用',
    consentA: 'Hugging FaceからモデルAをダウンロードし、このブラウザーで推論することに同意します。',
    consentB: 'Hugging FaceからモデルBをダウンロードし、このブラウザーで推論することに同意します。',
    selectA: '比較対象にする', selectB: '比較対象にする',
    confirmSet: '公開評価セットのみを実行し、参加時はリモート評価ワーカーと共有することを確認します。',
    consentEval: '公開済みの評価プロンプトだけを処理する評価ワーカーとして参加します。',
    consentTrain: '公開済みの小型データセットだけを使い、学習ワーカーとして勾配を計算します。',
    adoptConfirm: '評価を確認し、スコアの高いモデルだけを採用することを確認します。',
    boundaryTitle: 'Besuの機能ではありません。',
    boundaryText: 'バリデーターはモデルを学習・評価・承認しません。このラボに価値はなく、チェーン、ウォレット、本番環境を変更しません。',
    publicTitle: '固定された公開評価セットのみ。',
    publicText: 'リモートワーカーに送られるのは下記の公開テストだけです。個人情報・機密情報・センシティブ情報を送信しないでください。',
    publicNote: '比較にはこの固定セットだけを使います。自由入力のプロンプト欄はありません。',
    valueTitle: '価値はありません。', valueText: '支払い、報酬、トークン、ウォレット操作はありません。',
    sybilTitle: 'Sybil耐性はありません。', sybilText: 'ワーカーIDや参加履歴は、別々の人や端末であることを証明しません。',
    llmTitle: 'LLMの学習ではありません。', llmText: '学習例は小型ロジスティック分類器で、公開ONNX推論とは完全に別です。',
    chainTitle: '本番・チェーンに変更はありません。', chainText: 'Besuバリデーターの学習、承認、書き込み、デプロイは行いません。',
    consentTitle: '同意が先です。', consentText: 'リモート評価・学習には、それぞれ明示的な参加同意とクリックが必要です。',
  },
  'zh-CN': {
    title: '小型模型。\n明确边界。', status: '实验室状态', inference: '比较模型回答',
    evalSet: '固定公开评估集', workers: '选择参与方式', training: '玩具分类器联邦训练',
    limits: '限制与安全', api: '已启用的 API', downloadA: '下载模型 A',
    downloadB: '下载模型 B', startEvaluation: '开始固定集比较',
    joinEvaluate: '作为评估工作节点加入', joinTrain: '作为训练工作节点加入',
    leave: '停止参与并退出', startTraining: '开始训练轮次',
    adoptClassifier: '采用改进的分类器', adoptLanguage: '采用得分更高的语言模型',
    consentA: '我同意从 Hugging Face 下载模型 A，并在此浏览器中运行推理。',
    consentB: '我同意从 Hugging Face 下载模型 B，并在此浏览器中运行推理。',
    selectA: '加入比较', selectB: '加入比较',
    confirmSet: '我确认仅运行此公开评估集，并在选择加入后与远程评估节点共享。',
    consentEval: '我同意仅处理已发布的公开评估提示。',
    consentTrain: '我同意仅使用固定公开玩具数据集计算梯度。',
    adoptConfirm: '我已查看评估结果，并确认仅采用得分更高的模型。',
    boundaryTitle: '这不是 Besu 的功能。',
    boundaryText: '验证节点不会训练、评估或批准模型。本实验室没有价值，不会更改链、钱包或生产环境。',
    publicTitle: '仅使用固定公开评估集。',
    publicText: '远程工作节点只会收到下方已发布的测试提示。请勿提交私人、个人、机密或敏感信息。',
    publicNote: '比较仅使用这个预定义集合，不提供自由输入提示。',
    valueTitle: '无价值。', valueText: '不涉及付款、奖励、代币或钱包操作。',
    sybilTitle: '不具备女巫攻击防护。', sybilText: '工作节点身份和参与记录不能证明参与者唯一。',
    llmTitle: '不是 LLM 训练。', llmText: '训练示例是玩具逻辑分类器，与公开 ONNX 推理完全分开。',
    chainTitle: '不更改生产环境或区块链。', chainText: '不训练 Besu 验证节点、不批准模型、不写入链，也不更改部署。',
    consentTitle: '先取得同意。', consentText: '远程评估和训练均须分别明确选择加入并点击确认。',
  },
  ko: {
    title: '작은 모델.\n명확한 경계.', status: '실험실 상태', inference: '모델 응답 비교',
    evalSet: '고정 공개 평가 세트', workers: '참여 방식 선택', training: '장난감 분류기 연합 학습',
    limits: '제한 및 안전', api: '활성 API', downloadA: '모델 A 다운로드',
    downloadB: '모델 B 다운로드', startEvaluation: '고정 세트 비교 시작',
    joinEvaluate: '평가 작업자로 참여', joinTrain: '학습 작업자로 참여',
    leave: '참여 중지 후 나가기', startTraining: '학습 라운드 시작',
    adoptClassifier: '개선된 분류기 채택', adoptLanguage: '점수가 더 높은 언어 모델 채택',
    consentA: 'Hugging Face에서 모델 A를 다운로드하고 이 브라우저에서 추론하는 데 동의합니다.',
    consentB: 'Hugging Face에서 모델 B를 다운로드하고 이 브라우저에서 추론하는 데 동의합니다.',
    selectA: '비교에 포함', selectB: '비교에 포함',
    confirmSet: '이 공개 평가 세트만 실행하고, 참여 시 원격 평가 작업자와 공유하는 데 동의합니다.',
    consentEval: '게시된 공개 평가 프롬프트만 처리하는 평가 작업자로 참여합니다.',
    consentTrain: '고정 공개 장난감 데이터만 사용해 그래디언트를 계산하는 데 동의합니다.',
    adoptConfirm: '평가를 확인했으며 점수가 더 높은 모델만 채택하는 데 동의합니다.',
    boundaryTitle: 'Besu 기능이 아닙니다.',
    boundaryText: '검증자는 모델을 학습·평가·승인하지 않습니다. 이 실험실에는 가치가 없으며 체인, 지갑, 운영 환경을 변경하지 않습니다.',
    publicTitle: '고정 공개 평가 세트만 사용합니다.',
    publicText: '원격 작업자는 아래에 공개된 테스트 프롬프트만 받습니다. 개인·기밀·민감한 정보를 보내지 마세요.',
    publicNote: '비교에는 미리 정한 세트만 사용하며 자유 입력 프롬프트는 없습니다.',
    valueTitle: '가치가 없습니다.', valueText: '결제, 보상, 토큰 또는 지갑 작업이 없습니다.',
    sybilTitle: '시빌 저항성이 없습니다.', sybilText: '작업자 ID와 참여 정보는 고유한 사람이나 장치임을 증명하지 않습니다.',
    llmTitle: 'LLM 학습이 아닙니다.', llmText: '학습 예시는 장난감 로지스틱 분류기이며 공개 ONNX 추론과 별개입니다.',
    chainTitle: '운영 환경이나 체인을 변경하지 않습니다.', chainText: 'Besu 검증자 학습, 모델 승인, 체인 기록 또는 배포 변경이 없습니다.',
    consentTitle: '먼저 동의하세요.', consentText: '원격 평가와 학습은 각각 명시적으로 참여를 선택하고 클릭해야 합니다.',
  },
};
const pageTargets = {
  '#statusTitle': 'status', '#inferenceTitle': 'inference',
  '#evalSetTitle': 'evalSet', '#workersTitle': 'workers', '#trainingTitle': 'training',
  '#limitsTitle': 'limits', '#apiTitle': 'api',
  '#downloadModelA': 'downloadA', '#downloadModelB': 'downloadB',
  '#startEvaluation': 'startEvaluation', '#joinEvaluateWorker': 'joinEvaluate',
  '#joinTrainWorker': 'joinTrain', '#leaveWorker': 'leave',
  '#startTrainingRound': 'startTraining', '#adoptCandidate': 'adoptClassifier',
  '#adoptLanguageCandidate': 'adoptLanguage',
  '#aiBoundaryTitle': 'boundaryTitle', '#aiBoundaryText': 'boundaryText',
  '#aiPublicSetTitle': 'publicTitle', '#aiPublicSetText': 'publicText',
  '#publicSetNote': 'publicNote',
  '#limitValueTitle': 'valueTitle', '#limitValueText': 'valueText',
  '#limitSybilTitle': 'sybilTitle', '#limitSybilText': 'sybilText',
  '#limitLlmTitle': 'llmTitle', '#limitLlmText': 'llmText',
  '#limitChainTitle': 'chainTitle', '#limitChainText': 'chainText',
  '#limitConsentTitle': 'consentTitle', '#limitConsentText': 'consentText',
};
const labelTargets = {
  modelAConsent: 'consentA', modelBConsent: 'consentB',
  modelASelect: 'selectA', modelBSelect: 'selectB',
  evaluationConfirm: 'confirmSet', evaluateConsent: 'consentEval',
  trainConsent: 'consentTrain', languageAdoptConfirmation: 'adoptConfirm',
};
function renderPageText() {
  const copy = pageCopy[i18n.locale] || pageCopy.en;
  const title = $('#aiTitle');
  if (title && copy.title) {
    const [firstLine, secondLine] = copy.title.split('\n');
    const accent = document.createElement('em');
    accent.textContent = secondLine || '';
    title.replaceChildren(document.createTextNode(firstLine), document.createElement('br'), accent);
  }
  for (const [selector, key] of Object.entries(pageTargets)) {
    const element = document.querySelector(selector);
    if (element && copy[key]) element.textContent = copy[key];
  }
  for (const [id, key] of Object.entries(labelTargets)) {
    const label = $(id)?.closest('label')?.querySelector('span');
    if (label && copy[key]) label.textContent = copy[key];
  }
}

const LANGUAGE_MODELS = [
  {
    id: 'smollm2-135m', repo: 'HuggingFaceTB/SmolLM2-135M-Instruct',
    revision: '12fd25f77366fa6b3b4b768ec3050bf629380bac',
  },
  {
    id: 'smollm2-360m', repo: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    revision: 'a10cc1512eabd3dde888204e902eca88bddb4951',
  },
];
const session = { workerId: null, token: null, role: null, loop: 0 };
const models = new Map();
const modelLoads = new Map();
let statusSnapshot = null;
let transformerModulePromise = null;
let statusBusy = false;

const setText = (id, value) => { if ($(id)) $(id).textContent = String(value); };
const setStatus = (message, isError = false) => {
  const node = $('comparisonStatus');
  if (node) {
    node.textContent = message;
    node.dataset.state = isError ? 'error' : 'info';
  }
};

function addLanguages() {
  const select = $('languageSelect');
  if (!select) return;
  select.replaceChildren();
  for (const locale of LOCALES) select.add(new Option(NATIVE_NAMES[locale], locale));
  select.value = i18n.locale;
  select.addEventListener('change', () => i18n.setLocale(select.value));
  i18n.subscribe(() => {
    document.documentElement.lang = i18n.locale;
    select.value = i18n.locale;
    renderPageText();
    if (statusSnapshot) renderStatus(statusSnapshot);
  });
  renderPageText();
}

function renderPublicEvaluationPrompts() {
  const list = $('publicPromptList');
  if (!list) return;
  list.replaceChildren(...AI_PUBLIC_EVALUATION_PROMPTS.map(({ prompt }, index) => {
    const item = document.createElement('li');
    const number = document.createElement('span');
    number.className = 'prompt-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const quote = document.createElement('q');
    quote.textContent = prompt;
    item.append(number, quote);
    return item;
  }));
}

function renderStatus(data) {
  statusSnapshot = data;
  const registry = data.modelRegistry;
  setText('modelRegistryReading', `${registry.activeLanguageModel} · ${registry.activeClassifier.id}`);
  setText('evaluationReading', `${data.evaluation.status} · ${data.evaluation.dataset.caseCount} public cases`);
  setText('trainingReading', `${data.training.status} · ${data.training.baseModel}`);
  setText('workersReading', `${data.workers.active} browser sessions · ${data.workers.evaluators} evaluation · ${data.workers.trainers} training`);
  const candidates = data.evaluation.candidates;
  const modelA = candidates.find((candidate) => candidate.modelId === LANGUAGE_MODELS[0].id);
  const modelB = candidates.find((candidate) => candidate.modelId === LANGUAGE_MODELS[1].id);
  setText('modelAResult', modelA?.score == null
    ? `${modelA?.cases?.filter((item) => item.complete).length || 0}/8 cases × 2 workers`
    : `${modelA.score}% · self-reported ${modelA.averageDurationMs} ms/answer`);
  setText('modelBResult', modelB?.score == null
    ? `${modelB?.cases?.filter((item) => item.complete).length || 0}/8 cases × 2 workers`
    : `${modelB.score}% · self-reported ${modelB.averageDurationMs} ms/answer`);
  setText('heldOutScore', data.training.candidate?.accuracy == null ? '—' : `${data.training.candidate.accuracy}%`);
  setText('previousScoreReading', `${data.training.baseAccuracy}%`);
  setText('candidateScoreDetailReading', data.training.candidate?.accuracy == null ? '—' : `${data.training.candidate.accuracy}%`);
  setText('candidateScoreReading', data.training.candidate?.accuracy == null
    ? 'Candidate held-out score: —' : `Candidate held-out score: ${data.training.candidate.accuracy}%`);
  setText('trainingRoundReading', data.training.id ? `${data.training.status} · ${data.training.id}` : 'No round started');
  const improved = data.training.candidate?.canAdopt === true;
  setText('candidateReviewReading', improved
    ? 'Candidate improved the fixed held-out set. Review the score, then explicitly confirm adoption.'
    : data.training.candidate ? messages('noImprovement') : 'No improved candidate is available to review.');
  $('adoptCandidate').disabled = !improved;
  const baseline = candidates.find((candidate) => candidate.modelId === registry.activeLanguageModel);
  const adoptable = candidates.find((candidate) => candidate.complete && candidate.modelId !== registry.activeLanguageModel &&
    baseline?.complete && candidate.score > baseline.score);
  $('adoptLanguageCandidate').disabled = !adoptable;
  if (adoptable) $('adoptLanguageCandidate').dataset.candidateId = adoptable.modelId;
  else delete $('adoptLanguageCandidate').dataset.candidateId;
  if (data.evaluation.status === 'complete') {
    setText('evaluationSummary', `${messages('evalDone')} ${LANGUAGE_MODELS[0].id}: ${modelA?.score ?? '—'}% · ${LANGUAGE_MODELS[1].id}: ${modelB?.score ?? '—'}%.`);
  } else {
    setText('evaluationSummary', messages('scorePending'));
  }
  const selectionA = $('modelASelect'), selectionB = $('modelBSelect');
  selectionA.disabled = data.evaluation.status === 'running' || data.evaluation.status === 'complete';
  selectionB.disabled = selectionA.disabled;
  $('startEvaluation').disabled = data.evaluation.status !== 'idle' || !selectionA.checked || !selectionB.checked;
  $('startTrainingRound').disabled = data.training.status === 'running' || data.training.status === 'complete' ||
    data.workers.trainers < 2;
  $('leaveWorker').disabled = !session.token;
}

async function api(route, body, token, { keepalive = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(aiUrl(route), {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    keepalive,
    signal: keepalive ? undefined : AbortSignal.timeout(12_000),
  });
  let value;
  try { value = await response.json(); } catch { throw Error(`AI lab returned HTTP ${response.status}`); }
  if (!response.ok) throw Error(value?.error || `AI lab returned HTTP ${response.status}`);
  return value;
}

async function refreshStatus() {
  if (statusBusy) return statusSnapshot;
  statusBusy = true;
  try {
    const value = await api('/ai-lab/status');
    renderStatus(value);
    setText('aiMode', 'Isolated · memory-only · no chain');
    return value;
  } catch (error) {
    setText('aiMode', 'AI coordinator unavailable');
    setStatus(`${messages('offline')} ${error.message}`, true);
    return null;
  } finally { statusBusy = false; }
}

async function getTransformerModule() {
  transformerModulePromise ||= import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2');
  const module = await transformerModulePromise;
  module.env.allowRemoteModels = true;
  module.env.allowLocalModels = false;
  module.env.useBrowserCache = true;
  return module;
}

async function loadModel(model) {
  if (models.has(model.id)) return models.get(model.id);
  if (modelLoads.has(model.id)) return modelLoads.get(model.id);
  const statusId = model.id === LANGUAGE_MODELS[0].id ? 'modelAStatus' : 'modelBStatus';
  setText(statusId, messages('loading'));
  const loading = (async () => {
    try {
      const { pipeline } = await getTransformerModule();
      const useGpu = Boolean(navigator.gpu);
      const load = (device, dtype) => pipeline('text-generation', model.repo, {
        revision: model.revision, device, dtype,
        progress_callback(progress) {
          if (progress?.status === 'progress' && Number.isFinite(progress.progress)) {
            setText(statusId, `${messages('loading')} ${Math.floor(progress.progress)}%`);
          }
        },
      });
      let runner;
      try { runner = await load(useGpu ? 'webgpu' : 'wasm', useGpu ? 'q4f16' : 'q4'); }
      catch (gpuError) {
        if (!useGpu) throw gpuError;
        setText(statusId, messages('gpuFallback'));
        runner = await load('wasm', 'q4');
      }
      models.set(model.id, runner);
      setText(statusId, messages('loaded'));
      return runner;
    } catch (error) {
      setText(statusId, messages('downloadFailed'));
      throw Error(`${messages('downloadFailed')} ${String(error?.message || error).slice(0, 180)}`);
    } finally {
      modelLoads.delete(model.id);
    }
  })();
  modelLoads.set(model.id, loading);
  return loading;
}

async function downloadModel(model) {
  const consentId = model.id === LANGUAGE_MODELS[0].id ? 'modelAConsent' : 'modelBConsent';
  if (!$(`${consentId}`)?.checked) throw Error(messages('downloadConsent'));
  await loadModel(model);
  setStatus(messages('loaded'));
}

function extractGeneratedText(result) {
  const generated = result?.[0]?.generated_text;
  if (Array.isArray(generated)) {
    const assistant = [...generated].reverse().find((item) => item?.role === 'assistant');
    return String(assistant?.content || '');
  }
  return String(generated || '');
}

async function infer(model, prompt) {
  const runner = models.get(model.id);
  if (!runner) throw Error(messages('modelNeed'));
  const startedAt = performance.now();
  const result = await runner([{ role: 'user', content: prompt }], {
    max_new_tokens: 64,
    do_sample: false,
  });
  const output = extractGeneratedText(result).trim();
  if (!output || output.length > 2048) throw Error('Model returned an empty or oversized response.');
  return { output, elapsedMs: Math.min(120_000, Math.max(0, performance.now() - startedAt)) };
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function workerLoop(loopId) {
  while (session.token && session.loop === loopId) {
    try {
      const response = await api('/ai-lab/worker/next', undefined, session.token);
      const task = response.task;
      if (!task) {
        setText('workerStatus', messages('taskWait'));
        await sleep(2200);
        continue;
      }
      if (task.kind === 'evaluate') {
        const model = LANGUAGE_MODELS.find((candidate) => candidate.id === task.candidate.id);
        if (!model || model.revision !== task.candidate.revision || !models.has(model.id)) {
          throw Error(messages('modelNeed'));
        }
        const { output, elapsedMs } = await infer(model, task.testCase.prompt);
        await api('/ai-lab/worker/result', {
          jobId: task.jobId, modelId: model.id, revision: model.revision, output, elapsedMs,
        }, session.token);
      } else if (task.kind === 'train') {
        await new Promise((resolve, reject) => {
          const worker = new Worker(new URL('./ai-training-worker.mjs', import.meta.url), { type: 'module' });
          worker.onmessage = async ({ data }) => {
            worker.terminate();
            if (data?.error || data?.jobId !== task.jobId) return reject(Error(data?.error || 'Invalid training-worker result'));
            try {
              await api('/ai-lab/worker/gradient', {
                jobId: task.jobId, gradient: data.gradient, sampleCount: data.sampleCount,
              }, session.token);
              resolve();
            } catch (error) { reject(error); }
          };
          worker.onerror = () => { worker.terminate(); reject(Error('Local training worker failed')); };
          worker.postMessage({ jobId: task.jobId, weights: task.weights, samples: task.samples });
        });
      } else throw Error('Unknown worker task');
      setText('workerStatus', messages('workerRunning'));
      await refreshStatus();
    } catch (error) {
      setText('workerStatus', String(error?.message || error).slice(0, 240));
      setStatus(messages('error'), true);
      if (/session|expired|Unknown|already|Invalid,/.test(String(error?.message))) {
        await leaveWorker();
        return;
      }
      await sleep(2500);
    }
  }
}

async function joinWorker(primaryRole) {
  if (session.token) throw Error(messages('roleExists'));
  const evaluationSelected = primaryRole === 'evaluate' || $('evaluateConsent').checked;
  if (evaluationSelected) {
    if (!$('evaluateConsent').checked) throw Error(messages('evaluationConsent'));
    if (!$('modelASelect').checked || !$('modelBSelect').checked ||
        !models.has(LANGUAGE_MODELS[0].id) || !models.has(LANGUAGE_MODELS[1].id)) throw Error(messages('modelNeed'));
  } else if (!$('trainConsent').checked) throw Error(messages('trainingConsent'));
  const otherConsent = primaryRole === 'evaluate' ? $('trainConsent').checked : $('evaluateConsent').checked;
  const role = otherConsent ? 'both' : primaryRole === 'evaluate' ? 'evaluate' : 'train';
  const result = await api('/ai-lab/worker/join', { role, consent: true });
  session.workerId = result.workerId;
  session.token = result.token;
  session.role = result.role;
  const loopId = ++session.loop;
  setText('workerStatus', messages('workerRunning'));
  setText('workerIdReading', `${result.workerId.slice(0, 8)}… · ${result.role} · session-only`);
  $('leaveWorker').disabled = false;
  setStatus(messages('workerRunning'));
  void workerLoop(loopId);
  await refreshStatus();
}

async function leaveWorker({ keepalive = false } = {}) {
  if (!session.token) return;
  const oldToken = session.token;
  session.loop++;
  session.token = null;
  session.workerId = null;
  session.role = null;
  $('leaveWorker').disabled = true;
  if (keepalive) {
    void fetch(aiUrl('/ai-lab/worker/leave'), {
      method: 'POST',
      headers: { authorization: `Bearer ${oldToken}`, 'content-type': 'application/json' },
      credentials: 'same-origin', keepalive: true, body: '{}',
    }).catch(() => {});
  } else {
    try { await api('/ai-lab/worker/leave', {}, oldToken); } catch {}
  }
  setText('workerStatus', messages('workerLeft'));
  setText('workerIdReading', 'No worker ID');
  await refreshStatus();
}

function addHandlers() {
  $('modelASelect').addEventListener('change', () => statusSnapshot && renderStatus(statusSnapshot));
  $('modelBSelect').addEventListener('change', () => statusSnapshot && renderStatus(statusSnapshot));
  $('downloadModelA').addEventListener('click', () =>
    void downloadModel(LANGUAGE_MODELS[0]).catch((error) => setStatus(error.message, true)));
  $('downloadModelB').addEventListener('click', () =>
    void downloadModel(LANGUAGE_MODELS[1]).catch((error) => setStatus(error.message, true)));
  $('startEvaluation').addEventListener('click', async () => {
    if (!$('evaluationConfirm').checked) return setStatus('Confirm that only fixed public test prompts may be sent to participating browsers.', true);
    if (!$('modelASelect').checked || !$('modelBSelect').checked) return setStatus(messages('chooseModels'), true);
    if (!window.confirm(messages('confirmEvaluation'))) return;
    try {
      await api('/ai-lab/evaluation/start', { confirm: true });
      setStatus(messages('evaluationStarted'));
      await refreshStatus();
    } catch (error) { setStatus(error.message, true); }
  });
  $('joinEvaluateWorker').addEventListener('click', () =>
    void joinWorker('evaluate').catch((error) => setStatus(error.message, true)));
  $('joinTrainWorker').addEventListener('click', () =>
    void joinWorker('train').catch((error) => setStatus(error.message, true)));
  $('leaveWorker').addEventListener('click', () => void leaveWorker());
  $('startTrainingRound').addEventListener('click', async () => {
    if (!$('trainConsent').checked) return setStatus(messages('trainingConsent'), true);
    if (!statusSnapshot || statusSnapshot.workers.trainers < 2) return setStatus('Join from two separate browser sessions as training workers before starting.', true);
    if (!window.confirm(messages('confirmTraining'))) return;
    try {
      await api('/ai-lab/training/start', { confirm: true });
      setStatus(messages('trainingStarted'));
      await refreshStatus();
    } catch (error) { setStatus(error.message, true); }
  });
  $('adoptLanguageCandidate').addEventListener('click', async () => {
    const candidateId = $('adoptLanguageCandidate').dataset.candidateId;
    if (!candidateId || !$('languageAdoptConfirmation').checked) {
      return setText('languageAdoptionStatus', 'Review and explicitly confirm adoption first.');
    }
    if (!window.confirm(messages('confirmAdopt'))) return;
    try {
      await api('/ai-lab/models/adopt', { kind: 'language', candidateId, confirm: true });
      setText('languageAdoptionStatus', messages('adopted'));
      await refreshStatus();
    } catch (error) { setText('languageAdoptionStatus', error.message); }
  });
  $('adoptCandidate').addEventListener('click', async () => {
    if (!$('adoptConfirmation').checked) return setText('candidateReviewReading', 'Review and explicitly confirm adoption first.');
    if (!statusSnapshot?.training?.candidate?.canAdopt) return setText('candidateReviewReading', messages('noImprovement'));
    if (!window.confirm(messages('confirmAdopt'))) return;
    try {
      await api('/ai-lab/models/adopt', {
        kind: 'classifier', candidateId: statusSnapshot.training.candidate.id, confirm: true,
      });
      setText('candidateReviewReading', messages('adopted'));
      await refreshStatus();
    } catch (error) { setText('candidateReviewReading', error.message); }
  });
}

function initialize() {
  addLanguages();
  renderPublicEvaluationPrompts();
  addHandlers();
  setStatus(messages('connecting'));
  void refreshStatus();
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') void refreshStatus();
  }, 5000);
  timer.unref?.();
  window.addEventListener('pagehide', () => {
    clearInterval(timer);
    void leaveWorker({ keepalive: true });
  }, { once: true });
}

initialize();
