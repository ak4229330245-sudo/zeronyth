// Anti-spam / scam filter + mod-log.
import { EmbedBuilder, PermissionFlagsBits as P } from 'discord.js';
import { findChannel, findRole } from './layout.mjs';
import { t, LANGS, LANG_META } from './i18n.mjs';

const INVITE = /(discord(?:app)?\.(?:gg|io|me|li|com\/invite)|dsc\.gg|discord\.com\/invite|invite\.gg)\/\S+/i;
const LINK = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]{2,}\.(?:xyz|top|click|live|site|online|app|io|org|net|com|gift|claims?|link|finance)\b\S*/i;
const LOOKALIKE = /\b(?:d[il1]sc[o0]rd[a-z-]*|dlscord|discorde|steamcommunlty|steamcommunity-[a-z]+|metamask-[a-z]+|wallet-?connect[a-z-]*)\.(?!com\b|gg\b)[a-z]{2,}/i;
const SCAM_WORDS = [
  /air\s*-?\s*drop|エアドロ/i, /claim\s*(?:your|now|here|reward|token|free)|今すぐ受け取|受け取り(?:はこちら|リンク)/i, /free\s*nitro|nitro\s*(?:gift|free)|無料\s*nitro/i,
  /connect\s*(?:your\s*)?wallet|wallet\s*connect|ウォレット(?:を)?接続/i, /seed\s*phrase|recovery\s*phrase|シードフレーズ|秘密鍵/i,
  /validate\s*(?:your\s*)?wallet|wallet\s*(?:sync|validation|rectif)/i, /mint\s*(?:is\s*)?live|free\s*mint/i, /support\s*ticket|open\s*a\s*ticket/i,
  /\bgiveaway\b|プレゼント企画/i, /\bdm\s*me\b|dmください/i,
];
const scamScore = (t) => SCAM_WORDS.reduce((n, re) => n + (re.test(t) ? 1 : 0), 0);

const OFFICIAL = /https?:\/\/(?:[a-z0-9-]+\.)*(?:zeronyth\.dpdns\.org|github\.com|x\.com|twitter\.com|(?:cdn|media|images-ext-\d+)\.discordapp\.(?:com|net)|tenor\.com|giphy\.com)(?![a-z0-9.-])\S*/gi;
export function classify(msg) {
  const raw = msg.content || '';
  if (/@(?:everyone|here)/.test(raw)) return 'mass_mention';
  const t = raw.replace(OFFICIAL, ' ');
  if (INVITE.test(t)) return 'invite_link';
  if (LOOKALIKE.test(t)) return 'phishing_link';
  if (LINK.test(t) && scamScore(t) >= 1) return 'scam_link';
  if (scamScore(t) >= 3) return 'scam_text';
  if (msg.mentions.users.size + msg.mentions.roles.size >= 6) return 'mention_spam';
  return null;
}
const REASON_I18N = {
  ja: { mass_mention: '@everyone/@here は禁止', invite_link: '招待リンクは禁止', phishing_link: '偽サイトの疑い', scam_link: '詐欺の疑いがあるリンク', scam_text: '詐欺の疑い', mention_spam: 'メンションが多すぎます', flood: '連投', duplicate: '同じメッセージの連投' },
  en: { mass_mention: 'mass mentions are not allowed', invite_link: 'invite links are not allowed', phishing_link: 'suspected phishing link', scam_link: 'suspected scam link', scam_text: 'suspected scam', mention_spam: 'too many mentions', flood: 'flooding', duplicate: 'repeated message' },
  zh: { mass_mention: '禁止 @everyone/@here', invite_link: '禁止邀请链接', phishing_link: '疑似钓鱼链接', scam_link: '疑似诈骗链接', scam_text: '疑似诈骗', mention_spam: '提及过多', flood: '刷屏', duplicate: '重复消息' },
  ko: { mass_mention: '@everyone/@here 금지', invite_link: '초대 링크 금지', phishing_link: '피싱 의심 링크', scam_link: '사기 의심 링크', scam_text: '사기 의심', mention_spam: '멘션이 너무 많음', flood: '도배', duplicate: '같은 메시지 반복' },
};
const REASON = {
  mass_mention: '@everyone / @here は禁止 / Mass mentions are not allowed',
  invite_link: '招待リンクは禁止 / Invite links are not allowed',
  phishing_link: '偽サイトの疑いがあるリンク / Suspected phishing link',
  scam_link: '詐欺の疑いがあるリンク / Suspected scam link',
  scam_text: '詐欺の疑いがあるメッセージ / Suspected scam message',
  mention_spam: 'メンションが多すぎます / Too many mentions',
  flood: '連投（レート制限） / Flooding (rate limit)',
  duplicate: '同じメッセージの連投 / Repeated message',
};

const recent = new Map(); // uid -> [{t, h}]
const strikes = new Map(); // uid -> { n, last, level }
setInterval(() => { const t = Date.now(); for (const [k, v] of recent) if (!v.length || t - v[v.length - 1].t > 60_000) recent.delete(k); for (const [k, v] of strikes) if (t - v.last > 3_600_000) strikes.delete(k); }, 60_000).unref();

function rate(msg) {
  const now = Date.now(), h = (msg.content || '').trim().toLowerCase().slice(0, 200);
  const arr = (recent.get(msg.author.id) || []).filter((x) => now - x.t < 30_000);
  arr.push({ t: now, h }); recent.set(msg.author.id, arr);
  if (arr.filter((x) => now - x.t < 8_000).length > 6) return 'flood';
  if (h.length >= 6 && arr.filter((x) => x.h === h).length >= 3) return 'duplicate';
  return null;
}

export function isStaff(member) {
  if (!member) return false;
  if (member.permissions.has(P.ManageMessages) || member.permissions.has(P.Administrator)) return true;
  return ['mod', 'team'].some((k) => { const r = findRole(member.guild, k); return r && member.roles.cache.has(r.id); });
}

let lastNotice = 0;
export function makeModLog() {
  return async (guild, { title, color = 0x64748b, user, text, fields = [] }) => {
    const ch = findChannel(guild, 'mod-log'); if (!ch) return;
    const e = new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
    if (user) e.setAuthor({ name: `${user.tag} (${user.id})`, iconURL: user.displayAvatarURL({ size: 64 }) });
    if (text) e.setDescription(text);
    if (fields.length) e.addFields(fields);
    await ch.send({ embeds: [e], allowedMentions: { parse: [] } }).catch(() => {});
  };
}

export async function moderate(msg, modLog) {
  if (!msg.guild || msg.author.bot || msg.webhookId) return false;
  const member = msg.member; if (isStaff(member)) return false;
  const kind = classify(msg) || rate(msg); if (!kind) return false;
  await msg.delete().catch(() => {});
  const s = strikes.get(msg.author.id) || { n: 0, last: 0, level: 0 };
  const serious = ['phishing_link', 'scam_link', 'scam_text', 'mass_mention', 'invite_link'].includes(kind);
  s.n += serious ? 2 : 1; s.last = Date.now();
  let action = '削除 / deleted';
  if (s.n >= 3 && member?.moderatable) {
    const mins = [10, 60, 24 * 60][Math.min(s.level, 2)]; s.level += 1; s.n = 0;
    await member.timeout(mins * 60_000, `ZERONYTH auto-mod: ${kind}`).then(() => { action = `削除 + タイムアウト ${mins >= 60 ? mins / 60 + '時間' : mins + '分'} / timeout ${mins}m`; }).catch(() => {});
  }
  strikes.set(msg.author.id, s);
  const excerpt = (msg.content || '').replace(/`/g, 'ˋ').slice(0, 400) || '(no text)';
  modLog(msg.guild, { title: `🛡️ Auto-mod: ${kind}`, color: 0xef4444, user: msg.author, text: `${REASON[kind]}\nチャンネル: ${msg.channel}\n対応: ${action}`, fields: [{ name: '内容 / Content', value: '```\n' + excerpt + '\n```' }] });
  if (Date.now() - lastNotice > 5_000) {
    lastNotice = Date.now();
    const cl = LANGS.find((x) => msg.channel.name?.endsWith(LANG_META[x].slug));
    const content = cl ? t(cl, 'mod_del', { u: `${msg.author}`, r: REASON_I18N[cl][kind] }) : `⚠️ ${msg.author} — ${['ja', 'en', 'zh', 'ko'].map((x) => REASON_I18N[x][kind]).join(' ・ ')}`;
    const n = await msg.channel.send({ content, allowedMentions: { users: [msg.author.id] } }).catch(() => null);
    if (n) setTimeout(() => n.delete().catch(() => {}), 8_000).unref();
  }
  return true;
}
