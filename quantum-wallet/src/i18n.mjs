// i18n dictionary + runtime for Quantum Wallet v2.
//
// Shape follows v1 exactly: every key maps to [ja, en, zh-CN, ko] and UI
// code never hardcodes copy — everything goes through t(). The base table
// was extracted verbatim from the v1 bundle's dictionary (iE, 56 keys);
// a handful of v1 strings that were ML-DSA-only (secure / approve /
// chainNote / receiveWarn / note / native / pqKeysTitle) were corrected
// for the three-scheme wallet, and v2 screens add their own keys
// (reset-flow texts reproduce reset-wallet v3 verbatim).
//
// Language persistence matches v1: the code lives in
// "zeronyth.language.v1" ("ja" | "en" | "zh-CN" | "ko") and the index in
// "zeronyth.qwallet.lang" (0..3); detection prefers the code key, then
// the index key, then Japanese.

export const LANGS = ['ja', 'en', 'zh-CN', 'ko'];
export const LANG_INDEX = Object.freeze({ ja: 0, en: 1, 'zh-CN': 2, zh: 2, ko: 3 });
export const LANGUAGE_KEY = 'zeronyth.language.v1';
export const LANGUAGE_INDEX_KEY = 'zeronyth.qwallet.lang';

export const DICT = {
 "tagline": [
  "量子時代の、自分だけの金庫。",
  "Your vault for the quantum era.",
  "量子时代，专属金库。",
  "양자 시대의 나만의 금고."
 ],
 "warning": [
  "未監査・テストネット専用。本番資産の利用禁止。",
  "Unaudited • Testnet only • Never use real assets.",
  "未经审计 · 仅限测试网 · 禁止使用真实资产。",
  "감사 미완료 · 테스트넷 전용 · 실제 자산 사용 금지."
 ],
 "overview": [
  "ダッシュボード",
  "Overview",
  "总览",
  "대시보드"
 ],
 "tokens": [
  "トークン",
  "Tokens",
  "代币",
  "토큰"
 ],
 "activity": [
  "取引履歴",
  "Activity",
  "交易记录",
  "거래 내역"
 ],
 "connect": [
  "DApp接続",
  "DApp connections",
  "DApp 连接",
  "DApp 연결"
 ],
 "settings": [
  "ネットワーク設定",
  "Network settings",
  "网络设置",
  "네트워크 설정"
 ],
 "total": [
  "利用可能残高",
  "Available balance",
  "可用余额",
  "사용 가능 잔액"
 ],
 "send": [
  "送金",
  "Send",
  "发送",
  "보내기"
 ],
 "receive": [
  "受信",
  "Receive",
  "接收",
  "받기"
 ],
 "faucet": [
  "テスト用資金を取得",
  "Get test funds",
  "领取测试资金",
  "테스트 자금 받기"
 ],
 "refresh": [
  "更新",
  "Refresh",
  "刷新",
  "새로고침"
 ],
 "create": [
  "ウォレット作成",
  "Create wallet",
  "创建钱包",
  "지갑 생성"
 ],
 "restore": [
  "暗号化バックアップから復元",
  "Restore encrypted backup",
  "恢复加密备份",
  "암호화 백업 복원"
 ],
 "unlock": [
  "ロック解除",
  "Unlock",
  "解锁",
  "잠금 해제"
 ],
 "lock": [
  "ロック",
  "Lock",
  "锁定",
  "잠금"
 ],
 "password": [
  "パスワード（12文字以上）",
  "Password (12+ characters)",
  "密码（至少12个字符）",
  "비밀번호 (12자 이상)"
 ],
 "confirmPassword": [
  "パスワード確認",
  "Confirm password",
  "确认密码",
  "비밀번호 확인"
 ],
 "backup": [
  "暗号化バックアップ保存",
  "Export encrypted backup",
  "导出加密备份",
  "암호화 백업 내보내기"
 ],
 "secure": [
  "3方式対応 / PQアカウントはECDSAで操作不可",
  "Three schemes / PQ accounts cannot be spent via ECDSA",
  "支持三种方案 / PQ 账户不可用 ECDSA 操作",
  "3가지 방식 지원 / PQ 계정은 ECDSA로 사용 불가"
 ],
 "local": [
  "鍵はこの端末だけに保存されます。復元にはバックアップとパスワードが必要です。",
  "Keys stay on this device. Recovery requires your backup and password.",
  "密钥仅保存在本设备。恢复需要备份和密码。",
  "키는 이 기기에만 저장됩니다. 복구에는 백업과 비밀번호가 필요합니다."
 ],
 "recipient": [
  "受取アドレス",
  "Recipient address",
  "收款地址",
  "받는 주소"
 ],
 "amount": [
  "数量",
  "Amount",
  "数量",
  "금액"
 ],
 "review": [
  "取引を確認",
  "Review transaction",
  "检查交易",
  "거래 검토"
 ],
 "approve": [
  "承認して署名",
  "Approve & sign",
  "批准并签名",
  "승인 및 서명"
 ],
 "cancel": [
  "キャンセル",
  "Cancel",
  "取消",
  "취소"
 ],
 "copy": [
  "コピー",
  "Copy",
  "复制",
  "복사"
 ],
 "copied": [
  "コピーしました",
  "Copied",
  "已复制",
  "복사됨"
 ],
 "network": [
  "ネットワーク",
  "Network",
  "网络",
  "네트워크"
 ],
 "rpc": [
  "RPC URL",
  "RPC URL",
  "RPC URL",
  "RPC URL"
 ],
 "save": [
  "保存して接続確認",
  "Save & verify connection",
  "保存并验证连接",
  "저장 및 연결 확인"
 ],
 "offline": [
  "未接続",
  "Disconnected",
  "未连接",
  "연결 안 됨"
 ],
 "connected": [
  "PQ取引対応RPCに接続",
  "PQ-capable RPC connected",
  "已连接支持 PQ 交易的 RPC",
  "PQ 거래 지원 RPC 연결됨"
 ],
 "readOnly": [
  "接続済み（残高の読み取りのみ）",
  "Connected (balance read-only)",
  "已连接（仅读取余额）",
  "연결됨 (잔액 조회만)"
 ],
 "chainNote": [
  "Chain 912701 は ECDSA・Falcon-1024・ML-DSA-65 の3方式に対応しています。アカウントごとに方式は固定され、PQアカウントを ECDSA で操作することはできません。",
  "Chain 912701 supports three schemes: ECDSA, Falcon-1024 and ML-DSA-65. Each account is bound to its scheme, and a PQ account can never be operated via ECDSA.",
  "Chain 912701 支持 ECDSA、Falcon-1024 和 ML-DSA-65 三种方案。每个账户绑定其方案，PQ 账户永远无法通过 ECDSA 操作。",
  "Chain 912701은 ECDSA, Falcon-1024, ML-DSA-65 세 가지 방식을 지원합니다. 각 계정은 방식에 고정되며 PQ 계정은 ECDSA로 조작할 수 없습니다."
 ],
 "receiveWarn": [
  "このアドレスで ZNYT を受け取れます。届いた資金は、このアカウントの方式でそのまま送金できます。",
  "You can receive ZNYT at this address. Received funds can be sent on with this account’s scheme.",
  "可以在此地址接收 ZNYT。收到的资金可以使用此账户的方案直接转出。",
  "이 주소로 ZNYT를 받을 수 있습니다. 받은 자금은 이 계정의 방식으로 바로 전송할 수 있습니다."
 ],
 "pqKeysTitle": [
  "署名方式",
  "Signature schemes",
  "签名方案",
  "서명 방식"
 ],
 "native": [
  "ネイティブ取引（ECDSA / Falcon-1024 / ML-DSA-65）",
  "Native transactions (ECDSA / Falcon-1024 / ML-DSA-65)",
  "原生交易（ECDSA / Falcon-1024 / ML-DSA-65）",
  "네이티브 거래 (ECDSA / Falcon-1024 / ML-DSA-65)"
 ],
 "tokenAddress": [
  "ERC-20コントラクトアドレス",
  "ERC-20 contract address",
  "ERC-20 合约地址",
  "ERC-20 컨트랙트 주소"
 ],
 "add": [
  "トークンを追加",
  "Add token",
  "添加代币",
  "토큰 추가"
 ],
 "empty": [
  "取引はまだありません",
  "No transactions yet",
  "暂无交易",
  "거래 내역이 없습니다"
 ],
 "fee": [
  "最大ネットワーク手数料",
  "Maximum network fee",
  "最高网络费用",
  "최대 네트워크 수수료"
 ],
 "from": [
  "送信元",
  "From",
  "发送方",
  "보내는 주소"
 ],
 "chain": [
  "チェーンID",
  "Chain ID",
  "链 ID",
  "체인 ID"
 ],
 "success": [
  "送信済み。レシートで結果を確認してください。",
  "Submitted. Check the receipt for execution status.",
  "已提交。请检查收据确认执行状态。",
  "제출됨. 영수증에서 실행 상태를 확인하세요."
 ],
 "receipt": [
  "レシート確認",
  "Check receipt",
  "检查收据",
  "영수증 확인"
 ],
 "dappHelp": [
  "専用ポップアッププロバイダーで接続します。通常のMetaMask APIとは異なります。送金は毎回承認が必要です。",
  "Connect through the dedicated popup provider. This is a PQ-specific API. Every transfer needs approval.",
  "通过专用弹窗提供程序连接。使用专用 PQ API，每次转账均需批准。",
  "전용 팝업 프로바이더로 연결합니다. PQ 전용 API이며 모든 송금에 승인이 필요합니다."
 ],
 "demo": [
  "DAppデモを開く",
  "Open DApp demo",
  "打开 DApp 演示",
  "DApp 데모 열기"
 ],
 "revoke": [
  "接続を解除",
  "Revoke connection",
  "撤销连接",
  "연결 해제"
 ],
 "permission": [
  "このサイトにアドレスの公開を許可しますか？",
  "Allow this site to see your address?",
  "允许此网站查看您的地址？",
  "이 사이트에 주소 공개를 허용할까요?"
 ],
 "allow": [
  "接続を許可",
  "Allow connection",
  "允许连接",
  "연결 허용"
 ],
 "note": [
  "Chain 912701 では ECDSA / Falcon-1024 / ML-DSA-65 のネイティブ取引が有効です。初期 RPC はこのサイトの /rpc で、残高確認・送金・フォーセットに対応しています。",
  "Native ECDSA, Falcon-1024 and ML-DSA-65 transactions are live on chain 912701. The default RPC is this site’s /rpc and supports balances, sending and the faucet.",
  "Chain 912701 已支持 ECDSA、Falcon-1024 与 ML-DSA-65 原生交易。默认 RPC 为本站 /rpc，支持余额查询、发送与水龙头。",
  "Chain 912701에서 ECDSA, Falcon-1024, ML-DSA-65 네이티브 거래가 활성화되어 있습니다. 기본 RPC는 이 사이트의 /rpc이며 잔액 조회·전송·포셋을 지원합니다."
 ],
 "status": [
  "状態",
  "Status",
  "状态",
  "상태"
 ],
 "assets": [
  "資産",
  "Assets",
  "资产",
  "자산"
 ],
 "confirm": [
  "パスワードが一致しません",
  "Passwords do not match",
  "密码不匹配",
  "비밀번호가 일치하지 않습니다"
 ],
 "backupNotice": [
  "バックアップを保存してください。パスワードを忘れると復元できません。",
  "Save your backup. A lost password cannot be recovered.",
  "请保存备份。密码丢失后无法恢复。",
  "백업을 저장하세요. 비밀번호 분실 시 복구할 수 없습니다."
 ],
 "firstAccount": [
  "最初のアカウント",
  "First account",
  "第一个账户",
  "첫 번째 계정"
 ],
 "selectScheme": [
  "署名方式を選択",
  "Choose a signature scheme",
  "选择签名方案",
  "서명 방식을 선택하세요"
 ],
 "noteEcdsa": [
  "従来の Ethereum 互換方式。MetaMask などと互換性がありますが、量子耐性はありません。",
  "The classic Ethereum scheme. Compatible with MetaMask and other EVM wallets, but not quantum-resistant.",
  "经典的以太坊方案。兼容 MetaMask 等 EVM 钱包，但不具备抗量子性。",
  "기존 이더리움 방식. MetaMask 등 EVM 지갑과 호환되지만 양자 내성은 없습니다."
 ],
 "noteFalcon": [
  "量子耐性あり（Falcon-1024）。署名は約1.3 KB、手数料は中程度。鍵生成に少し時間がかかります。",
  "Quantum-resistant (Falcon-1024). Signatures are ~1.3 KB with mid-range fees. Key generation takes a moment.",
  "具备抗量子性（Falcon-1024）。签名约 1.3 KB，手续费中等。密钥生成需要一点时间。",
  "양자 내성 있음 (Falcon-1024). 서명은 약 1.3 KB, 수수료는 중간 수준입니다. 키 생성에 시간이 조금 걸립니다."
 ],
 "noteMldsa": [
  "量子耐性あり（ML-DSA-65）。署名は約3.3 KB で、手数料は3方式の中で最も高めです。",
  "Quantum-resistant (ML-DSA-65). Signatures are ~3.3 KB with the highest fees of the three.",
  "具备抗量子性（ML-DSA-65）。签名约 3.3 KB，手续费在三者中最高。",
  "양자 내성 있음 (ML-DSA-65). 서명은 약 3.3 KB로 세 방식 중 수수료가 가장 높습니다."
 ],
 "quantumResistant": [
  "量子耐性あり",
  "Quantum-resistant",
  "抗量子",
  "양자 내성"
 ],
 "unlocking": [
  "ロック解除中…",
  "Unlocking…",
  "解锁中…",
  "잠금 해제 중…"
 ],
 "creating": [
  "ウォレットを作成中…",
  "Creating wallet…",
  "创建钱包中…",
  "지갑 생성 중…"
 ],
 "deriving": [
  "鍵を生成中…（Falcon は少し時間がかかります）",
  "Deriving keys… (Falcon takes a moment)",
  "生成密钥中…（Falcon 需要一点时间）",
  "키 생성 중… (Falcon은 시간이 조금 걸립니다)"
 ],
 "signing": [
  "署名中…",
  "Signing…",
  "签名中…",
  "서명 중…"
 ],
 "broadcasting": [
  "送信中…",
  "Broadcasting…",
  "广播中…",
  "전송 중…"
 ],
 "wrongPassword": [
  "パスワードが正しくありません",
  "Incorrect password",
  "密码不正确",
  "비밀번호가 올바르지 않습니다"
 ],
 "migratedTitle": [
  "v1 ウォレットを移行しました",
  "Your v1 wallet was migrated",
  "已迁移 v1 钱包",
  "v1 지갑이 마이그레이션되었습니다"
 ],
 "migratedBody": [
  "アドレスはそのまま変わりません。旧ウォレットのバックアップもこの端末に保持されています。",
  "Your address is unchanged, and a backup of the old vault is kept on this device.",
  "您的地址保持不变，旧钱包的备份保留在此设备上。",
  "주소는 그대로이며, 이전 지갑의 백업이 이 기기에 보관되어 있습니다."
 ],
 "forgot": [
  "パスワードを忘れた場合：この端末のウォレットを削除して新規作成",
  "Forgot your password? Delete this device wallet and create a new one",
  "忘记密码？删除本设备钱包并新建",
  "비밀번호를 잊으셨나요? 이 기기의 지갑을 삭제하고 새로 만들기"
 ],
 "resetWarn": [
  "この端末に保存されたウォレットを削除します。バックアップファイルとパスワードがない場合、削除したウォレットは二度と復元できず、その資産にアクセスできなくなります。",
  "This deletes the wallet stored on this device. Without the backup file and its password, the deleted wallet can never be restored and its assets become inaccessible.",
  "这将删除保存在本设备上的钱包。如果没有备份文件和密码，被删除的钱包将永远无法恢复，其中的资产也将无法访问。",
  "이 기기에 저장된 지갑을 삭제합니다. 백업 파일과 비밀번호가 없으면 삭제된 지갑은 다시 복원할 수 없으며 자산에 접근할 수 없게 됩니다."
 ],
 "resetDelete": [
  "削除して新規作成",
  "Delete and create new",
  "删除并新建",
  "삭제하고 새로 만들기"
 ],
 "accounts": [
  "アカウント",
  "Accounts",
  "账户",
  "계정"
 ],
 "addAccount": [
  "アカウントを追加",
  "Add account",
  "添加账户",
  "계정 추가"
 ],
 "balance": [
  "残高",
  "Balance",
  "余额",
  "잔액"
 ],
 "noAccounts": [
  "アカウントがまだありません",
  "No accounts yet",
  "暂无账户",
  "아직 계정이 없습니다"
 ],
 "yourAddress": [
  "あなたのアドレス",
  "Your address",
  "您的地址",
  "내 주소"
 ],
 "data": [
  "データ（16進数）",
  "Data (hex)",
  "数据（十六进制）",
  "데이터 (16진수)"
 ],
 "advanced": [
  "高度な設定",
  "Advanced",
  "高级选项",
  "고급"
 ],
 "gasLimit": [
  "ガス上限",
  "Gas limit",
  "Gas 上限",
  "가스 한도"
 ],
 "gasPrice": [
  "ガス価格（wei）",
  "Gas price (wei)",
  "Gas 价格（wei）",
  "가스 가격 (wei)"
 ],
 "viewExplorer": [
  "エクスプローラーで表示",
  "View on explorer",
  "在区块浏览器中查看",
  "익스플로러에서 보기"
 ],
 "txHash": [
  "取引ハッシュ",
  "Transaction hash",
  "交易哈希",
  "거래 해시"
 ],
 "receiptPending": [
  "確認待ち…",
  "Waiting for confirmation…",
  "等待确认…",
  "확인 대기 중…"
 ],
 "receiptOk": [
  "完了しました",
  "Confirmed",
  "已确认",
  "완료되었습니다"
 ],
 "receiptNg": [
  "失敗しました",
  "Failed",
  "失败",
  "실패했습니다"
 ],
 "faucetDone": [
  "テスト用資金をリクエストしました",
  "Test funds requested",
  "已请求测试资金",
  "테스트 자금을 요청했습니다"
 ],
 "invalidAddress": [
  "アドレスの形式が正しくありません",
  "Invalid address format",
  "地址格式不正确",
  "주소 형식이 올바르지 않습니다"
 ],
 "invalidAmount": [
  "数量の形式が正しくありません",
  "Invalid amount",
  "数量格式不正确",
  "금액 형식이 올바르지 않습니다"
 ],
 "invalidData": [
  "データは 0x で始まる16進数で入力してください",
  "Data must be 0x-prefixed hex",
  "数据必须是 0x 开头的十六进制",
  "데이터는 0x로 시작하는 16진수여야 합니다"
 ],
 "insufficient": [
  "残高が不足しています",
  "Insufficient balance",
  "余额不足",
  "잔액이 부족합니다"
 ],
 "sendFailed": [
  "送信に失敗しました",
  "Send failed",
  "发送失败",
  "전송에 실패했습니다"
 ],
 "contractCreation": [
  "コントラクト作成",
  "Contract creation",
  "合约创建",
  "컨트랙트 생성"
 ],
 "language": [
  "言語",
  "Language",
  "语言",
  "언어"
 ],
 "passwordNotStored": [
  "パスワードはこの端末に保存されません。ページを再読み込みしたり閉じたりすると、ウォレットはロックされます。",
  "Your password is never stored on this device. The wallet locks when the page is reloaded or closed.",
  "密码不会保存在此设备上。重新加载或关闭页面后，钱包将被锁定。",
  "비밀번호는 이 기기에 저장되지 않습니다. 페이지를 새로고침하거나 닫으면 지갑이 잠깁니다."
 ],
 "dismiss": [
  "閉じる",
  "Dismiss",
  "关闭",
  "닫기"
 ],
 "wrongChain": [
  "想定外のチェーンに接続しています",
  "Connected to an unexpected chain",
  "已连接到意外的链",
  "예상과 다른 체인에 연결되어 있습니다"
 ],
 "back": [
  "戻る",
  "Back",
  "返回",
  "뒤로"
 ]
};

/** Resolve the active language code from storage (v1 precedence). */
export function detectLang(storage) {
  const code = storage.getItem(LANGUAGE_KEY);
  if (code != null && LANG_INDEX[code] !== undefined) return LANGS[LANG_INDEX[code]];
  const idx = storage.getItem(LANGUAGE_INDEX_KEY);
  if (idx != null) {
    const n = Number(idx);
    if (Number.isFinite(n)) return LANGS[((n % 4) + 4) % 4];
  }
  return 'ja';
}

/**
 * i18n runtime bound to a Storage-like object.
 *   const i18n = createI18n(storage);
 *   i18n.t('send')                       -> localized string
 *   i18n.t('someKey', { name: 'x' })     -> {name} interpolation
 *   i18n.setLang('en')                   -> persists code + index keys
 *   i18n.lang                            -> active code ("ja" default)
 */
export function createI18n(storage) {
  let lang = detectLang(storage);
  return {
    get lang() {
      return lang;
    },
    langs: LANGS,
    t(key, vars) {
      const entry = DICT[key];
      let text = entry ? entry[LANG_INDEX[lang]] : key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.replaceAll(`{${name}}`, String(value));
        }
      }
      return text;
    },
    setLang(code) {
      if (LANG_INDEX[code] === undefined) throw Error(`Unknown language: ${code}`);
      lang = LANGS[LANG_INDEX[code]];
      storage.setItem(LANGUAGE_KEY, lang);
      storage.setItem(LANGUAGE_INDEX_KEY, String(LANG_INDEX[lang]));
    },
  };
}
