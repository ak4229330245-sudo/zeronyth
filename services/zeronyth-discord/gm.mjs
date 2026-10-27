// GM: ☀️ reaction + daily streaks (1 per user per JST day).
import { EmbedBuilder } from 'discord.js';
import state, { save } from './store.mjs';
import { t } from './i18n.mjs';
const GM_RE = /^(?:\s|[*_~])*(?:g+m+|gmgm|good\s*morning|おは(?:よう|よ)|ｇｍ|早安|早上好|좋은\s*아침|굿모닝|굿모닝)(?![a-z0-9])/i;
export const isGm = (t) => GM_RE.test(t || '');
const jstDay = (ms = Date.now()) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
const prevDay = (d) => new Date(Date.parse(d + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);

function book(gid) { return (state.gm[gid] ||= {}); }
export function recordGm(gid, uid) {
  const b = book(gid), today = jstDay(), u = (b[uid] ||= { streak: 0, best: 0, total: 0, last: null });
  if (u.last === today) return { counted: false, ...u };
  u.streak = u.last === prevDay(today) ? u.streak + 1 : 1;
  u.best = Math.max(u.best, u.streak); u.total += 1; u.last = today; save();
  return { counted: true, ...u };
}
export function activeStreak(u) { if (!u) return 0; const t = jstDay(); return u.last === t || u.last === prevDay(t) ? u.streak : 0; }

export async function onGmMessage(msg) {
  if (!isGm(msg.content)) return;
  const r = recordGm(msg.guildId, msg.author.id);
  await msg.react('☀️').catch(() => {});
  if (r.counted && r.streak > 1 && r.streak % 7 === 0) await msg.react('🔥').catch(() => {});
}

export function streakEmbed(user, gid, l) {
  const u = book(gid)[user.id], s = activeStreak(u), today = u?.last === jstDay();
  return new EmbedBuilder().setColor(0xfbbf24).setTitle(t(l, 'gm_title', { u: user.displayName ?? user.username }))
    .addFields({ name: t(l, 'gm_streak'), value: t(l, 'days', { n: s }), inline: true }, { name: t(l, 'gm_best'), value: t(l, 'days', { n: u?.best || 0 }), inline: true }, { name: t(l, 'gm_total'), value: t(l, 'times', { n: u?.total || 0 }), inline: true })
    .setFooter({ text: t(l, today ? 'gm_done' : 'gm_notyet') });
}
export function leaderboardEmbed(gid, l) {
  const rows = Object.entries(book(gid)).map(([id, u]) => ({ id, s: activeStreak(u), t: u.total })).filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || b.t - a.t).slice(0, 10);
  const medal = ['🥇', '🥈', '🥉'];
  return new EmbedBuilder().setColor(0xfbbf24).setTitle(t(l, 'lb_title'))
    .setDescription(rows.length ? rows.map((r, i) => `${medal[i] || `**${i + 1}.**`} <@${r.id}> — 🔥 ${t(l, 'lb_row', { s: r.s, t: r.t })}`).join('\n') : t(l, 'lb_empty'))
    .setFooter({ text: t(l, 'lb_foot') });
}
