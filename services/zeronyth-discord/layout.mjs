// Server layout: roles, categories, channels. Looked up by name so setup is idempotent.
import { PermissionFlagsBits as P, ChannelType, EmbedBuilder } from 'discord.js';
import { SITE, EXPLORER } from './lib.mjs';
import { LANGS, LANG_META } from './i18n.mjs';

export const ROLES = [ // top → bottom
  { key: 'team', name: 'Team', color: 0xf59e0b, hoist: true, mentionable: false,
    perms: [P.ManageMessages, P.ModerateMembers, P.KickMembers, P.ManageNicknames, P.ViewAuditLog, P.MentionEveryone, P.ManageThreads] },
  { key: 'mod', name: 'Moderator', color: 0x3b82f6, hoist: true, mentionable: false,
    perms: [P.ManageMessages, P.ModerateMembers, P.KickMembers, P.ManageNicknames, P.ViewAuditLog, P.ManageThreads] },
  { key: 'validator', name: 'Validator', color: 0x8b5cf6, hoist: true, mentionable: false, perms: [] },
  { key: 'node', name: 'Node Runner', color: 0x10b981, hoist: false, mentionable: false, perms: [] },
  { key: 'og', name: 'OG / Early', color: 0xec4899, hoist: false, mentionable: false, perms: [] },
  ...LANGS.map((l) => ({ key: 'lang_' + l, name: LANG_META[l].role, color: 0x94a3b8, hoist: false, mentionable: false, perms: [] })),
  { key: 'verified', name: 'Verified', color: 0x22d3ee, hoist: false, mentionable: false,
    perms: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AddReactions, P.EmbedLinks, P.AttachFiles,
      P.UseExternalEmojis, P.UseApplicationCommands, P.SendMessagesInThreads, P.CreatePublicThreads, P.Connect, P.Speak, P.UseVAD, P.ChangeNickname] },
];

// access: 'public-ro' (everyone can read, nobody writes), 'verified', 'verified-ro' (read only, Team writes),
// 'unverified-only' (verify panel; hidden once verified), 'validator', 'staff'
export const CATEGORIES = [
  { key: 'start', name: '🏁 START HERE ・ はじめに', channels: [
    { slug: 'rules', emoji: '📜', access: 'public-ro', topic: 'サーバールール / Server rules — 必ずお読みください' },
    { slug: 'verify', emoji: '✅', access: 'unverified-only', topic: 'ボタンを押して人間確認 / Press the button to verify you are human' },
    { slug: 'welcome', emoji: '👋', access: 'public-ro', topic: 'ようこそ ZERONYTH へ / Welcome to ZERONYTH' },
  ] },
  { key: 'info', name: '📢 INFORMATION ・ お知らせ', channels: [
    { slug: 'announcements', emoji: '📢', access: 'verified-ro', topic: '公式アナウンス / Official announcements' },
    { slug: 'chain-status', emoji: '📊', access: 'verified-ro', topic: 'テストネットの状態（自動更新） / Testnet status (auto-updated)' },
  ] },
  { key: 'community', name: '💬 COMMUNITY ・ コミュニティ', channels: [
    { slug: 'gm', emoji: '☀️', access: 'verified', topic: 'gm / おはよう / 早安 / 좋은 아침 ☀️ — daily GM streak: /gm-streak', slowmode: 5 },
    { slug: 'global-chat', emoji: '🌐', access: 'verified', topic: '全言語OK / All languages welcome / 所有语言 / 모든 언어 — みんなで話そう ・ Talk together', slowmode: 3 },
    { slug: 'art-gallery', emoji: '🎨', access: 'gallery', topic: '作品をシェア / Share your creations / 分享作品 / 작품 공유 — 画像・ファンアート・ミーム ・ images, fan art & memes', slowmode: 60 },
    { slug: 'general-ja', alias: 'general-jp', emoji: '🇯🇵', access: 'lang:ja', topic: '雑談（日本語） — 言語の変更は /language' },
    { slug: 'general-en', emoji: '🇺🇸', access: 'lang:en', topic: 'General chat (English) — switch with /language' },
    { slug: 'general-zh', emoji: '🇨🇳', access: 'lang:zh', topic: '中文聊天 — 用 /language 切换语言' },
    { slug: 'general-ko', emoji: '🇰🇷', access: 'lang:ko', topic: '한국어 채팅 — /language 로 언어 변경' },
    { slug: 'faucet', emoji: '🚰', access: 'verified', topic: '/faucet address:0x... → 10 test ZNYT (24h) ・ テスト用 ZNYT ・ 测试币 ・ 테스트 토큰 — no real value', slowmode: 10 },
    { slug: 'bot-commands', emoji: '🤖', access: 'verified', topic: '/status ・ /gm-streak ・ /gm-leaderboard ・ /language' },
  ] },
  { key: 'network', name: '🛠️ NETWORK ・ ネットワーク', channels: [
    { slug: 'node-runners', emoji: '🖥️', access: 'verified', topic: 'ノード運用の情報交換 / Running a ZERONYTH node' },
    { slug: 'validators', emoji: '🛡️', access: 'validator', topic: 'バリデーター専用 / Validators only' },
  ] },
  { key: 'support', name: '🧪 SUPPORT ・ サポート', channels: [
    { slug: 'bug-reports', emoji: '🐞', access: 'verified', topic: '不具合報告（再現手順・tx hash・スクショ） / Bug reports' },
    { slug: 'feedback', emoji: '💡', access: 'verified', topic: '要望・アイデア / Feedback & ideas' },
  ] },
  { key: 'staff', name: '🔒 STAFF', channels: [
    { slug: 'mod-log', emoji: '🔒', access: 'staff', topic: 'Bot moderation log (private)' },
  ] },
];

export const chanName = (c) => `${c.emoji}｜${c.slug}`;
const norm = (s) => s.replace(/\uFE0F/g, '');
export const matchChannel = (ch, slug) => ch.name === slug || norm(ch.name).endsWith('｜' + slug);

export function findRole(guild, key) { const r = ROLES.find((x) => x.key === key); return r && guild.roles.cache.find((x) => x.name === r.name); }
const ALIAS = Object.fromEntries(CATEGORIES.flatMap((c) => c.channels).filter((c) => c.alias).map((c) => [c.slug, c.alias]));
export function findChannel(guild, slug) {
  const f = (s) => guild.channels.cache.find((c) => c.type === ChannelType.GuildText && matchChannel(c, s));
  return f(slug) || (ALIAS[slug] ? f(ALIAS[slug]) : undefined);
}
export function findCategory(guild, key) {
  const cat = CATEGORIES.find((c) => c.key === key);
  const head = cat.name.split(' ・ ')[0];
  return guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && (c.name === cat.name || c.name.startsWith(head)));
}

const READ = [P.ViewChannel, P.ReadMessageHistory];
const WRITE = [P.SendMessages, P.AddReactions, P.CreatePublicThreads, P.CreatePrivateThreads, P.SendMessagesInThreads];

export function overwritesFor(access, guild, r) {
  const E = guild.roles.everyone.id, me = guild.members.me.id;
  const staff = [r.team, r.mod].filter(Boolean).map((x) => ({ id: x.id, allow: [...READ, ...WRITE] }));
  const bot = { id: me, allow: [...READ, P.SendMessages, P.EmbedLinks, P.ManageMessages, P.AddReactions] };
  switch (access) {
    case 'public-ro': return [{ id: E, allow: READ, deny: WRITE }, ...staff.map((s) => ({ ...s, allow: READ })), bot];
    case 'unverified-only': return [{ id: E, allow: READ, deny: WRITE }, { id: r.verified.id, deny: [P.ViewChannel] }, ...staff.map((s) => ({ ...s, allow: READ })), bot];
    case 'verified': return [{ id: E, deny: [P.ViewChannel] }, { id: r.verified.id, allow: [...READ, ...WRITE] }, ...staff, bot];
    case 'gallery': return [{ id: E, deny: [P.ViewChannel] }, { id: r.verified.id, allow: [...READ, ...WRITE, P.AttachFiles, P.EmbedLinks] }, ...staff, bot];
    case 'verified-ro': return [{ id: E, deny: [P.ViewChannel] }, { id: r.verified.id, allow: [...READ, P.AddReactions], deny: [P.SendMessages, P.CreatePublicThreads, P.CreatePrivateThreads] },
      ...(r.team ? [{ id: r.team.id, allow: [...READ, ...WRITE] }] : []), ...(r.mod ? [{ id: r.mod.id, allow: READ }] : []), bot];
    case 'validator': return [{ id: E, deny: [P.ViewChannel] }, { id: r.verified.id, deny: [P.ViewChannel] }, { id: r.validator.id, allow: [...READ, ...WRITE] }, ...staff, bot];
    default: if (access.startsWith('lang:')) { const lr = r['lang_' + access.slice(5)];
      return [{ id: E, deny: [P.ViewChannel] }, { id: r.verified.id, deny: [P.ViewChannel] }, { id: lr.id, allow: [...READ, ...WRITE] }, ...staff, bot]; }
      return [];
    case 'staff': return [{ id: E, deny: [P.ViewChannel] }, { id: r.verified.id, deny: [P.ViewChannel] }, ...staff, bot];
  }
}

const BRAND = 0x7c3aed;
const LINKS = `🌐 [Website](${SITE}/) ・ 🔍 [Explorer](${EXPLORER}/)`;
const RULES = {
  ja: ['📜 サーバールール', [
    '**1. 🚨 DM詐欺に注意** — 運営・モデレーターから**DMを送ることはありません**。DMの「サポート」「認証」「ウォレット接続」「当選」はすべて詐欺です。',
    '**2. 🔑 シードフレーズ・秘密鍵は絶対に教えない・入力しない** — 運営が聞くことは絶対にありません。',
    '**3. 🚫 スパム・宣伝・招待リンク・@everyone 禁止** — 自動で削除されます。',
    '**4. 🤖 ボット/スクリプト/複数アカウントでのポイント稼ぎ = BAN**',
    '**5. 🧪 テストネットのトークン (ZNYT) に価値はありません** — 売買を持ちかける人は詐欺です。',
    '**6. 🤝 お互いを尊重** — 誹謗中傷・差別・NSFW 禁止。'], '違反は警告なしで対応する場合があります'],
  en: ['📜 Server Rules', [
    '**1. 🚨 Beware of DM scams** — The team will **never DM you first**. Any DM about support, verification, wallet connection or prizes is a scam.',
    '**2. 🔑 Never share or enter your seed phrase / private key** — nobody legit will ever ask.',
    '**3. 🚫 No spam, shilling, invite links or @everyone** — auto-deleted.',
    '**4. 🤖 Farming points with bots, scripts or alt accounts = ban**',
    '**5. 🧪 Testnet tokens (ZNYT) have no real value** — anyone offering to buy/sell them is a scammer.',
    '**6. 🤝 Be respectful** — no harassment, hate or NSFW.'], 'Violations may be actioned without warning'],
  zh: ['📜 服务器规则', [
    '**1. 🚨 谨防私信诈骗** — 官方团队和管理员**绝不会主动私信你**。任何关于“客服”“验证”“连接钱包”“中奖”的私信都是诈骗。',
    '**2. 🔑 绝不泄露或输入助记词 / 私钥** — 官方永远不会索要。',
    '**3. 🚫 禁止刷屏、广告、邀请链接和 @everyone** — 将被自动删除。',
    '**4. 🤖 使用机器人、脚本或小号刷积分 = 封禁**',
    '**5. 🧪 测试网代币 (ZNYT) 没有实际价值** — 任何买卖提议都是诈骗。',
    '**6. 🤝 互相尊重** — 禁止骚扰、歧视和 NSFW 内容。'], '违规行为可能会被直接处理'],
  ko: ['📜 서버 규칙', [
    '**1. 🚨 DM 사기 주의** — 운영진은 **절대 먼저 DM을 보내지 않습니다**. "지원", "인증", "지갑 연결", "당첨" DM은 모두 사기입니다.',
    '**2. 🔑 시드 문구 / 개인 키는 절대 공유하거나 입력하지 마세요** — 운영진은 절대 요구하지 않습니다.',
    '**3. 🚫 스팸, 홍보, 초대 링크, @everyone 금지** — 자동 삭제됩니다.',
    '**4. 🤖 봇·스크립트·다중 계정으로 포인트 파밍 = 밴**',
    '**5. 🧪 테스트넷 토큰 (ZNYT)은 실제 가치가 없습니다** — 매매를 제안하는 사람은 사기꾼입니다.',
    '**6. 🤝 서로 존중하기** — 괴롭힘, 차별, NSFW 금지.'], '위반 시 경고 없이 조치될 수 있습니다'],
};
export function rulesEmbeds() {
  return LANGS.map((l, i) => new EmbedBuilder().setColor(BRAND).setTitle(`${LANG_META[l].flag} ${RULES[l][0]}`)
    .setDescription(RULES[l][1].join('\n') + (i === 3 ? `\n\n${LINKS}` : ''))
    .setFooter({ text: (i === 0 ? 'zeronyth:rules ・ ' : '') + RULES[l][2] }));
}

export function verifyEmbed() {
  return new EmbedBuilder().setColor(0x22d3ee).setTitle('✅ Verification ・ 認証 ・ 验证 ・ 인증')
    .setDescription([
      '🇯🇵 下のボタン → 言語を選択 → かんたんな人間確認。完了すると全チャンネルが表示されます。',
      '🇺🇸 Press the button → choose your language → quick human check to unlock the server.',
      '🇨🇳 点击下方按钮 → 选择语言 → 完成简单的人机验证，即可查看全部频道。',
      '🇰🇷 아래 버튼 → 언어 선택 → 간단한 사람 확인 후 모든 채널이 열립니다.',
      '',
      '🛡️ 認証でウォレット接続・署名・シードフレーズを求めることは**絶対にありません**。',
      '🛡️ Verification will **never** ask you to connect a wallet, sign, or enter a seed phrase.',
      '🛡️ 验证**绝不会**要求连接钱包、签名或输入助记词。',
      '🛡️ 인증 과정에서 지갑 연결·서명·시드 문구를 **절대** 요구하지 않습니다.',
    ].join('\n'))
    .setFooter({ text: 'zeronyth:verify ・ 3 failed tries = 10 min cooldown' });
}

export function welcomeEmbed(member, ch) {
  const v = ch.verify ? `<#${ch.verify.id}>` : '#verify', r = ch.rules ? `<#${ch.rules.id}>` : '#rules';
  return new EmbedBuilder().setColor(BRAND).setTitle('👋 Welcome to ZERONYTH!')
    .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
    .setDescription([
      `🇯🇵 ${member} さん、ようこそ！ ${r} を読んで ${v} で認証してください。`,
      `🇺🇸 Welcome ${member}! Read ${r}, then verify in ${v}.`,
      `🇨🇳 欢迎 ${member}！请阅读 ${r}，然后在 ${v} 完成验证。`,
      `🇰🇷 ${member} 님 환영합니다! ${r} 를 읽고 ${v} 에서 인증해 주세요.`,
      '',
      `🌐 ${ch.global ? `<#${ch.global.id}>` : '#global-chat'} — 全言語OK ・ All languages ・ 所有语言 ・ 모든 언어`,
      '🚰 `/faucet address:0x...` → 10 test ZNYT / 24h (no real value)',
      '☀️ GM daily → `/gm-streak`',
      LINKS,
      '⚠️ 運営からDMは送りません ・ The team never DMs first ・ 官方不会私信 ・ 운영진은 DM을 보내지 않습니다',
    ].join('\n'))
    .setFooter({ text: `Member #${member.guild.memberCount}` }).setTimestamp();
}

const ABOUT = {
  ja: ['ZERONYTH 公式コミュニティへようこそ', 'ZERONYTH は量子耐性署名 (ML-DSA-65) を備えたテストネットです。公式のお知らせはこのチャンネルだけで行います。\n☀️ gm ・ 🚰 faucet ・ 🖥️ node-runners ・ 🐞 bug-reports ・ 💡 feedback\nテストトークンに価値はありません。運営からDMは送りません。'],
  en: ['Welcome to the official ZERONYTH community', 'ZERONYTH is a testnet with quantum-resistant signatures (ML-DSA-65). Official news is posted only in this channel.\n☀️ gm ・ 🚰 faucet ・ 🖥️ node-runners ・ 🐞 bug-reports ・ 💡 feedback\nTest tokens have no real value. The team never DMs first.'],
  zh: ['欢迎来到 ZERONYTH 官方社区', 'ZERONYTH 是采用抗量子签名 (ML-DSA-65) 的测试网。官方公告仅在本频道发布。\n☀️ gm ・ 🚰 faucet ・ 🖥️ node-runners ・ 🐞 bug-reports ・ 💡 feedback\n测试代币没有实际价值。官方不会主动私信。'],
  ko: ['ZERONYTH 공식 커뮤니티에 오신 것을 환영합니다', 'ZERONYTH는 양자 내성 서명(ML-DSA-65)을 갖춘 테스트넷입니다. 공식 공지는 이 채널에서만 합니다.\n☀️ gm ・ 🚰 faucet ・ 🖥️ node-runners ・ 🐞 bug-reports ・ 💡 feedback\n테스트 토큰은 실제 가치가 없습니다. 운영진은 먼저 DM을 보내지 않습니다.'],
};
export function aboutEmbeds() {
  return LANGS.map((l, i) => new EmbedBuilder().setColor(BRAND).setTitle(`${LANG_META[l].flag} ${ABOUT[l][0]}`)
    .setDescription(ABOUT[l][1] + (i === 3 ? `\n\n${LINKS}` : '')).setFooter(i === 0 ? { text: 'zeronyth:about' } : null));
}
