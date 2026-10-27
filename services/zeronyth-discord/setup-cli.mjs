import { Client, GatewayIntentBits, Options } from 'discord.js';
import { runSetup } from './setup.mjs';
const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers], makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 5 }) });
c.once('clientReady', async () => { for (const g of c.guilds.cache.values()) { console.log('guild', g.name); try { console.log((await runSetup(g)).join('\n')); } catch (e) { console.log('SETUP ERROR', e.message, JSON.stringify(e.rawError || '')); } } await c.destroy(); process.exit(0); });
c.login(process.env.DISCORD_TOKEN || process.env.ZERONYTH_DISCORD_BOT_TOKEN);
