import crypto from "crypto";
import express from "express";
import { app, receiver } from "../slack/app.js";
import { escapeMrkdwn } from "../slack/escape.js";

async function handleGitHubEvent(event: string, payload: any): Promise<void> {
  const channel = process.env.GITHUB_NOTIFY_CHANNEL;
  if (!channel) return;

  // Signature verification (below) proves the request came from GitHub, but
  // commit messages/PR titles/usernames are still attacker-controlled,
  // anyone who can push a commit or open a PR sets these, so they go
  // through escapeMrkdwn before landing in a bot-posted Slack message.
  if (event === "push" && payload.ref === "refs/heads/main" && payload.commits?.length) {
    const repo = escapeMrkdwn(String(payload.repository.full_name));
    const commits = payload.commits
      .map((c: any) => `> ${escapeMrkdwn(String(c.message).split("\n")[0])} (\`${String(c.id).slice(0, 7)}\`)`)
      .join("\n");
    const more = "";
    await app.client.chat.postMessage({
      channel,
      text: `*${escapeMrkdwn(String(payload.pusher.name))}* pushed ${payload.commits.length} commit${payload.commits.length > 1 ? "s" : ""} to \`main\` on *${repo}*\n${commits}${more}`,
    });
  }

  if (event === "pull_request" && payload.action === "closed" && payload.pull_request?.merged && payload.pull_request.base.ref === "main") {
    const repo = escapeMrkdwn(String(payload.repository.full_name));
    const pr = payload.pull_request;
    await app.client.chat.postMessage({
      channel,
      text: `*${escapeMrkdwn(String(pr.user.login))}* merged PR #${pr.number} *"${escapeMrkdwn(String(pr.title))}"* into \`main\` on *${repo}*`,
    });
  }
}

receiver.app.post("/webhooks/github", express.raw({ type: "application/json" }), (req, res) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[github-webhook] GITHUB_WEBHOOK_SECRET is not set; refusing request");
    return res.status(503).send("Service misconfigured");
  }
  const sig = req.headers["x-hub-signature-256"] as string | undefined;
  if (!sig) return res.status(401).send("Missing signature");
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(req.body).digest("hex");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return res.status(401).send("Invalid signature");
  }
  let payload;
  try {
    payload = JSON.parse(req.body);
  } catch {
    return res.status(400).send("Bad JSON");
  }
  res.status(200).send("ok");
  handleGitHubEvent(req.headers["x-github-event"] as string, payload).catch((e: any) => console.error("[github-webhook]", e.message));
});
