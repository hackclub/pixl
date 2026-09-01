---
title: Slack app guide
group: Guides
description: Build interactive bots, slash commands, and automations for Slack.
---

# Slack app guide

^ Because Hack Club runs on Slack, building a Slack bot or integration is one of the most practical projects you can ship.

## 1. Create your Slack app

1. Head to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**.
2. Select **From scratch**.
3. Choose your development testing workspace (use a private test workspace while building, not the main Hack Club workspace).

## 2. Configure OAuth scopes

Under **OAuth & Permissions**, add the bot token scopes your app needs:
- `chat:write`: Allows the bot to post messages.
- `channels:history`: Allows reading messages in public channels.
- `commands`: Enables custom slash commands (like `/pixl-stats`).
- `app_mentions:read`: Triggers events when someone @mentions your bot.

Click **Install to Workspace** and copy your **Bot User OAuth Token** (`xoxb-...`).

::: warn Keep tokens private
Never commit your Slack API keys or tokens to GitHub. Store them in a `.env` file and add `.env` to your `.gitignore`.
:::

## 3. Starter code with `@slack/bolt`

Using Node.js and the official Bolt framework in Socket Mode makes local development seamless without exposing public ports:

```javascript
const { App } = require('@slack/bolt');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// Responds when a user says "ping"
app.message('ping', async ({ message, say }) => {
  await say(`pong! 🏓 <@${message.user}>`);
});

(async () => {
  await app.start();
  console.log('⚡️ Slack bot is running!');
})();
```

## 4. Deploying 24/7

Once your bot works locally, deploy it to **Nest** (Hack Club's free Linux hosting) so it stays online 24/7 without needing your laptop open.
