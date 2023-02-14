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
        let res = await axios.post("https://lq.litdevs.org/v1/auth/token", {email: process.env.LQ_EMAIL, password: process.env.LQ_PASS});
        return res.data.response.access_token;
    } catch (e) {
        console.error(e.status);
    }
}

let lqToken = obtainLqToken();

async function obtainLqUser() {
    try {
        let res = await axios.get("https://lq.litdevs.org/v1/user/me", {headers: {"Authorization": `Bearer ${await lqToken}`}});
        return res.data.response.jwtData;
    } catch (e) {
        console.error(e.status);
    }
}

let lqUser = obtainLqUser();

let gatewayConnection

async function openGateway() {
    gatewayConnection = new WebSocket("wss://lq-gateway.litdevs.org", await lqToken);
    registerGatewayEvents();
}

async function registerGatewayEvents() {
    gatewayConnection.on('open', () => {
        console.log("Connected to gateway");
        channelMap.forEach(channelMapping => {
            gatewayConnection.send(JSON.stringify({
                "event": "subscribe",
                "message": `channel_${channelMapping.lightquark}`
            }));
        });
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
                let webhook = webhooks.find(w => w.name === "Quarkcord");
                if (!webhook) webhook = await channel.createWebhook({name: "Quarkcord", avatar: "https://lq.litdevs.org/alt_alt_icon.svg"});
                webhook.send({
                    content: message.message.content,
                    allowedMentions: { parse: [] },
                    username: message.author.username,
                    avatarURL: message.author.avatarUri
                })
            break;

        }
    });

    gatewayConnection.on('close', () => {
        console.log("Disconnected from gateway");
        openGateway();
    });

    gatewayConnection.on("error", (e) => {
        console.error(e);
    });

}

openGateway();

async function transformToLq(message) {
    let lqMessageEvent = {
        content: message.content,
        specialAttributes: [{
            type: "botMessage",
            username: message.author.username,
            avatarUri: message.author.avatarURL({ dynamic: true, size: 128 })
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
        lightquark: "638b815b4d55b470d9d6fa19"
    },
    {
        discord: "951924511509471293",
        lightquark: "63eb7cadecc96ed5edc25b4a"
    },
    {
        discord: "1051255515176513646",
        lightquark: "63eb7cc7ecc96ed5edc267fc"
    },
    {
        discord: "997976909596086292",
        lightquark: "63eb7ccfecc96ed5edc26c27"
    }
]

client.on('messageCreate', async message => {
    if (message.webhookId) return;
    if(message.author.id === client.user.id) return;
    if (message.guild.id !== trackingGuild) return;
    let channelMapping = channelMap.find(c => c.discord === message.channel.id);
    if (!channelMapping) return;

    const lqMessageEvent = await transformToLq(message); 
    const lqApiUrl = `https://lq.litdevs.org/v2/channel/${channelMapping.lightquark}/messages`;

    try {
        await axios({
            method: "POST",
            url: lqApiUrl,
            data: lqMessageEvent,
            headers: {
                "Authorization": `Bearer ${await lqToken}`,
                "Content-Type": "application/json",
                "lq-agent": "Quarkcord Bridge"
            }
        })
    } catch (e) {
        console.error(e);
    }
});


client.login(process.env.DISCORD_TOKEN);