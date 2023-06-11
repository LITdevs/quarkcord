require("dotenv").config();

const { Client, GatewayIntentBits } = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessages] });
const axios = require('axios');
const WebSocket = require('ws');

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

async function obtainLqToken() {
    try {
        let res = await axios.post("https://equinox.litdevs.org/v1/auth/token", {email: process.env.LQ_EMAIL, password: process.env.LQ_PASS});
        return res.data.response.access_token;
    } catch (e) {
        console.error(e.status);
    }
}

let lqToken = obtainLqToken();

async function obtainLqUser() {
    try {
        let res = await axios.get("https://equinox.litdevs.org/v1/user/me", {headers: {"Authorization": `Bearer ${await lqToken}`}});
        return res.data.response.jwtData;
    } catch (e) {
        console.error(e.status);
    }
}

let lqUser = obtainLqUser();

let gatewayConnection

async function openGateway() {
    gatewayConnection = new WebSocket("wss://equinox-gateway.litdevs.org", await lqToken);
    registerGatewayEvents();
}

let heartbeatInterval
function registerGatewayEvents() {
    gatewayConnection.on('open', () => {
        console.log("Connected to gateway");
        channelMap.forEach(channelMapping => {
            gatewayConnection.send(JSON.stringify({
                "event": "subscribe",
                "message": `channel_${channelMapping.lightquark}`
            }));
        });
        heartbeatInterval = setInterval(() => {
            gatewayConnection.send(JSON.stringify({
                "event": "heartbeat",
                "message": "hb"
            }))
        }, 20000)
    });

    gatewayConnection.on('message', async (data) => {
        let message = JSON.parse(data);
        switch (message.eventId) {
            case "messageCreate":
                if (message.author._id === (await lqUser)._id && message.message?.specialAttributes?.length > 0) return;
                let channelMapping = channelMap.find(c => c.lightquark === message.message.channelId);
                if (!channelMapping) return;
                let channel = await client.channels.fetch(channelMapping.discord);
                if (!channel) return;
                let webhooks = await channel.fetchWebhooks();
                let webhook = webhooks.find(w => w.name === "Quarkcord Dev");
                if (!webhook) webhook = await channel.createWebhook({name: "Quarkcord Dev", avatar: "https://ems-api.litdevs.org/v1/pm2/icon/quarkcord-dev"});
                let attachmentString = ""
                message.message.attachments.forEach(a => {
                    attachmentString += `\n${a}`
                })
        let plaintextContent
        if (message?.message?.specialAttributes?.some(a => a.type === "clientAttributes")) {
            plaintextContent = message.message.specialAttributes.find(a => a.type === "clientAttributes")?.plaintext;
        }
                let emoteRegex = /<(?<emoteName>[^:\s]+):(?<emoteId>[a-f0-9]+)>/gm;
                message.message.content = message.message.content.replace(emoteRegex, (match, emoteName, emoteId) => {
                    return `https://equinox.litdevs.org/v2/quark/emotes/${emoteId}/image`
                });
                plaintextContent = plaintextContent?.replace(emoteRegex, (match, emoteName, emoteId) => {
                    return `https://equinox.litdevs.org/v2/quark/emotes/${emoteId}/image`
                });
                await webhook.send({
                    content: `${message.message.content}${plaintextContent && plaintextContent !== message.message.content ? "\n||" + plaintextContent + "||" : ""}${attachmentString.length > 0 ? `\n\nAttachments:${attachmentString}` : "" }`,
                    allowedMentions: { parse: [] },
                    username: `${message.author.username} via ${message.message.ua} (Dev network)`,
                    avatarURL: `${message.author.avatarUri}?format=png`
                }).catch((e) => console.log(e))
            break;

        }
    });

    gatewayConnection.on('close', () => {
        process.exit(1);
    });

    gatewayConnection.on("error", (e) => {
        console.error(e);
    });

}

openGateway();

async function transformToLq(message) {
    if (message.content.length === 0 && message.attachments.size === 0) return;
    let lqMessageEvent = {
        content: message.content,
        specialAttributes: [{
            type: "botMessage",
            username: message.author.username,
            avatarUri: message.author.avatarURL({ size: 128 })
        }]
    };

    const handleAttachment = async (attachment) => {
        let res = await axios.get(attachment.url, { responseType: 'arraybuffer' });
        let data = Buffer.from(res.data, 'binary').toString('base64');
        return data;
    }
    if (message.attachments.size > 0) {
        lqMessageEvent.attachments = await Promise.all(message.attachments.map(async attachment => {
            if (attachment.size > 25000000) return;
            return {
                filename: attachment.name,
                data: await handleAttachment(attachment)
            };
        }));
    }

    return lqMessageEvent;
}

const trackingGuild = "868937321402204220"
const channelMap = [
    {
        discord: "1020209219472990228",
        lightquark: "643aa2e550c913775aec2057"
    },
    {
        discord: "951924511509471293",
        lightquark: "643aa31450c913775aec2082"
    },
    {
        discord: "1051255515176513646",
        lightquark: "643aa32c50c913775aec20a2"
    },
    {
        discord: "997976909596086292",
        lightquark: "643aa31f50c913775aec2092"
    }
]

client.on('messageCreate', async message => {
    if (message.guild.id !== trackingGuild) return;
    let channelMapping = channelMap.find(c => c.discord === message.channel.id);
    if (!channelMapping) return;


    if (message.webhookId) {
        let webhooks = await message.channel.fetchWebhooks();
        let webhook = webhooks.find(w => w.name === "Quarkcord Dev");
        console.log(typeof webhook.id, typeof message.webhookId)
        console.log("Are equal?", webhook.id === message.webhookId)
        if (webhook.id == message.webhookId) return;
    }
    if(message.author.id === client.user.id) return;

    const lqMessageEvent = await transformToLq(message); 
    const lqApiUrl = `https://equinox.litdevs.org/v2/channel/${channelMapping.lightquark}/messages`;

    try {
        await axios({
            method: "POST",
            url: lqApiUrl,
            data: lqMessageEvent,
            headers: {
                "Authorization": `Bearer ${await lqToken}`,
                "Content-Type": "application/json",
                "lq-agent": "Quarkcord Bridge Dev"
            }
        })
    } catch (e) {
        console.error(e);
    }
});


client.login(process.env.DISCORD_TOKEN);
