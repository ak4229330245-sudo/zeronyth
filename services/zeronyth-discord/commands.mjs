import { DLOC } from './i18n.mjs';
const G = { contexts: [0], integration_types: [0] }; // guild only
const D = (en, ja, zh, ko) => ({ description: en, description_localizations: DLOC({ en, ja, zh, ko }) });
export const commands = [
  { name: 'status', type: 1, ...G, ...D('Show ZERONYTH testnet status', 'ZERONYTH テストネットの状態を表示', '显示 ZERONYTH 测试网状态', 'ZERONYTH 테스트넷 상태 보기') },
  { name: 'faucet', type: 1, ...G, ...D('Get 10 test ZNYT (once per 24h, verified members)', 'テスト用 ZNYT を受け取る（24時間に1回・認証済みのみ）', '领取 10 个测试 ZNYT（每 24 小时一次，需验证）', '테스트 ZNYT 10개 받기 (24시간 1회, 인증 필요)'),
    options: [{ name: 'address', type: 3, required: true, min_length: 42, max_length: 42, ...D('Your 0x address (42 characters)', '受け取りアドレス (0x で始まる 42 文字)', '你的 0x 地址（42 位）', '받을 0x 주소 (42자)') }] },
  { name: 'gm-streak', type: 1, ...G, ...D('Show a GM streak', 'GM の連続記録を表示', '查看 GM 连续记录', 'GM 연속 기록 보기'),
    options: [{ name: 'user', type: 6, required: false, ...D('User (default: you)', 'ユーザー（省略で自分）', '用户（默认自己）', '사용자 (기본: 나)') }] },
  { name: 'gm-leaderboard', type: 1, ...G, ...D('GM streak leaderboard', 'GM 連続記録ランキング', 'GM 连续记录排行榜', 'GM 연속 기록 순위') },
  { name: 'language', type: 1, ...G, ...D('Change your language (chat channel)', '言語を変更（雑談チャンネルが切り替わります）', '切换语言（聊天频道）', '언어 변경 (채팅 채널)') },
  { name: 'setup', type: 1, ...G, default_member_permissions: '8', ...D('Admin: build/update the server layout (never deletes)', '【管理者】サーバー構成を作成・更新（削除はしません）', '【管理员】创建/更新服务器结构（不删除）', '[관리자] 서버 구성 생성/업데이트 (삭제 안 함)'),
    options: [{ name: 'grandfather', type: 5, required: false, ...D('Give existing members Verified (default: yes)', '既存メンバーに Verified を付与（既定: はい）', '为现有成员授予 Verified（默认：是）', '기존 멤버에게 Verified 부여 (기본: 예)') }] },
];
