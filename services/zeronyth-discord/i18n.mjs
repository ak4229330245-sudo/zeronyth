// ja / en / zh (zh-CN) / ko strings. loc(locale) → key; t(l, key, vars).
export const LANGS = ['ja', 'en', 'zh', 'ko'];
export const LANG_META = {
  ja: { flag: '🇯🇵', label: '日本語', role: '🇯🇵 日本語', slug: 'general-ja' },
  en: { flag: '🇺🇸', label: 'English', role: '🇺🇸 English', slug: 'general-en' },
  zh: { flag: '🇨🇳', label: '中文', role: '🇨🇳 中文', slug: 'general-zh' },
  ko: { flag: '🇰🇷', label: '한국어', role: '🇰🇷 한국어', slug: 'general-ko' },
};
export function loc(l) { l = String(l || ''); if (l.startsWith('ja')) return 'ja'; if (l.startsWith('zh')) return 'zh'; if (l.startsWith('ko')) return 'ko'; return 'en'; }

const S = {
  setup_wait: { ja: '⚙️ サーバー設定中です。しばらくお待ちください。', en: '⚙️ The server is being set up. Please wait.', zh: '⚙️ 服务器正在设置中，请稍候。', ko: '⚙️ 서버를 설정 중입니다. 잠시 기다려 주세요.' },
  already: { ja: '✅ すでに認証済みです。', en: '✅ You are already verified.', zh: '✅ 你已经完成验证。', ko: '✅ 이미 인증되었습니다.' },
  cooldown: { ja: '⏳ 失敗が続いたため {t} まで待ってください。', en: '⏳ Too many failed tries. Try again {t}.', zh: '⏳ 失败次数过多，请在 {t} 后重试。', ko: '⏳ 실패가 많아 {t} 이후에 다시 시도해 주세요.' },
  review_wait: { ja: '🕵️ 運営の確認待ちです。しばらくお待ちください。', en: '🕵️ Waiting for manual review by the team.', zh: '🕵️ 正在等待管理团队人工审核。', ko: '🕵️ 운영팀의 수동 확인을 기다리는 중입니다.' },
  expired: { ja: '⌛ この問題は無効です。もう一度「認証」を押してください。', en: '⌛ This check expired. Press Verify again.', zh: '⌛ 此验证已失效，请重新点击“验证”。', ko: '⌛ 이 문제는 만료되었습니다. 인증 버튼을 다시 눌러 주세요.' },
  timeout: { ja: '⌛ 時間切れです。もう一度「認証」を押してください。', en: '⌛ Time is up. Press Verify again.', zh: '⌛ 已超时，请重新点击“验证”。', ko: '⌛ 시간이 초과되었습니다. 인증 버튼을 다시 눌러 주세요.' },
  fail3: { ja: '❌ 3回失敗しました。10分後にもう一度お試しください。', en: '❌ 3 failed tries. Please wait 10 minutes.', zh: '❌ 已失败 3 次，请 10 分钟后再试。', ko: '❌ 3회 실패했습니다. 10분 후에 다시 시도해 주세요.' },
  wrong: { ja: '❌ 不正解です（残り {n} 回）', en: '❌ Wrong answer ({n} left)', zh: '❌ 回答错误（剩余 {n} 次）', ko: '❌ 오답입니다 (남은 기회 {n}회)' },
  one_more: { ja: '⭕ 正解！もう1問', en: '⭕ Correct! One more', zh: '⭕ 正确！再来一题', ko: '⭕ 정답! 한 문제 더' },
  new_review: { ja: '🕵️ 作成から24時間以内のアカウントのため、運営が確認してから認証します。', en: '🕵️ Your account is less than 24h old, so a moderator will review you shortly.', zh: '🕵️ 你的账号注册不足 24 小时，管理员审核后将完成验证。', ko: '🕵️ 생성된 지 24시간 이내의 계정이므로 운영진 확인 후 인증됩니다.' },
  verified: { ja: '✅ 認証完了！ようこそ ZERONYTH へ 🎉', en: '✅ Verified — welcome to ZERONYTH! 🎉', zh: '✅ 验证完成！欢迎来到 ZERONYTH 🎉', ko: '✅ 인증 완료! ZERONYTH에 오신 것을 환영합니다 🎉' },
  pick_lang: { ja: '🌐 使う言語を選んでください（複数可・あとで /language で変更できます）。選んだ言語の雑談チャンネルが表示されます。', en: '🌐 Pick your language(s) (multiple OK, change later with /language). You will see the chat channel for each language you pick.', zh: '🌐 请选择你的语言（可多选，之后可用 /language 修改）。将显示所选语言的聊天频道。', ko: '🌐 사용할 언어를 선택하세요 (복수 선택 가능, 나중에 /language 로 변경). 선택한 언어의 채팅 채널이 표시됩니다.' },
  lang_ph: { ja: '言語を選択 / Language', en: 'Choose language(s)', zh: '选择语言 / Language', ko: '언어 선택 / Language' },
  lang_set: { ja: '🌐 言語ロールを更新しました: {l}', en: '🌐 Language roles updated: {l}', zh: '🌐 语言身份组已更新：{l}', ko: '🌐 언어 역할을 업데이트했습니다: {l}' },
  lang_need_verify: { ja: '🔒 先に認証してください。', en: '🔒 Please verify first.', zh: '🔒 请先完成验证。', ko: '🔒 먼저 인증해 주세요.' },
  chk_title: { ja: '🧩 人間確認', en: '🧩 Human check', zh: '🧩 人机验证', ko: '🧩 사람 확인' },
  chk_emoji: { ja: '「**{x}**」の絵文字を押してください', en: 'Press the **{x}** emoji', zh: '请点击“**{x}**”的表情', ko: '「**{x}**」 이모지를 눌러 주세요' },
  chk_math: { ja: '**{q}** はいくつ？', en: 'What is **{q}**?', zh: '**{q}** 等于多少？', ko: '**{q}** 은(는) 얼마인가요?' },
  chk_time: { ja: '⏱️ 60秒以内に答えてください', en: '⏱️ Answer within 60 seconds', zh: '⏱️ 请在 60 秒内作答', ko: '⏱️ 60초 이내에 답해 주세요' },
  mods_only: { ja: '🚫 Moderator 以上のみ', en: '🚫 Moderators only', zh: '🚫 仅限管理员', ko: '🚫 운영진 전용' },
  admin_only: { ja: '🚫 管理者のみ', en: '🚫 Administrators only', zh: '🚫 仅限管理员', ko: '🚫 관리자 전용' },
  error: { ja: '⚠️ エラーが発生しました。時間をおいてお試しください。', en: '⚠️ Something went wrong. Please try again later.', zh: '⚠️ 发生错误，请稍后再试。', ko: '⚠️ 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
  // faucet
  f_verify: { ja: '🔒 faucet は認証済みメンバーのみ使えます。先に {v} で認証してください。', en: '🔒 The faucet is for verified members. Please verify in {v} first.', zh: '🔒 水龙头仅限已验证成员使用，请先在 {v} 完成验证。', ko: '🔒 Faucet은 인증된 멤버만 사용할 수 있습니다. 먼저 {v} 에서 인증해 주세요.' },
  f_bad: { ja: '❌ アドレスの形式が正しくありません（0x で始まる 42 文字の EVM アドレス）。', en: '❌ Invalid address (must be a 42-character EVM address starting with 0x).', zh: '❌ 地址格式错误（需为 0x 开头的 42 位 EVM 地址）。', ko: '❌ 주소 형식이 올바르지 않습니다 (0x로 시작하는 42자 EVM 주소).' },
  f_busy: { ja: '⏳ このアドレスへの送金を処理中か、すでに十分な残高があります。少し待ってからお試しください。', en: '⏳ A transfer to this address is in progress or it already has enough balance. Try again shortly.', zh: '⏳ 该地址的转账正在处理中或余额已足够，请稍后再试。', ko: '⏳ 이 주소로 전송 중이거나 이미 잔액이 충분합니다. 잠시 후 다시 시도해 주세요.' },
  f_unavail: { ja: '⚠️ faucetの残高不足または混雑のため、現在受け付けできません。', en: '⚠️ The faucet is out of funds or busy right now. Please try later.', zh: '⚠️ 水龙头余额不足或繁忙，暂时无法领取。', ko: '⚠️ Faucet 잔액 부족 또는 혼잡으로 지금은 받을 수 없습니다.' },
  f_down: { ja: '🔧 faucetが一時停止中です。しばらくしてからお試しください。', en: '🔧 The faucet is temporarily paused. Please try again later.', zh: '🔧 水龙头暂时停止服务，请稍后再试。', ko: '🔧 Faucet이 일시 중지되었습니다. 잠시 후 다시 시도해 주세요.' },
  f_err: { ja: '⚠️ faucetでエラーが発生しました（HTTP {s}）。', en: '⚠️ Faucet error (HTTP {s}).', zh: '⚠️ 水龙头出错（HTTP {s}）。', ko: '⚠️ Faucet 오류 (HTTP {s}).' },
  f_cd_user: { ja: '⏳ このDiscordアカウントは受け取り済みです（1人24時間に1回）。次回: {n}', en: '⏳ This Discord account already claimed (once per 24h). Next: {n}', zh: '⏳ 该 Discord 账号已领取（每人 24 小时一次）。下次：{n}', ko: '⏳ 이 Discord 계정은 이미 받았습니다 (24시간에 1회). 다음: {n}' },
  f_cd_addr: { ja: '⏳ このアドレスは受け取り済みです。次回: {n}', en: '⏳ This address already claimed. Next: {n}', zh: '⏳ 该地址已领取。下次：{n}', ko: '⏳ 이 주소는 이미 받았습니다. 다음: {n}' },
  f_cap: { ja: '⏳ 本日の配布上限に達しました。次回: {n}', en: '⏳ Daily limit reached. Next: {n}', zh: '⏳ 今日发放已达上限。下次：{n}', ko: '⏳ 오늘 배포 한도에 도달했습니다. 다음: {n}' },
  f_ok: { ja: '🚰 ZNYT を送金しました', en: '🚰 ZNYT sent', zh: '🚰 ZNYT 已发送', ko: '🚰 ZNYT를 보냈습니다' },
  f_addr: { ja: '受取アドレス', en: 'Address', zh: '接收地址', ko: '받는 주소' },
  f_amt: { ja: '金額', en: 'Amount', zh: '数量', ko: '수량' },
  f_next: { ja: '次回受け取り可能', en: 'Next claim', zh: '下次可领取', ko: '다음 수령 가능' },
  f_tx: { ja: 'トランザクション', en: 'Transaction', zh: '交易', ko: '트랜잭션' },
  f_foot: { ja: 'テストネット faucet ・ 24時間に1回 ・ テストトークンに価値はありません', en: 'Testnet faucet ・ once per 24h ・ test tokens have no real value', zh: '测试网水龙头 ・ 每 24 小时一次 ・ 测试代币没有实际价值', ko: '테스트넷 Faucet ・ 24시간에 1회 ・ 테스트 토큰은 실제 가치가 없습니다' },
  in24h: { ja: '24時間後', en: 'in 24h', zh: '24 小时后', ko: '24시간 후' },
  // gm
  gm_title: { ja: '☀️ {u} の GM 記録', en: "☀️ {u}'s GM record", zh: '☀️ {u} 的 GM 记录', ko: '☀️ {u} 님의 GM 기록' },
  gm_streak: { ja: '🔥 連続', en: '🔥 Streak', zh: '🔥 连续', ko: '🔥 연속' },
  gm_best: { ja: '🏆 最高', en: '🏆 Best', zh: '🏆 最高', ko: '🏆 최고' },
  gm_total: { ja: '📅 合計', en: '📅 Total', zh: '📅 合计', ko: '📅 합계' },
  days: { ja: '{n} 日', en: '{n} days', zh: '{n} 天', ko: '{n}일' },
  times: { ja: '{n} 回', en: '{n} GMs', zh: '{n} 次', ko: '{n}회' },
  gm_done: { ja: '今日の GM 済み ✅（日本時間）', en: 'GM done today ✅ (JST)', zh: '今天已 GM ✅（日本时间）', ko: '오늘 GM 완료 ✅ (일본 시간)' },
  gm_notyet: { ja: '今日はまだ GM していません（日本時間）', en: 'No GM yet today (JST)', zh: '今天还没有 GM（日本时间）', ko: '오늘은 아직 GM 안 함 (일본 시간)' },
  lb_title: { ja: '☀️ GM リーダーボード', en: '☀️ GM Leaderboard', zh: '☀️ GM 排行榜', ko: '☀️ GM 리더보드' },
  lb_empty: { ja: 'まだ記録がありません。☀️｜gm で「gm」と言ってみよう！', en: 'No streaks yet — say "gm" in ☀️｜gm!', zh: '还没有记录 — 在 ☀️｜gm 说一声 “gm” 吧！', ko: '아직 기록이 없습니다 — ☀️｜gm 에서 "gm" 이라고 말해 보세요!' },
  lb_row: { ja: '連続 {s} 日 ・ 合計 {t}', en: '{s}-day streak ・ {t} total', zh: '连续 {s} 天 ・ 合计 {t}', ko: '연속 {s}일 ・ 합계 {t}' },
  lb_foot: { ja: '1日1回カウント（日本時間）', en: 'Counts once per day (JST)', zh: '每天计 1 次（日本时间）', ko: '하루 1회 집계 (일본 시간)' },
  // status
  st_title: { ja: 'ZERONYTH テストネット ステータス', en: 'ZERONYTH Testnet Status', zh: 'ZERONYTH 测试网状态', ko: 'ZERONYTH 테스트넷 상태' },
  st_ok: { ja: '🟢 チェーンは正常にブロックを生成しています', en: '🟢 The chain is producing blocks normally', zh: '🟢 链正在正常出块', ko: '🟢 체인이 정상적으로 블록을 생성하고 있습니다' },
  st_ng: { ja: '🔴 チェーンの状態を確認できないか、ブロック生成が止まっています', en: '🔴 Chain status unavailable or block production has stopped', zh: '🔴 无法获取链状态或出块已停止', ko: '🔴 체인 상태를 확인할 수 없거나 블록 생성이 멈췄습니다' },
  // mod notice
  mod_del: { ja: '⚠️ {u} のメッセージを削除しました：{r}', en: '⚠️ Removed a message from {u}: {r}', zh: '⚠️ 已删除 {u} 的消息：{r}', ko: '⚠️ {u} 님의 메시지를 삭제했습니다: {r}' },
};
export function t(l, key, vars = {}) {
  const e = S[key]; let s = (e && (e[l] ?? e.en)) ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
// Discord locale maps for command localizations
export const DLOC = (o) => ({ ja: o.ja, 'zh-CN': o.zh, 'zh-TW': o.zh, ko: o.ko, 'en-US': o.en, 'en-GB': o.en });
