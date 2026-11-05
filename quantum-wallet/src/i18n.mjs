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
  "未監査のソフトウェアです。ZNYT に金銭的価値はありません。",
  "Unaudited software. ZNYT has no monetary value.",
  "未经审计的软件。ZNYT 不具有货币价值。",
  "감사 미완료 소프트웨어입니다. ZNYT는 금전적 가치가 없습니다."
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
 ],
 "next": [
  "次へ",
  "Next",
  "下一步",
  "다음"
 ],
 "phraseIntro": [
  "新しいウォレットは、24単語のリカバリーフレーズで保護されます。まずフレーズを作成します。",
  "Your new wallet is protected by a 24-word recovery phrase. First, let's create it.",
  "新钱包由 24 个单词的恢复短语保护。首先创建短语。",
  "새 지갑은 24단어 복구 문구로 보호됩니다. 먼저 문구를 만듭니다."
 ],
 "phraseTitle": [
  "リカバリーフレーズ",
  "Recovery phrase",
  "恢复短语",
  "복구 문구"
 ],
 "phraseWarn": [
  "この24単語がウォレットそのものです。紙に書き留めて安全な場所に保管してください。写真・スクリーンショット・クラウドには保存しないでください。このフレーズを知る人は誰でも、あなたのウォレットを復元して資産を送金できます。",
  "These 24 words ARE your wallet. Write them on paper and store them somewhere safe. Never take a photo, screenshot, or save them to cloud storage. Anyone who knows this phrase can restore your wallet and move its assets.",
  "这 24 个单词就是您的钱包。请写在纸上并妥善保管。切勿拍照、截图或保存到云存储。任何知道此短语的人都可以恢复您的钱包并转走资产。",
  "이 24단어가 곧 지갑 자체입니다. 종이에 적어 안전한 곳에 보관하세요. 사진·스크린샷·클라우드 저장은 절대 금지입니다. 이 문구를 아는 사람은 누구나 지갑을 복구해 자산을 옮길 수 있습니다."
 ],
 "phraseWritten": [
  "書き留めました",
  "I've written it down",
  "我已记下",
  "적어 두었습니다"
 ],
 "phraseConfirmTitle": [
  "確認のため、指定の単語を入力してください",
  "To confirm, enter the requested words",
  "请按要求输入指定的单词以确认",
  "확인을 위해 지정된 단어를 입력하세요"
 ],
 "phraseWordN": [
  "{n}番目の単語",
  "Word #{n}",
  "第 {n} 个单词",
  "{n}번째 단어"
 ],
 "phraseMismatch": [
  "単語が一致しません。書き留めたフレーズを確認してください。",
  "The words do not match. Check your written phrase.",
  "单词不匹配。请检查您记下的短语。",
  "단어가 일치하지 않습니다. 적어 둔 문구를 확인하세요."
 ],
 "restorePhrase": [
  "フレーズで復元",
  "Restore with phrase",
  "用短语恢复",
  "문구로 복구"
 ],
 "restorePhraseIntro": [
  "24単語のリカバリーフレーズと、新しいウォレット用パスワードを入力してください。過去に使ったアカウントも自動で検出します。",
  "Enter your 24-word recovery phrase and a new wallet password. Previously used accounts are detected automatically.",
  "请输入 24 个单词的恢复短语和新的钱包密码。系统会自动检测以前使用过的账户。",
  "24단어 복구 문구와 새 지갑 비밀번호를 입력하세요. 이전에 사용한 계정도 자동으로 감지합니다."
 ],
 "phraseInputLabel": [
  "リカバリーフレーズ（24単語）",
  "Recovery phrase (24 words)",
  "恢复短语（24 个单词）",
  "복구 문구 (24단어)"
 ],
 "phraseInvalid": [
  "フレーズが正しくありません。単語と順序を確認してください。",
  "That phrase is not valid. Check the words and their order.",
  "短语无效。请检查单词及其顺序。",
  "문구가 올바르지 않습니다. 단어와 순서를 확인하세요."
 ],
 "restoring": [
  "復元中…",
  "Restoring…",
  "恢复中…",
  "복구 중…"
 ],
 "restoreDoneProbed": [
  "ウォレットを復元しました。過去に使用したアカウントも検出しました。",
  "Wallet restored. Previously used accounts were detected too.",
  "钱包已恢复。也检测到了以前使用过的账户。",
  "지갑이 복구되었습니다. 이전에 사용한 계정도 감지되었습니다."
 ],
 "restoreDoneOffline": [
  "ウォレットを復元しました（RPCに接続できなかったため、各方式の最初のアカウントのみ復元しています）。",
  "Wallet restored (the RPC was unreachable, so only the first account of each scheme was restored).",
  "钱包已恢复（无法连接 RPC，因此仅恢复了每种方案的第一个账户）。",
  "지갑이 복구되었습니다(RPC에 연결할 수 없어 각 방식의 첫 번째 계정만 복구했습니다)."
 ],
 "showPhrase": [
  "リカバリーフレーズを表示",
  "Show recovery phrase",
  "显示恢复短语",
  "복구 문구 표시"
 ],
 "revealIntro": [
  "表示するには、ウォレットのパスワードを再入力してください。周りに人がいないことを確認してください。",
  "Re-enter your wallet password to reveal it. Make sure nobody is watching.",
  "重新输入钱包密码以显示。请确保周围没有人。",
  "표시하려면 지갑 비밀번호를 다시 입력하세요. 주변에 아무도 없는지 확인하세요."
 ],
 "hidePhrase": [
  "フレーズを隠す",
  "Hide phrase",
  "隐藏短语",
  "문구 숨기기"
 ],
 "noPhrase": [
  "このウォレットはリカバリーフレーズ対応前に作成されたため、フレーズはありません。復元の手段は下の暗号化バックアップのみです。大切に保管してください。",
  "This wallet was created before recovery-phrase support, so it has no phrase. The encrypted backup below is its only recovery path — keep it safe.",
  "此钱包在恢复短语支持之前创建，因此没有短语。下面的加密备份是其唯一的恢复方式，请妥善保管。",
  "이 지갑은 복구 문구 지원 전에 만들어져 문구가 없습니다. 아래 암호화 백업이 유일한 복구 수단이니 안전하게 보관하세요."
 ],
 "backupTitle": [
  "暗号化バックアップ",
  "Encrypted backup",
  "加密备份",
  "암호화 백업"
 ],
 "backupIntro": [
  "ウォレット全体を、バックアップ専用のパスワードで暗号化したファイルとして保存します。端末を失っても、このファイルとバックアップ用パスワードがあれば復元できます。",
  "Save the whole wallet as a file encrypted with a separate backup password. If you lose this device, the file plus its backup password restores everything.",
  "将整个钱包保存为使用专用备份密码加密的文件。即使丢失设备，只要有此文件和备份密码即可恢复。",
  "지갑 전체를 백업 전용 비밀번호로 암호화한 파일로 저장합니다. 기기를 잃어도 이 파일과 백업 비밀번호가 있으면 복구할 수 있습니다."
 ],
 "backupPassword": [
  "バックアップ用パスワード（12文字以上）",
  "Backup password (12+ characters)",
  "备份密码（至少12个字符）",
  "백업 비밀번호 (12자 이상)"
 ],
 "exporting": [
  "バックアップを作成中…",
  "Creating backup…",
  "创建备份中…",
  "백업 생성 중…"
 ],
 "backupReady": [
  "バックアップを作成しました。下のテキストを安全な場所に保存してください。",
  "Backup created. Save the text below somewhere safe.",
  "备份已创建。请将下面的文本保存到安全的地方。",
  "백업이 생성되었습니다. 아래 텍스트를 안전한 곳에 저장하세요."
 ],
 "downloadBackup": [
  "ファイルをダウンロード",
  "Download file",
  "下载文件",
  "파일 다운로드"
 ],
 "backupInvalid": [
  "バックアップファイルが正しくありません",
  "The backup file is not valid",
  "备份文件无效",
  "백업 파일이 올바르지 않습니다"
 ],
 "importIntro": [
  "バックアップファイルの内容を貼り付けるか、ファイルを選択してください。バックアップ用パスワードと、新しいウォレット用パスワードが必要です。",
  "Paste the backup file contents or choose the file. You need its backup password and a new wallet password.",
  "请粘贴备份文件内容或选择文件。需要备份密码和新的钱包密码。",
  "백업 파일 내용을 붙여넣거나 파일을 선택하세요. 백업 비밀번호와 새 지갑 비밀번호가 필요합니다."
 ],
 "networkSelect": [
  "ネットワーク",
  "Network",
  "网络",
  "네트워크"
 ],
 "testnetSuffix": [
  "（テストネット）",
  " (Testnet)",
  "（测试网）",
  " (테스트넷)"
 ],
 "connectedGeneric": [
  "接続中",
  "Connected",
  "已连接",
  "연결됨"
 ],
 "zeronythOnly": [
  "ZERONYTH 専用",
  "ZERONYTH only",
  "仅限 ZERONYTH",
  "ZERONYTH 전용"
 ],
 "notAvailableOnNetwork": [
  "このネットワークでは利用できません",
  "Not available on this network",
  "此网络不可用",
  "이 네트워크에서는 사용할 수 없습니다"
 ],
 "pqOnlyOnZeronyth": [
  "PQ アカウントは ZERONYTH ネットワークでのみ送信できます",
  "PQ accounts can only send on the ZERONYTH network",
  "PQ 账户只能在 ZERONYTH 网络上发送",
  "PQ 계정은 ZERONYTH 네트워크에서만 전송할 수 있습니다"
 ],
 "chainIdMismatch": [
  "チェーンIDが一致しません（RPC: {reported} / 期待値: {expected}）",
  "Chain ID mismatch (RPC: {reported} / expected: {expected})",
  "链 ID 不匹配（RPC:{reported} / 期望:{expected}）",
  "체인 ID 불일치 (RPC: {reported} / 예상: {expected})"
 ],
 "asset": [
  "資産",
  "Asset",
  "资产",
  "자산"
 ],
 "addChainAccount": [
  "他チェーンのアカウントを追加",
  "Add an other-chain account",
  "添加其他链账户",
  "다른 체인 계정 추가"
 ],
 "noteSolana": [
  "Solana のアカウント（Ed25519）。このウォレット専用の鍵で、Phantom 等とは互換性がありません。",
  "A Solana account (Ed25519). Keys are specific to this wallet and are not compatible with Phantom etc.",
  "Solana 账户（Ed25519）。密钥为此钱包专用，与 Phantom 等不兼容。",
  "Solana 계정(Ed25519). 이 지갑 전용 키이며 Phantom 등과 호환되지 않습니다."
 ],
 "noteBitcoin": [
  "Bitcoin のアカウント（P2WPKH / bech32）。EVM の鍵とは別の鍵を使います。",
  "A Bitcoin account (P2WPKH / bech32). Uses a separate key from the EVM accounts.",
  "Bitcoin 账户（P2WPKH / bech32）。使用与 EVM 不同的密钥。",
  "Bitcoin 계정(P2WPKH / bech32). EVM과는 별도의 키를 사용합니다."
 ],
 "noteXrp": [
  "XRP Ledger のアカウント。アカウント有効化には準備金（ベースリザーブ）以上の初回入金が必要です。",
  "An XRP Ledger account. First funding must meet the base reserve to activate the account.",
  "XRP Ledger 账户。首次入金需达到基础储备金才能激活账户。",
  "XRP Ledger 계정. 계정 활성화에는 기본 준비금 이상의 첫 입금이 필요합니다."
 ],
 "noteSui": [
  "Sui のアカウント（Ed25519）。このウォレット専用の鍵です。",
  "A Sui account (Ed25519). Keys are specific to this wallet.",
  "Sui 账户（Ed25519）。密钥为此钱包专用。",
  "Sui 계정(Ed25519). 이 지갑 전용 키입니다."
 ],
 "noteAptos": [
  "Aptos のアカウント（Ed25519）。このウォレット専用の鍵です。",
  "An Aptos account (Ed25519). Keys are specific to this wallet.",
  "Aptos 账户（Ed25519）。密钥为此钱包专用。",
  "Aptos 계정(Ed25519). 이 지갑 전용 키입니다."
 ],
 "phraseRestoresAll": [
  "このフレーズで、このウォレット内の全アカウント（他チェーンのアカウントを含む）を復元できます。他のウォレットアプリとの互換性はありません。",
  "This phrase restores every account in this wallet, including other-chain accounts. It is not compatible with other wallet apps.",
  "此短语可恢复此钱包中的所有账户，包括其他链账户。与其他钱包应用不兼容。",
  "이 문구로 이 지갑의 모든 계정(다른 체인 계정 포함)을 복구할 수 있습니다. 다른 지갑 앱과는 호환되지 않습니다."
 ],
 "destTag": [
  "宛先タグ（任意）",
  "Destination tag (optional)",
  "目标标签（可选）",
  "목적지 태그 (선택 사항)"
 ],
 "swap": [
  "スワップ",
  "Swap",
  "兑换",
  "스왑"
 ],
 "swapFrom": [
  "支払う",
  "You pay",
  "支付",
  "지불"
 ],
 "swapTo": [
  "受け取る（見込み）",
  "You receive (estimated)",
  "预计收到",
  "수령 (예상)"
 ],
 "slippage": [
  "スリッページ許容度（%）",
  "Slippage tolerance (%)",
  "滑点容差（%）",
  "슬리피지 허용 (%)"
 ],
 "minReceived": [
  "最小受取額",
  "Minimum received",
  "最低收到金额",
  "최소 수령액"
 ],
 "swapUnavailable": [
  "このネットワークではスワップできません。スワップは ZERONYTH ネットワーク専用です。",
  "Swap is not available on this network. Swap is available on the ZERONYTH network only.",
  "此网络不支持兑换。兑换仅在 ZERONYTH 网络提供。",
  "이 네트워크에서는 스왑할 수 없습니다. 스왑은 ZERONYTH 네트워크 전용입니다."
 ],
 "swapDone": [
  "スワップが完了しました",
  "Swap complete",
  "兑换完成",
  "스왑이 완료되었습니다"
 ],
 "swapExecute": [
  "スワップを実行",
  "Execute swap",
  "执行兑换",
  "스왑 실행"
 ],
 "approving": [
  "承認中…",
  "Approving…",
  "授权中…",
  "승인 중…"
 ],
 "swapping": [
  "スワップ中…",
  "Swapping…",
  "兑换中…",
  "스왑 중…"
 ],
 "firstSendWarn": [
  "初めて送信するアドレスです。アドレスが正しいか、もう一度よく確認してください。",
  "First time sending to this address. Double-check that it is correct.",
  "首次向此地址发送。请再次仔细确认地址无误。",
  "처음 보내는 주소입니다. 올바른 주소인지 다시 한 번 확인하세요."
 ],
 "firstSendAck": [
  "アドレスを確認しました",
  "I have double-checked the address",
  "我已确认地址",
  "주소를 확인했습니다"
 ],
 "contractWarn": [
  "送信先はコントラクトです。ネイティブ通貨をコントラクトに送ると、取り戻せない場合があります。",
  "The recipient is a contract. Native coins sent to a contract may be unrecoverable.",
  "收款地址是合约。向合约发送原生币可能无法找回。",
  "받는 주소가 컨트랙트입니다. 컨트랙트로 보낸 네이티브 코인은 복구할 수 없을 수 있습니다."
 ],
 "tooManyAttempts": [
  "試行回数が多すぎます。{seconds}秒待ってから再度お試しください。",
  "Too many attempts. Wait {seconds} seconds and try again.",
  "尝试次数过多。请等待 {seconds} 秒后再试。",
  "시도 횟수가 너무 많습니다. {seconds}초 후 다시 시도하세요."
 ],
 "rpcCaution": [
  "カスタム RPC を使用中です。悪意のある RPC は残高などを偽って表示できます（署名はこの端末内で行われるため、鍵が盗まれることはありません）。",
  "A custom RPC is in use. A malicious RPC can display false balances and history (it cannot steal keys — signing happens on this device).",
  "正在使用自定义 RPC。恶意 RPC 可能显示虚假的余额和记录（但无法窃取密钥——签名在本设备上完成）。",
  "사용자 지정 RPC를 사용 중입니다. 악성 RPC는 잔액과 내역을 거짓으로 표시할 수 있습니다(서명은 이 기기에서 이루어지므로 키는 탈취할 수 없습니다)."
 ],
 "autoLock": [
  "自動ロック（操作がない場合）",
  "Auto-lock when idle",
  "闲置时自动锁定",
  "자동 잠금 (미사용 시)"
 ],
 "autoLockOff": [
  "オフ",
  "Off",
  "关闭",
  "끄기"
 ],
 "autoLockMin": [
  "{n}分",
  "{n} min",
  "{n} 分钟",
  "{n}분"
 ],
 "buildVersion": [
  "バージョン",
  "Version",
  "版本",
  "버전"
 ],
 "backupPwNote": [
  "バックアップ用パスワードは12文字以上が必要です。バックアップファイルはオフラインで攻撃される可能性があるため、推測されにくいパスワードを使ってください。",
  "The backup password must be at least 12 characters. A backup file can be attacked offline, so choose a hard-to-guess password.",
  "备份密码至少需要 12 个字符。备份文件可能被离线攻击，请使用难以猜测的密码。",
  "백업 비밀번호는 12자 이상이어야 합니다. 백업 파일은 오프라인 공격을 받을 수 있으므로 추측하기 어려운 비밀번호를 사용하세요."
 ],
 "backupPwShort": [
  "バックアップ用パスワードは12文字以上にしてください",
  "Backup password must be at least 12 characters",
  "备份密码至少需要 12 个字符",
  "백업 비밀번호는 12자 이상이어야 합니다"
 ],
 "feeEstimate": [
  "手数料（見込み）",
  "Fee (maximum)",
  "费用（上限）",
  "수수료 (상한)"
 ],
 "router": [
  "ルーター",
  "Router",
  "路由器",
  "라우터"
 ],
 "pair": [
  "プール（ペア）",
  "Pool (pair)",
  "池（交易对）",
  "풀 (페어)"
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
