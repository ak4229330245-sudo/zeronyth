import { Client, GatewayIntentBits, EmbedBuilder, Events, MessageFlags, Options, PermissionFlagsBits as P } from 'discord.js';
import { fetchStatus, statusFields, overallOk, claimFaucet, isAddress, EXPLORER } from './lib.mjs';
import { findRole, findChannel, welcomeEmbed } from './layout.mjs';
import { runSetup } from './setup.mjs';
import { handleVerify, handleLanguage } from './verify.mjs';
import { loc, t } from './i18n.mjs';
import { onGmMessage, streakEmbed, leaderboardEmbed } from './gm.mjs';
import { moderate, makeModLog } from './mod.mjs';
import { flush } from './store.mjs';

const token = process.env.DISCORD_TOKEN;
if (!token) { console.error('[zeronyth-discord] DISCORD_TOKEN missing'); process.exit(1); }
const log = (...a) => console.log(new Date().toISOString(), '[zeronyth-discord]', ...a);
const modLog = makeModLog();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  allowedMentions: { parse: ['users'] },
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 0, ReactionManager: 0, PresenceManager: 0, VoiceStateManager: 0, GuildEmojiManager: 0, GuildStickerManager: 0,
    GuildInviteManager: 0, GuildScheduledEventManager: 0, StageInstanceManager: 0, ThreadMemberManager: 0, AutoModerationRuleManager: 0,
    GuildMemberManager: { maxSize: 200, keepOverLimit: (m) => m.id === m.client.user.id },
    UserManager: { maxSize: 200, keepOverLimit: (u) => u.id === u.client.user.id },
  }),
  sweepers: { ...Options.DefaultSweeperSettings, users: { interval: 3600, filter: () => (u) => u.id !== u.client.user.id } },
});

function statusEmbed(s, l = 'ja') {
  const ok = overallOk(s);
  return new EmbedBuilder().setTitle(t(l, 'st_title')).setURL(EXPLORER + '/').setColor(ok ? 0x22c55e : 0xef4444)
    .setDescription(t(l, ok ? 'st_ok' : 'st_ng'))
    .addFields(statusFields(s), { name: '🔍 Explorer', value: `[scan.zeronyth.dpdns.org](${EXPLORER}/)` })
    .setFooter({ text: 'ZERONYTH (chain 912701 / ZNYT) ・ Falcon-1024 QBFT' }).setTimestamp(new Date(s.at));
}

// Auto-updated status message in #chain-status (one message, edited every 5 min)
const statusMsg = new Map();
async function updateChainStatus() {
  for (const guild of client.guilds.cache.values()) {
    const ch = findChannel(guild, 'chain-status'); if (!ch) continue;
    try {
      const embed = statusEmbed(await fetchStatus()).setFooter({ text: 'zeronyth:chain-status ・ 5分ごとに自動更新 / auto-updates every 5 min' });
      let m = statusMsg.get(guild.id);
      if (!m) { const recent = await ch.messages.fetch({ limit: 10 }); m = recent.find((x) => x.author.id === client.user.id && x.embeds[0]?.footer?.text?.startsWith('zeronyth:chain-status')); }
      if (m) await m.edit({ embeds: [embed] }); else m = await ch.send({ embeds: [embed] });
      statusMsg.set(guild.id, { id: m.id, edit: (p) => ch.messages.edit(m.id, p) });
    } catch (e) { statusMsg.delete(guild.id); log('chain-status update failed', String(e?.message || e)); }
  }
}

client.once(Events.ClientReady, (c) => {
  log(`LOGGED_IN as ${c.user.tag} (id ${c.user.id}) guilds=${c.guilds.cache.size}`);
  c.user.setPresence({ activities: [{ name: '/status ・ /faucet ・ /language ・ gm ☀️', type: 3 }], status: 'online' });
  setTimeout(updateChainStatus, 5_000); setInterval(updateChainStatus, 5 * 60_000).unref();
});

async function handleFaucet(i) {
  const l = loc(i.locale), verified = findRole(i.guild, 'verified');
  if (!verified || !(i.member.roles.cache.has(verified.id) || i.member.permissions.has(P.Administrator)))
    return i.reply({ content: t(l, 'f_verify', { v: `${findChannel(i.guild, 'verify') ?? '#verify'}` }), flags: MessageFlags.Ephemeral });
  const address = (i.options.getString('address', true) || '').trim();
  if (!isAddress(address)) return i.reply({ content: t(l, 'f_bad'), flags: MessageFlags.Ephemeral });
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const r = await claimFaucet(address, i.user.id);
  log(`faucet user=${i.user.id} result=${r.kind}${r.code ? '/' + r.code : ''}`);
  const next = r.nextClaimAt ? `<t:${Math.floor(new Date(r.nextClaimAt).getTime() / 1000)}:f>` : (r.nextClaimAtJst || t(l, 'in24h'));
  if (r.kind === 'ok') {
    const embed = new EmbedBuilder().setTitle(t(l, 'f_ok')).setColor(0x22c55e)
      .addFields(
        { name: t(l, 'f_addr'), value: `\`${r.address}\`` },
        { name: t(l, 'f_amt'), value: `${r.amount} ZNYT`, inline: true },
        { name: t(l, 'f_next'), value: next, inline: true },
        { name: t(l, 'f_tx'), value: `[\`${r.txHash}\`](${EXPLORER}/tx/${r.txHash})` },
      ).setFooter({ text: t(l, 'f_foot') }).setTimestamp();
    return i.editReply({ embeds: [embed] });
  }
  if (r.kind === 'cooldown') {
    const n = r.nextClaimAtJst || t(l, 'in24h');
    const key = { cooldown_ip: 'f_cd_user', cooldown_address: 'f_cd_addr', daily_cap: 'f_cap' }[r.code] || 'f_cd_user';
    return i.editReply({ content: t(l, key, { n }) });
  }
  const key = { bad_address: 'f_bad', busy_or_funded: 'f_busy', unavailable: 'f_unavail', down: 'f_down' }[r.kind];
  return i.editReply({ content: key ? t(l, key) : t(l, 'f_err', { s: r.status ?? '?' }) });
}

async function handleSetup(i) {
  if (!i.member.permissions.has(P.Administrator)) return i.reply({ content: t(loc(i.locale), 'admin_only'), flags: MessageFlags.Ephemeral });
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const steps = await runSetup(i.guild, { grandfather: i.options.getBoolean('grandfather') ?? true });
  log('setup ran by', i.user.id, steps.length, 'steps');
  modLog(i.guild, { title: '⚙️ /setup 実行', user: i.user, text: steps.join('\n').slice(0, 3900) });
  await updateChainStatus();
  return i.editReply({ content: ('✅ セットアップ完了 / Setup done\n```\n' + steps.join('\n')).slice(0, 1990) + '\n```' });
}

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (!i.inGuild()) return;
    if ((i.isButton() || i.isStringSelectMenu()) && i.customId.startsWith('zv:')) return await handleVerify(i, modLog);
    if (i.isStringSelectMenu() && i.customId === 'zl:set') return await handleLanguage(i);
    if (!i.isChatInputCommand()) return;
    const l = loc(i.locale);
    if (i.commandName === 'status') { await i.deferReply(); await i.editReply({ embeds: [statusEmbed(await fetchStatus(), l)] }); }
    else if (i.commandName === 'faucet') await handleFaucet(i);
    else if (i.commandName === 'gm-streak') await i.reply({ embeds: [streakEmbed(i.options.getUser('user') || i.user, i.guildId, l)] });
    else if (i.commandName === 'gm-leaderboard') await i.reply({ embeds: [leaderboardEmbed(i.guildId, l)], allowedMentions: { parse: [] } });
    else if (i.commandName === 'language') await handleLanguage(i);
    else if (i.commandName === 'setup') await handleSetup(i);
  } catch (e) {
    log('interaction error', i.commandName || i.customId, String(e?.message || e));
    const content = t(loc(i.locale), 'error');
    try { if (i.deferred || i.replied) await i.editReply({ content, embeds: [], components: [] }); else await i.reply({ content, flags: MessageFlags.Ephemeral }); } catch {}
  }
});

client.on(Events.MessageCreate, async (msg) => {
  try {
    if (!msg.guild || msg.author.bot) return;
    if (await moderate(msg, modLog)) return;
    const art = findChannel(msg.guild, 'art-gallery');
    if (art && msg.channelId === art.id && (msg.attachments.some((a) => /^image\//.test(a.contentType || '') || /\.(png|jpe?g|gif|webp|avif)$/i.test(a.name || '')) || msg.embeds.some((e) => e.image || e.thumbnail) || /\.(png|jpe?g|gif|webp)(\?\S*)?(\s|$)|tenor\.com|giphy\.com/i.test(msg.content || ''))) {
      for (const r of ['❤️', '🔥']) await msg.react(r).catch(() => {});
    }
    const gm = findChannel(msg.guild, 'gm');
    if (gm && msg.channelId === gm.id) await onGmMessage(msg);
  } catch (e) { log('message error', String(e?.message || e)); }
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    if (member.user.bot) return;
    const g = member.guild, ch = { welcome: findChannel(g, 'welcome'), verify: findChannel(g, 'verify'), rules: findChannel(g, 'rules'), faucet: findChannel(g, 'faucet'), global: findChannel(g, 'global-chat') };
    if (ch.welcome) await ch.welcome.send({ content: `${member}`, embeds: [welcomeEmbed(member, ch)], allowedMentions: { users: [member.id] } });
    const ageDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
    modLog(g, { title: '📥 参加 / Joined', color: ageDays < 7 ? 0xf59e0b : 0x64748b, user: member.user, text: `アカウント作成 <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>${ageDays < 7 ? ' ⚠️ 新規アカウント' : ''}` });
  } catch (e) { log('welcome error', String(e?.message || e)); }
});
client.on(Events.GuildMemberRemove, (m) => { if (!m.user?.bot) modLog(m.guild, { title: '📤 退出 / Left', user: m.user }); });

client.on(Events.Error, (e) => log('client error', String(e?.message || e)));
process.on('unhandledRejection', (e) => log('unhandledRejection', String(e?.message || e)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { log('shutdown', sig); flush(); client.destroy().finally(() => process.exit(0)); });

client.login(token).catch((e) => { log('LOGIN_FAILED', String(e?.message || e)); process.exit(1); });
