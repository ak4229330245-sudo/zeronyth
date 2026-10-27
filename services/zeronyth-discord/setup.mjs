// Idempotent server setup. Only creates/adjusts; never deletes.
import { PermissionFlagsBits as P, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { ROLES, CATEGORIES, chanName, findRole, findChannel, findCategory, overwritesFor, rulesEmbeds, verifyEmbed, aboutEmbeds } from './layout.mjs';

export const verifyRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('zv:start').setLabel('Verify ・ 認証 ・ 验证 ・ 인증').setEmoji('✅').setStyle(ButtonStyle.Success));

async function upsertPanel(channel, tag, payload, me, log) {
  const pins = await channel.messages.fetchPinned().catch(() => null);
  let msg = pins?.find((m) => m.author.id === me && m.embeds[0]?.footer?.text?.startsWith(tag));
  if (!msg) {
    const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    msg = recent?.find((m) => m.author.id === me && m.embeds[0]?.footer?.text?.startsWith(tag));
  }
  if (msg) { await msg.edit(payload); log.push(`panel updated: ${tag}`); }
  else { msg = await channel.send(payload); log.push(`panel posted: ${tag}`); }
  if (!msg.pinned) {
    await msg.pin().catch((e) => log.push(`pin failed ${tag}: ${e.message}`));
    const sys = await channel.messages.fetch({ limit: 5 }).catch(() => null);
    for (const m of sys?.values() ?? []) if (m.type === 6 && m.author.id === me) await m.delete().catch(() => {});
  }
  return msg;
}

export async function runSetup(guild, { grandfather = true } = {}) {
  const log = [];
  await guild.roles.fetch(); await guild.channels.fetch();
  const me = guild.members.me ?? await guild.members.fetchMe();

  // 1) Roles
  const r = {};
  for (const def of ROLES) {
    let role = findRole(guild, def.key);
    const perms = def.perms.reduce((a, b) => a | b, 0n);
    if (!role) { role = await guild.roles.create({ name: def.name, colors: { primaryColor: def.color }, hoist: def.hoist, mentionable: def.mentionable, permissions: perms, reason: 'ZERONYTH setup' }); log.push(`role created: ${def.name}`); }
    else if ((role.permissions.bitfield & perms) !== perms && role.editable) { await role.setPermissions(role.permissions.bitfield | perms, 'ZERONYTH setup'); log.push(`role perms adjusted: ${def.name}`); }
    r[def.key] = role;
  }
  // order roles under the bot: Team > Moderator > Validator > Node Runner > OG > Verified (handles position ties)
  const chain = [me.roles.highest, ...ROLES.map((d) => r[d.key])];
  if (chain.some((x, i) => i > 0 && x.position >= chain[i - 1].position)) {
    await guild.roles.setPositions(chain.map((x, i) => ({ role: x.id, position: chain.length - i })))
      .then(() => log.push('roles reordered')).catch((e) => log.push(`role order skipped (move the bot role to the top in Server Settings → Roles): ${e.message}`));
  }
  // 2) @everyone: unverified sees only start channels; nobody can @everyone by default
  const E = guild.roles.everyone;
  const strip = P.ViewChannel | P.MentionEveryone;
  if (E.permissions.bitfield & strip) { await E.setPermissions(E.permissions.bitfield & ~strip, 'ZERONYTH setup: verification gate'); log.push('@everyone: removed View Channels + Mention Everyone (gate)'); }

  // 3) Categories + channels
  const ch = {};
  for (const cat of CATEGORIES) {
    let parent = findCategory(guild, cat.key);
    const catAccess = cat.key === 'start' ? 'public-ro' : cat.key === 'staff' ? 'staff' : 'verified';
    const catOw = overwritesFor(catAccess, guild, r);
    if (!parent) { parent = await guild.channels.create({ name: cat.name, type: ChannelType.GuildCategory, permissionOverwrites: catOw, reason: 'ZERONYTH setup' }); log.push(`category created: ${cat.name}`); }
    else { await parent.permissionOverwrites.set(catOw, 'ZERONYTH setup'); }
    for (const c of cat.channels) {
      let channel = findChannel(guild, c.slug);
      const ow = overwritesFor(c.access, guild, r);
      if (!channel) {
        channel = await guild.channels.create({ name: chanName(c), type: ChannelType.GuildText, parent: parent.id, topic: c.topic, rateLimitPerUser: c.slowmode || 0, permissionOverwrites: ow, reason: 'ZERONYTH setup' });
        log.push(`channel created: ${channel.name}`);
      } else {
        await channel.edit({ name: chanName(c), parent: parent.id, topic: c.topic, rateLimitPerUser: c.slowmode || 0, permissionOverwrites: ow, reason: 'ZERONYTH setup' });
        log.push(`channel adjusted: ${channel.name}`);
      }
      ch[c.slug] = channel;
    }
  }
  // keep channel order inside categories
  await guild.channels.setPositions(CATEGORIES.flatMap((c) => c.channels).map((c, i) => ({ channel: ch[c.slug].id, position: i }))).catch((e) => log.push(`channel order skipped: ${e.message}`));
  // keep category order
  let pos = 0;
  await guild.channels.setPositions(CATEGORIES.map((c) => ({ channel: findCategory(guild, c.key).id, position: pos++ }))).catch((e) => log.push(`category order skipped: ${e.message}`));

  // 4) Guild settings: Discord's own join notice off (bot posts welcome), system channel → welcome
  const flags = (guild.systemChannelFlags?.bitfield ?? 0) | 1;
  await guild.edit({ systemChannel: ch.welcome.id, systemChannelFlags: flags, verificationLevel: Math.max(guild.verificationLevel, 1), explicitContentFilter: 2, reason: 'ZERONYTH setup' })
    .then(() => log.push('guild: system channel → welcome, join notice suppressed, verification level ≥ LOW, media filter ON')).catch((e) => log.push(`guild edit skipped: ${e.message}`));

  // 5) Panels
  await upsertPanel(ch.rules, 'zeronyth:rules', { embeds: rulesEmbeds() }, me.id, log);
  await upsertPanel(ch.verify, 'zeronyth:verify', { embeds: [verifyEmbed()], components: [verifyRow()] }, me.id, log);

  await upsertPanel(ch.announcements, 'zeronyth:about', { embeds: aboutEmbeds() }, me.id, log);

  // 6) Existing members keep access (grandfathered as Verified)
  if (grandfather) {
    const members = await guild.members.fetch().catch(() => null);
    let n = 0;
    if (members) for (const m of members.values()) {
      if (m.user.bot || m.roles.cache.has(r.verified.id)) continue;
      await m.roles.add(r.verified, 'ZERONYTH setup: existing member').then(() => n++).catch(() => {});
    }
    log.push(members ? `existing members given Verified: ${n}` : 'member list unavailable (Server Members intent?)');
  }
  return log;
}
