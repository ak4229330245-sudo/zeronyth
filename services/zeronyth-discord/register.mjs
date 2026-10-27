// Registers global slash commands. Token from .env (DISCORD_TOKEN); never printed.
import { REST, Routes } from 'discord.js';
import { commands } from './commands.mjs';
const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error('DISCORD_TOKEN missing');
const rest = new REST({ version: '10' }).setToken(token);
const app = await rest.get(Routes.currentApplication());
const out = await rest.put(Routes.applicationCommands(app.id), { body: commands });
console.log(JSON.stringify({ applicationId: app.id, appName: app.name, registered: out.map((c) => `/${c.name}`) }));
