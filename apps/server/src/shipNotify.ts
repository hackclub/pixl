import { DASH_URL } from "./reports.js";
import { escapeMrkdwn, escapeMrkdwnWithin, safeHttpUrl, slackLinkUrl } from "./slackEscape.js";

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
  const who = ownerSlackId && /^[A-Z0-9]{2,32}$/.test(ownerSlackId) ? `<@${ownerSlackId}>` : "Unknown";
  const hours = (trackedSeconds / 3600).toFixed(2);
  const reviewUrl = `${DASH_URL}/review/${project.id}`;

  // Demo links can be thousands of chars (strudel.cc encodes the whole piece in
  // the URL). Slack rejects the entire message if a section field exceeds 2000
  // chars or a button url exceeds 3000, so over-long links are left out of the
  // alert and the reviewer opens them from the review page instead.
  const SLACK_FIELD_MAX = 2000;
  const SLACK_BUTTON_URL_MAX = 3000;
  const repoLink = slackLinkUrl(project.repo_url);
  const demoLink = slackLinkUrl(project.demo_url);
  const imageUrl = safeHttpUrl(project.image_url);
  const demoHref = safeHttpUrl(project.demo_url);
  const viewUrl = demoHref && demoHref.length <= SLACK_BUTTON_URL_MAX ? demoHref : reviewUrl;
  const linkField = (raw: string | null, link: string | null, label: string) => {
    if (!link) return raw ? "Invalid link" : "Not provided";
    const text = `<${link}|${label}>`;
    return text.length <= SLACK_FIELD_MAX - 100 ? text : "Link too long to preview, see review page";
  };

  // project.name/description are typed by the shipping player, not staff -
  // escaped so a project can't mass-ping this channel via <!channel>/<!here>
  // in its own name/description or render a forged link under the bot.
  const safeName = escapeMrkdwn(project.name);
  const safeDescription = escapeMrkdwnWithin(project.description || "_No description._", 2500);

  const blocks: Record<string, unknown>[] = [
    { type: "section", text: { type: "mrkdwn", text: `*${headline}*\n${status}` } },
  ];
  if (imageUrl) blocks.push({ type: "image", image_url: imageUrl, alt_text: project.name });
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${safeName}*\n${safeDescription}`,
    },
  });
  blocks.push({
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*Username:*\n${who}` },
      { type: "mrkdwn", text: `*Hours logged:*\n${hours}h` },
      {
        type: "mrkdwn",
        text: `*GitHub repo:*\n${linkField(project.repo_url, repoLink, "Open repo")}`,
      },
      {
        type: "mrkdwn",
        text: `*Demo URL:*\n${linkField(project.demo_url, demoLink, "Open demo")}`,
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
        url: viewUrl,
      },
    ],
  });

  try {
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        // Fallback/notification text - also mrkdwn-parsed by Slack, so also escaped.
        text: `${headline}: ${safeName}`,
        blocks,
        unfurl_links: false,
      }),
      signal: AbortSignal.timeout(8000),
    });
    // Slack answers chat.postMessage with HTTP 200 even on failure (wrong
    // channel, bot not invited, etc.) , the real result is in the JSON body,
    // so this must be checked or a broken channel fails completely silently.
    const json = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!json?.ok)
      console.error("postShipToSlack: slack rejected the message", json?.error ?? "no response body");
  } catch (e) {
    console.error("postShipToSlack failed", e);
  }
}

export function resubmitMessage(project: { id: number; name: string }): string {
  return `"${escapeMrkdwn(project.name)}", which you asked changes on, was just re-shipped. Review it: ${DASH_URL}/review/${project.id}`;
}

// DMs the reviewer who asked for changes (and opted in) once the maker ships
// the project again. Sent through Pixorpheus's DM endpoint so it comes from
// Pixo, like every other DM, not from this server's own Slack app.
export async function dmReviewerOfResubmit(
  reviewerSlackId: string,
  project: { id: number; name: string },
): Promise<void> {
  const key = process.env.EXTERNAL_API_KEY;
  const base = process.env.PIXORPHEUS_URL;
  if (!key || !base || !/^[UW][A-Z0-9]{5,20}$/.test(reviewerSlackId)) return;
  try {
    const r = await fetch(new URL("/api/external/dm", base), {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ userId: reviewerSlackId, message: resubmitMessage(project) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) console.error("dmReviewerOfResubmit: Pixorpheus rejected the DM", r.status);
  } catch (e) {
    console.error("dmReviewerOfResubmit failed", e);
  }
}
