// Verification: Verify → language select → randomized human check (in that language) → Verified + language role.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits as P, StringSelectMenuBuilder } from 'discord.js';
import { randomInt, randomBytes } from 'node:crypto';
import { findRole, findChannel } from './layout.mjs';
import { LANGS, LANG_META, loc, t } from './i18n.mjs';
import state, { save } from './store.mjs';

const TTL = 60_000, MAX_FAIL = 3, COOLDOWN = 10 * 60_000, DAY = 86_400_000;
const NEW_ACCOUNT = 7 * DAY, REVIEW_ACCOUNT = DAY;
const sessions = new Map(); // uid -> { nonce, answer, exp, round, rounds, lang }
const fails = new Map();    // uid -> { n, until }
setInterval(() => { const n = Date.now(); for (const [k, s] of sessions) if (s.exp < n) sessions.delete(k); for (const [k, f] of fails) if (f.until && f.until < n) fails.delete(k); }, 60_000).unref();

// emoji, ja, en, zh, ko
const POOL = [['🍎', 'りんご', 'apple', '苹果', '사과'], ['🐱', 'ねこ', 'cat', '猫', '고양이'], ['🚀', 'ロケット', 'rocket', '火箭', '로켓'], ['🔑', 'かぎ', 'key', '钥匙', '열쇠'],
  ['🌙', 'つき', 'moon', '月亮', '달'], ['🍣', 'おすし', 'sushi', '寿司', '초밥'], ['🐶', 'いぬ', 'dog', '狗', '강아지'], ['⚡', 'かみなり', 'lightning', '闪电', '번개'],
  ['🌸', 'さくら', 'cherry blossom', '樱花', '벚꽃'], ['🎸', 'ギター', 'guitar', '吉他', '기타'], ['🍙', 'おにぎり', 'rice ball', '饭团', '주먹밥'], ['🐟', 'さかな', 'fish', '鱼', '물고기'],
  ['🗻', 'ふじさん', 'Mt. Fuji', '富士山', '후지산'], ['☕', 'コーヒー', 'coffee', '咖啡', '커피'], ['🎁', 'プレゼント', 'gift', '礼物', '선물']];
const PI = { ja: 1, en: 2, zh: 3, ko: 4 };
const WORDS = { ja: ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'], zh: ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'],
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'], ko: ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'] };
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const eph = (p) => ({ ...p, flags: MessageFlags.Ephemeral });
const box = (text, color = 0x22c55e) => ({ content: '', embeds: [new EmbedBuilder().setColor(color).setDescription(text)], components: [] });

export function langMenu(customId, l, current) {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(t(l, 'lang_ph')).setMinValues(1).setMaxValues(1)
    .addOptions(LANGS.map((x) => ({ label: LANG_META[x].label, value: x, emoji: LANG_META[x].flag, default: x === current }))));
}

function challenge(uid, lang, round, rounds) {
  const nonce = randomBytes(4).toString('hex');
  let prompt, labels, answer;
  if (randomInt(2) === 0) {
    const opts = shuffle([...POOL]).slice(0, 5); answer = randomInt(5);
    prompt = t(lang, 'chk_emoji', { x: opts[answer][PI[lang]] }); labels = opts.map((o) => ({ emoji: o[0] }));
  } else {
    const a = randomInt(1, 10), b = randomInt(1, 10), sum = a + b;
    prompt = t(lang, 'chk_math', { q: `${randomInt(2) ? WORDS[lang][a] : a} + ${randomInt(2) ? WORDS[lang][b] : b}` });
    const set = new Set([sum]); while (set.size < 5) { const d = sum + randomInt(-4, 5); if (d > 0) set.add(d); }
    const opts = shuffle([...set]); answer = opts.indexOf(sum); labels = opts.map((n) => ({ label: String(n) }));
  }
  sessions.set(uid, { nonce, answer, exp: Date.now() + TTL, round, rounds, lang });
  const row = new ActionRowBuilder().addComponents(labels.map((x, i) => {
    const b = new ButtonBuilder().setCustomId(`zv:a:${nonce}:${i}`).setStyle(ButtonStyle.Secondary);
    return x.emoji ? b.setEmoji(x.emoji) : b.setLabel(x.label);
  }));
  return { embeds: [new EmbedBuilder().setColor(0x22d3ee).setTitle(`${t(lang, 'chk_title')}${rounds > 1 ? ` (${round}/${rounds})` : ''}`).setDescription(`${prompt}\n\n${t(lang, 'chk_time')}`)], components: [row] };
}

export async function setLangRole(member, lang, reason) {
  const want = findRole(member.guild, 'lang_' + lang);
  const others = LANGS.filter((x) => x !== lang).map((x) => findRole(member.guild, 'lang_' + x)).filter((r) => r && member.roles.cache.has(r.id));
  if (others.length) await member.roles.remove(others, reason);
  if (want && !member.roles.cache.has(want.id)) await member.roles.add(want, reason);
}

export async function handleVerify(i, modLog) {
  const id = i.customId, uid = i.user.id, guild = i.guild;
  let l = sessions.get(uid)?.lang || loc(i.locale);
  const verified = findRole(guild, 'verified');
  const answer = (p) => (id === 'zv:start' ? i.reply(eph(p)) : i.update(p));
  if (!verified) return i.reply(eph({ content: t(l, 'setup_wait') }));
  if (id.startsWith('zv:ok:') || id.startsWith('zv:ng:')) return handleReview(i, verified);

  if (i.member.roles.cache.has(verified.id)) return answer(box(t(l, 'already')));
  const f = fails.get(uid);
  if (f?.until && f.until > Date.now()) return answer(box(t(l, 'cooldown', { t: `<t:${Math.floor(f.until / 1000)}:R>` }), 0xef4444));
  if (state.reviews[uid]) return answer(box(t(l, 'review_wait'), 0xf59e0b));

  const rounds = Date.now() - i.user.createdTimestamp < NEW_ACCOUNT ? 2 : 1;
  if (id === 'zv:start') { // step 1: language (preselected from Discord locale)
    sessions.set(uid, { lang: l, exp: Date.now() + 5 * TTL });
    return i.reply(eph({ embeds: [new EmbedBuilder().setColor(0x22d3ee).setTitle('🌐 Language ・ 言語 ・ 语言 ・ 언어').setDescription(LANGS.map((x) => `${LANG_META[x].flag} ${t(x, 'pick_lang')}`).join('\n'))],
      components: [langMenu('zv:lang', l, l)] }));
  }
  if (id === 'zv:lang') { l = i.values[0]; return i.update({ content: '', ...challenge(uid, l, 1, rounds) }); } // step 2: check in chosen language

  const [, , nonce, pick] = id.split(':');
  const s = sessions.get(uid);
  if (!s || s.nonce !== nonce) return i.update(box(t(l, 'expired'), 0xf59e0b));
  if (s.exp < Date.now()) { sessions.delete(uid); return i.update(box(t(l, 'timeout'), 0xf59e0b)); }
  l = s.lang;
  if (Number(pick) !== s.answer) {
    const n = (f?.n || 0) + 1;
    if (n >= MAX_FAIL) {
      sessions.delete(uid); fails.set(uid, { n: 0, until: Date.now() + COOLDOWN });
      modLog?.(guild, { title: '🧩 認証失敗 x3 / 3 failed checks', color: 0xf59e0b, user: i.user, text: '10 min cooldown' });
      return i.update(box(t(l, 'fail3'), 0xef4444));
    }
    fails.set(uid, { n });
    return i.update({ ...challenge(uid, l, 1, s.rounds), content: t(l, 'wrong', { n: MAX_FAIL - n }) });
  }
  if (s.round < s.rounds) return i.update({ ...challenge(uid, l, s.round + 1, s.rounds), content: t(l, 'one_more') });

  sessions.delete(uid); fails.delete(uid);
  if (Date.now() - i.user.createdTimestamp < REVIEW_ACCOUNT) {
    state.reviews[uid] = { at: Date.now(), lang: l }; save();
    await postReview(guild, i.user, l);
    return i.update(box(t(l, 'new_review'), 0xf59e0b));
  }
  await grant(i.member, verified, l, 'ZERONYTH verification passed');
  modLog?.(guild, { title: '✅ 認証完了 / Verified', color: 0x22c55e, user: i.user, text: `${LANG_META[l].flag} ${LANG_META[l].label} ・ account created <t:${Math.floor(i.user.createdTimestamp / 1000)}:R>${s.rounds > 1 ? ' ・ new account (2 checks)' : ''}` });
  const glb = findChannel(guild, 'global-chat'), gen = findChannel(guild, LANG_META[l].slug), gm = findChannel(guild, 'gm'), fc = findChannel(guild, 'faucet');
  return i.update(box(`${t(l, 'verified')}\n\n${[gen, gm, fc].filter(Boolean).join(' ・ ')}${glb ? `\n🌐 ${glb} — ${GLOBAL[l]}` : ''}\n\n/language → ${LANG_META[l].flag}`));
}

const GLOBAL = { ja: 'みんなで話せる全言語OKのチャット', en: 'where everyone can talk together in any language', zh: '所有语言都可以，大家一起聊天', ko: '모든 언어로 함께 이야기하는 곳' };
const HELLO = { ja: '👋 {u} さんが参加しました！ようこそ 🎉', en: '👋 {u} just joined — welcome! 🎉', zh: '👋 欢迎 {u} 加入！🎉', ko: '👋 {u} 님이 참여했습니다! 환영합니다 🎉' };
async function grant(member, verified, lang, reason) {
  await member.roles.add(verified, reason);
  await setLangRole(member, lang, reason).catch(() => {});
  const ch = findChannel(member.guild, LANG_META[lang].slug); // greet in the member's language channel (no DMs)
  if (ch) await ch.send({ content: HELLO[lang].replace('{u}', `${member}`), allowedMentions: { users: [member.id] } }).catch(() => {});
}

async function postReview(guild, user, lang) {
  const ch = findChannel(guild, 'mod-log'); if (!ch) return;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`zv:ok:${user.id}`).setLabel('承認 / Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`zv:ng:${user.id}`).setLabel('却下 / Reject').setStyle(ButtonStyle.Danger));
  const e = new EmbedBuilder().setColor(0xf59e0b).setTitle('🕵️ 手動確認 / Manual review')
    .setDescription(`${user} (\`${user.tag}\`, \`${user.id}\`) ${LANG_META[lang].flag}\n人間確認は通過 / passed the human check\nアカウント作成 / created <t:${Math.floor(user.createdTimestamp / 1000)}:R>`).setTimestamp();
  await ch.send({ embeds: [e], components: [row] }).catch(() => {});
}

async function handleReview(i, verified) {
  const l = loc(i.locale);
  const staff = i.member.permissions.has(P.ManageRoles) || ['mod', 'team'].some((k) => { const r = findRole(i.guild, k); return r && i.member.roles.cache.has(r.id); });
  if (!staff) return i.reply(eph({ content: t(l, 'mods_only') }));
  const [, act, uid] = i.customId.split(':');
  const lang = state.reviews[uid]?.lang || 'en';
  delete state.reviews[uid]; save();
  let result;
  if (act === 'ok') {
    const m = await i.guild.members.fetch(uid).catch(() => null);
    if (m) { await grant(m, verified, lang, `Manual review by ${i.user.tag}`); result = `✅ ${i.user} approved`; } else result = '⚠️ member left';
  } else { fails.set(uid, { n: 0, until: Date.now() + DAY }); result = `⛔ ${i.user} rejected (retry after 24h)`; }
  return i.update({ embeds: [EmbedBuilder.from(i.message.embeds[0]).addFields({ name: '結果 / Result', value: result })], components: [] });
}

// /language and its select menu
export async function handleLanguage(i) {
  const l = loc(i.locale), verified = findRole(i.guild, 'verified');
  if (!verified || !i.member.roles.cache.has(verified.id)) return i.reply(eph({ content: t(l, 'lang_need_verify') }));
  if (i.isChatInputCommand()) {
    const cur = LANGS.find((x) => { const r = findRole(i.guild, 'lang_' + x); return r && i.member.roles.cache.has(r.id); }) || l;
    return i.reply(eph({ content: t(cur, 'pick_lang'), components: [langMenu('zl:set', cur, cur)] }));
  }
  const lang = i.values[0];
  await setLangRole(i.member, lang, 'ZERONYTH /language');
  const gen = findChannel(i.guild, LANG_META[lang].slug);
  return i.update({ content: `${t(lang, 'lang_set', { l: `${LANG_META[lang].flag} ${LANG_META[lang].label}` })}${gen ? ` → ${gen}` : ''}`, components: [] });
}
