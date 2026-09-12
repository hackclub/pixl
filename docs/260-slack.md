---
title: Slack app guide
group: Guides
description: Build interactive bots, slash commands, and automations for Slack.
---

# Slack app guide

^ Hack Club runs on Slack, so a bot or integration is one of the more useful things you can build here. You'll actually use it.

## 1. Create your Slack app

1. Head to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**.
2. Select **From scratch**.
3. Pick a workspace to develop against. Use a private test one, not the main Hack Club workspace.

## 2. Configure OAuth scopes

Under **OAuth & Permissions**, add the scopes your bot needs:

- `chat:write`: post messages.
- `channels:history`: read messages in public channels.
- `commands`: add slash commands like `/pixl-stats`.
- `app_mentions:read`: get an event when someone @mentions the bot.

Click **Install to Workspace** and copy your **Bot User OAuth Token** (`xoxb-...`).

::: warn Keep tokens private
Never commit your Slack API keys or tokens to GitHub. Store them in a `.env` file and add `.env` to your `.gitignore`.
:::

## 3. Starter code with `@slack/bolt`

Bolt in Socket Mode means you can develop locally without exposing a public port:

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

Once it works locally, put it on **Nest**, Hack Club's free Linux hosting, so it keeps running when your laptop is shut.
