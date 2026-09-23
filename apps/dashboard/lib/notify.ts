import { db } from "@/lib/db";
import { dmUser, DM_EXCLUDED_SLACK_IDS } from "@/lib/slack";

// Best-effort email via Resend. Silently skipped when not configured.
async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from || !to) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) console.error("resend email failed", r.status, await r.text().catch(() => ""));
    return r.ok;
  } catch (e) {
    console.error("resend email failed", (e as Error).message);
    return false;
  }
}

// Reach a player wherever we can: Slack DM (Pixorpheus) first, email as the
// fallback when there's no slack_id or the DM fails. Never throws.
export async function dmOrEmail(userId: string, subject: string, body: string): Promise<void> {
  const { data: user } = await db
    .from("users")
    .select("slack_id, email")
    .eq("id", userId)
    .single();
  const slackId = (user?.slack_id as string | null) ?? null;
  const email = (user?.email as string | null) ?? null;

  if (slackId && !DM_EXCLUDED_SLACK_IDS.has(slackId)) {
    try {
      await dmUser(slackId, `<@${slackId}> ${subject}\n\n${body}`);
      return;
    } catch (e) {
      console.error("DM failed, trying email", (e as Error).message);
    }
  }
  if (email) await sendEmail(email, `Pixl , ${subject}`, body);
}
