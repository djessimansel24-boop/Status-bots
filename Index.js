const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

// ============================================
// CONFIG
// ============================================
const DISCORD_TOKEN = 'MTQ3MzcxODg5MzQzOTYxNTA0OA.Gj8Y5O.cA3jaoLf29V8IXkg-pc5U5EGegXVswPnBU2lCU';
const STATUS_CHANNEL_ID = '1473713482267627733';

// Yummy API config
const YUMMY_PROXY_URL = 'https://yummytrackstat.com/api/proxy';
const YUMMY_AUTH_TOKEN = 'MTIxOTY3Njk3NTM3MTIxMTI1NTQ.yM0VI1QJDZrN2G1AOOlp8IqD1FduZe'; // ⚠️ VERIFIE CE TOKEN — copie-le depuis ton navigateur Network > Headers > Authorization (sans le "Bearer ")

// Bot power settings
const MAX_ONLINE = 780;          // 100% capacity
const ERROR_FACTOR = 0.80;       // 1/5 erreurs = max 80%
const REFRESH_INTERVAL = 30000;  // 30 seconds
const CHANNEL_RENAME_INTERVAL = 300000; // 5 min (Discord rate limit: 2 renames per 10 min)

// ============================================
// DISCORD CLIENT
// ============================================
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

let statusMessageId = null;
let botStatusMessageId = null;
let lastChannelRename = 0;

// ============================================
// FETCH YUMMY STATS
// ============================================
async function fetchYummyStats() {
    try {
        const response = await fetch(YUMMY_PROXY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${YUMMY_AUTH_TOKEN}`,
                'Accept': '*/*',
                'Origin': 'https://yummytrackstat.com',
                'Referer': 'https://yummytrackstat.com/yummy-auto'
            },
            body: JSON.stringify({
                subdomain: 'api',
                domain: 'yummyauto.app',
                uri: '/get-devices'
            })
        });

        if (!response.ok) {
            console.error(`[YUMMY] HTTP ${response.status}: ${response.statusText}`);
            return null;
        }

        const devices = await response.json();
        if (!Array.isArray(devices)) {
            console.error('[YUMMY] Response is not an array');
            return null;
        }

        // Aggregate stats
        let totalOnline = 0;
        let totalOffline = 0;
        let totalCookies = 0;
        let totalDeadCookies = 0;
        let totalDone = 0;
        let aliveDevices = 0;
        let deadDevices = 0;
        let totalEmulators = 0;
        let ingameCount = 0;
        const deviceDetails = [];

        for (const device of devices) {
            totalOnline += device.total_online || 0;
            totalOffline += device.total_offline || 0;
            totalCookies += device.total_cookie || 0;
            totalDeadCookies += device.total_deadcookie || 0;
            totalDone += device.total_done || 0;
            totalEmulators += (device.emulators || []).length;

            if (device.is_alive) {
                aliveDevices++;
            } else {
                deadDevices++;
            }

            // Count in-game emulators
            for (const emu of (device.emulators || [])) {
                if (emu.is_ingame) ingameCount++;
            }

            deviceDetails.push({
                note: device.note || 'Unknown',
                online: device.total_online || 0,
                offline: device.total_offline || 0,
                cookies: device.total_cookie || 0,
                dead: device.total_deadcookie || 0,
                alive: device.is_alive,
                ram: device.ram_usage || 'N/A'
            });
        }

        return {
            totalOnline,
            totalOffline,
            totalCookies,
            totalDeadCookies,
            totalDone,
            aliveDevices,
            deadDevices,
            totalDevices: devices.length,
            totalEmulators,
            ingameCount,
            deviceDetails
        };
    } catch (err) {
        console.error('[YUMMY] Fetch error:', err.message);
        return null;
    }
}

// ============================================
// CALCULATE POWER
// ============================================
function calculatePower(totalOnline) {
    const raw = (totalOnline / MAX_ONLINE) * 100 * ERROR_FACTOR;
    return Math.min(Math.round(raw * 10) / 10, 80); // Cap at 80%, 1 decimal
}

function getPowerEmoji(power) {
    if (power >= 56) return '🟢'; // 70% of 80 = 56
    if (power >= 40) return '🟡'; // 50% of 80 = 40
    return '🔴';
}

function getPowerLabel(power) {
    if (power >= 56) return 'Optimal';
    if (power >= 40) return 'Moderate';
    if (power >= 20) return 'Low';
    return 'Critical';
}

function getPowerColor(power) {
    if (power >= 56) return 0x00ff00; // Green
    if (power >= 40) return 0xffff00; // Yellow
    if (power >= 20) return 0xff8c00; // Orange
    return 0xff0000; // Red
}

// ============================================
// BUILD EMBED
// ============================================
function buildStatusEmbed(stats) {
    const power = calculatePower(stats.totalOnline);
    const emoji = getPowerEmoji(power);
    const label = getPowerLabel(power);
    const color = getPowerColor(power);
    const now = new Date();
    const timeStr = now.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });

    const embed = new EmbedBuilder()
        .setColor(color)
        .setDescription(
            `📊 **Scarface Notifier Status**\n` +
            `🔴 **Notifier Status**\n` +
            `\`\`\`\n${emoji} ONLINE\n\`\`\`\n` +
            `🤖 **Bot Power**\n` +
            `\`\`\`\n${emoji} ${power}% • ${label}\n\`\`\`\n` +
            `*Last Updated | Aujourd'hui à ${timeStr}*`
        );

    // Simple bot status message content
    const statusText = `${emoji} **Bot Status**\n**${power}%** power`;

    return { embed, power, statusText };
}

// ============================================
// UPDATE STATUS
// ============================================
async function updateStatus() {
    try {
        const channel = await client.channels.fetch(STATUS_CHANNEL_ID);
        if (!channel) {
            console.error('[STATUS] Channel not found');
            return;
        }

        // Fetch stats from Yummy
        const stats = await fetchYummyStats();
        if (!stats) {
            console.log('[STATUS] No stats available, skipping update');
            return;
        }

        const { embed, power, statusText } = buildStatusEmbed(stats);
        const emoji = getPowerEmoji(power);

        // Edit existing message or send new one
        if (statusMessageId) {
            try {
                const msg = await channel.messages.fetch(statusMessageId);
                await msg.edit({ embeds: [embed] });
                console.log(`[STATUS] Updated embed | Power: ${power}% | Online: ${stats.totalOnline}`);
            } catch (e) {
                console.log('[STATUS] Message not found, sending new one');
                const newMsg = await channel.send({ embeds: [embed] });
                statusMessageId = newMsg.id;
            }
        } else {
            // First run: look for our last messages or send new
            const messages = await channel.messages.fetch({ limit: 10 });
            const botMsgs = messages.filter(m => m.author.id === client.user.id).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            
            if (botMsgs.size >= 2) {
                // We have both messages already
                const arr = [...botMsgs.values()];
                statusMessageId = arr[0].id;
                botStatusMessageId = arr[1].id;
                await arr[0].edit({ embeds: [embed] });
                await arr[1].edit({ content: statusText });
                console.log('[STATUS] Found existing messages, updated');
            } else if (botMsgs.size === 1) {
                const arr = [...botMsgs.values()];
                statusMessageId = arr[0].id;
                await arr[0].edit({ embeds: [embed] });
                const newMsg = await channel.send({ content: statusText });
                botStatusMessageId = newMsg.id;
            } else {
                const newMsg = await channel.send({ embeds: [embed] });
                statusMessageId = newMsg.id;
                const newMsg2 = await channel.send({ content: statusText });
                botStatusMessageId = newMsg2.id;
                console.log('[STATUS] Sent new status messages');
            }
        }

        // Update bot status text
        if (botStatusMessageId) {
            try {
                const msg2 = await channel.messages.fetch(botStatusMessageId);
                await msg2.edit({ content: statusText });
            } catch (e) {
                const newMsg2 = await channel.send({ content: statusText });
                botStatusMessageId = newMsg2.id;
            }
        }

        // Rename channel (rate limited to every 5 min)
        const now = Date.now();
        if (now - lastChannelRename > CHANNEL_RENAME_INTERVAL) {
            const expectedName = `${emoji}┃status`;
            if (channel.name !== expectedName) {
                try {
                    await channel.setName(expectedName);
                    lastChannelRename = now;
                    console.log(`[STATUS] Channel renamed to: ${expectedName}`);
                } catch (e) {
                    console.error('[STATUS] Channel rename failed:', e.message);
                }
            } else {
                lastChannelRename = now;
            }
        }
    } catch (err) {
        console.error('[STATUS] Update error:', err.message);
    }
}

// ============================================
// START BOT
// ============================================
client.once('ready', () => {
    console.log(`[BOT] Logged in as ${client.user.tag}`);
    console.log(`[BOT] Monitoring channel: ${STATUS_CHANNEL_ID}`);
    console.log(`[BOT] Refresh interval: ${REFRESH_INTERVAL / 1000}s`);
    console.log(`[BOT] Max online: ${MAX_ONLINE} | Error factor: ${ERROR_FACTOR} | Max power: ${MAX_ONLINE * ERROR_FACTOR}`);

    // Initial update
    updateStatus();

    // Periodic updates
    setInterval(updateStatus, REFRESH_INTERVAL);
});

client.login(DISCORD_TOKEN);
