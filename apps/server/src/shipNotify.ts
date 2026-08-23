import { DASH_URL } from "./reports.js";

// Pings the team's ship-alerts channel with a rich preview whenever a project
// lands in the review queue , both a first ship and a re-ship of an approved
// project call this (ship() in routes/projects.ts hits the same code either
// way), so reviewers see new work land without polling the dashboard.
// Configurable via SHIP_SLACK_CHANNEL, defaults to the team's ship-alerts
// channel so this works without extra setup.
const SHIP_CHANNEL_FALLBACK = "C0BRXVA7GJX";

export interface ShipNotifyProject {
  id: number;
  name: string;
  description: string | null;
  image_url: string | null;
  repo_url: string | null;
  demo_url: string | null;
}

export async function postShipToSlack(
  project: ShipNotifyProject,
  ownerSlackId: string | null,
  trackedSeconds: number,
  isUpdate: boolean,
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SHIP_SLACK_CHANNEL || SHIP_CHANNEL_FALLBACK;
  if (!token) return;

  const headline = isUpdate
    ? "Project update submitted for review"
    : "New project submitted for review";
  const status = isUpdate ? "Under review (re-ship)." : "Under review.";
  const who = ownerSlackId ? `<@${ownerSlackId}>` : "Unknown";
  const hours = (trackedSeconds / 3600).toFixed(2);
  const reviewUrl = `${DASH_URL}/review/${project.id}`;

  const blocks: Record<string, unknown>[] = [
    { type: "section", text: { type: "mrkdwn", text: `*${headline}*\n${status}` } },
  ];
  if (project.image_url)
    blocks.push({ type: "image", image_url: project.image_url, alt_text: project.name });
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${project.name}*\n${(project.description || "_No description._").slice(0, 2500)}`,
    },
  });
  blocks.push({
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*Username:*\n${who}` },
      { type: "mrkdwn", text: `*Hours logged:*\n${hours}h` },
      {
        type: "mrkdwn",
        text: `*GitHub repo:*\n${project.repo_url ? `<${project.repo_url}|Open repo>` : "Not provided"}`,
      },
      {
        type: "mrkdwn",
        text: `*Demo URL:*\n${project.demo_url ? `<${project.demo_url}|Open demo>` : "Not provided"}`,
      },
    ],
  });
  blocks.push({
    type: "actions",
    elements: [
      { type: "button", text: { type: "plain_text", text: "Open review" }, url: reviewUrl },
      {
        type: "button",
        text: { type: "plain_text", text: "View project" },
        url: project.demo_url || reviewUrl,
      },
    ],
  });

  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        text: `${headline}: ${project.name}`,
        blocks,
        unfurl_links: false,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    console.error("postShipToSlack failed", e);
  }
}
