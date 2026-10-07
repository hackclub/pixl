import { db } from "@/lib/db";
import { dmOrEmail } from "@/lib/notify";
import { dmUser } from "@/lib/slack";

// Review verdicts (approved / changes requested) are announced publicly in the
// review channel by Pixo instead of being DMed. Bans still use DMs.
// The post is made by Pixorpheus (POST /api/external/review-post), which only
// ever posts to the one fixed review channel.

const GABIN_SLACK_ID = "U0A2SJ7B739";
const PIXORPHEUS_URL = (process.env.PIXORPHEUS_URL ?? "https://pixo.pixl.rsvp").replace(/\/+$/, "");
const SLACK_ID_RE = /^[UW][A-Z0-9]{5,20}$/;

export type ReviewAnnouncementKind = "changes" | "first_pass" | "final";

export interface ReviewMessageInput {
  kind: ReviewAnnouncementKind;
  /** Slack ids to greet: the owner first, then any accepted collaborators. */
  playerSlackIds: string[];
  projectName: string;
  /** Already a safe http(s) url for Slack, or null for a plain name. */
  projectUrl: string | null;
  note: string;
  reviewerSlackId: string;
  /** Pixels granted, only used by the final approval. */
  pixels?: number;
  /** Extra sentence for the final approval (e.g. a held Trial prize). */
  creditNote?: string;
}

export function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function slackLinkUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.href.replace(/&/g, "&amp;").replace(/</g, "%3C").replace(/>/g, "%3E").replace(/\|/g, "%7C");
  } catch {
    return null;
  }
}

function quote(note: string): string {
  return escapeMrkdwn(note.trim())
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export function buildReviewMessage(input: ReviewMessageInput): string {
  const hello = `Hi ${input.playerSlackIds.map((id) => `<@${id}>`).join(", ")}!`;
  const name = escapeMrkdwn(input.projectName);
  const project = input.projectUrl ? `<${input.projectUrl}|${name}>` : `*${name}*`;
  const reviewer = `<@${input.reviewerSlackId}>`;
  const thread = "please discuss in this thread for any questions/feedback and keep in mind an answer could take a few hours.";

  if (input.kind === "changes") {
    return (
      `${hello} The Pixl village council had fun taking a look at your amazing project ${project} but it needs a few changes before we give you your pixels:\n\n` +
      `${quote(input.note)}\n\n` +
      `The changes were especially requested by ${reviewer}, ${thread}`
    );
  }
  if (input.kind === "first_pass") {
    return (
      `${hello} The Pixl village council loved taking a look at your amazing project ${project} and decided to approve it and it’s now pending for a second review before the core release your pixels. Here is what the council thought of your project:\n\n` +
      `${quote(input.note)}\n\n` +
      `This first review was made by ${reviewer}, ${thread}`
    );
  }
  const pixels = input.pixels ?? 0;
  const granted =
    pixels > 0
      ? `*${pixels} pixels* were granted to your account, you can now go take a look at the shop or keep building projects!`
      : "No new pixels this time since this project already earned its pixels, but you can keep building projects!";
  return (
    `${hello} The Pixl fraud squad and the Pixl mayor were amazed by your project ${project} and decided to approve it fully and pushed it to the core! ${granted}` +
    `${input.creditNote ? ` ${input.creditNote}` : ""} Here is what the final review said:\n\n` +
    `${quote(input.note)}\n\n` +
    `This approval was made by ${reviewer}, ${thread}`
  );
}

/** The reviewer to tag: their own id, or Gabin when they opted out of being named. */
export function reviewerToTag(reviewerSlackId: string, revealName: boolean): string {
  return revealName && SLACK_ID_RE.test(reviewerSlackId) ? reviewerSlackId : GABIN_SLACK_ID;
}

async function postToReviewChannel(message: string): Promise<boolean> {
  const key = process.env.EXTERNAL_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch(`${PIXORPHEUS_URL}/api/external/review-post`, {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error("review channel post failed", res.status);
    return res.ok;
  } catch (e) {
    console.error("review channel post failed", (e as Error).message);
    return false;
  }
}

export interface ReviewAnnouncement {
  kind: ReviewAnnouncementKind;
  projectId: number;
  projectName: string;
  ownerId: string;
  collaboratorIds: string[];
  note: string;
  reviewerSlackId: string;
  revealName: boolean;
  pixels?: number;
  creditNote?: string;
  /** What each player used to get by DM, sent only if the public post fails. */
  fallback: { userId: string; title: string; body: string }[];
}

/**
 * Posts the verdict publicly. If that can't be done (no Slack id for the
 * owner, Pixorpheus down, ...) every player gets the old DM/email instead and
 * Gabin is DMed that the post failed. Never throws.
 */
export async function announceReview(a: ReviewAnnouncement): Promise<boolean> {
  let failure = "";
  try {
    const { data: users } = await db
      .from("users")
      .select("id, slack_id")
      .in("id", [a.ownerId, ...a.collaboratorIds]);
    const slackById = new Map(
      ((users ?? []) as { id: string; slack_id: string | null }[]).map((u) => [u.id, u.slack_id ?? ""]),
    );
    const ownerSlackId = slackById.get(a.ownerId) ?? "";
    if (!SLACK_ID_RE.test(ownerSlackId)) {
      failure = "the owner has no Slack id";
    } else {
      const collabSlackIds = a.collaboratorIds
        .map((id) => slackById.get(id) ?? "")
        .filter((id) => SLACK_ID_RE.test(id));
      const { data: project } = await db
        .from("projects")
        .select("demo_url, repo_url")
        .eq("id", a.projectId)
        .maybeSingle();
      const message = buildReviewMessage({
        kind: a.kind,
        playerSlackIds: [ownerSlackId, ...collabSlackIds],
        projectName: a.projectName,
        projectUrl: slackLinkUrl(project?.demo_url) ?? slackLinkUrl(project?.repo_url),
        note: a.note,
        reviewerSlackId: reviewerToTag(a.reviewerSlackId, a.revealName),
        pixels: a.pixels,
        creditNote: a.creditNote,
      });
      if (await postToReviewChannel(message)) return true;
      failure = "Pixorpheus could not post it";
    }
  } catch (e) {
    failure = (e as Error).message;
    console.error("announceReview failed", failure);
  }

  for (const f of a.fallback) await dmOrEmail(f.userId, f.title, f.body);
  try {
    await dmUser(
      GABIN_SLACK_ID,
      `The public review post for "${a.projectName}" (project ${a.projectId}, ${a.kind}) failed: ${failure}. The player(s) got the old DM/email instead.`,
    );
  } catch (e) {
    console.error("announceReview: could not DM the failure notice", (e as Error).message);
  }
  return false;
}
