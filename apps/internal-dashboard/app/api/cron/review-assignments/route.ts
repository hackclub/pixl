import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/requestGuards";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { dmUser } from "@/lib/slack";
import { config } from "@/app/_generated/config";
import {
  ASSIGNMENT_WINDOW_MS,
  assignmentClockStartMs,
  isAssignmentOverdue,
  needsAssignmentReminder,
} from "@/lib/reviewAssignment";

export const dynamic = "force-dynamic";

// Run hourly. The reviewer who first asked for changes on a project owns it
// (lib/reviewAssignment.ts). Two things happen here:
// - a day after the maker re-ships, the assignee gets a reminder DM;
// - once their 3 days are up, the project goes back to the shared queue and the
//   pixel held for their request is forfeited.
// Access never depends on this job: an overdue assignment is already open to
// everyone (lockedForViewer ignores it) and its held pixel is forfeited at the
// next verdict. This only cleans up, reminds and tells the reviewer.

const FORFEIT_REASON = "did not review the resubmission within 3 days";

function dateLabel(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not set" }, { status: 500 });
  if (!bearerMatches(req.headers.get("authorization"), secret)) {
    await audit({ action: "cron.review-assignments", result: "denied", actorType: "anonymous" }, req);
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  await audit({ action: "cron.review-assignments", result: "ok", actorType: "service", actorId: "cron" }, req);

  const { data, error } = await db
    .from("projects")
    .select("id, name, status, assigned_reviewer_slack_id, assigned_at, assignment_reminded_at, shipped_at")
    .eq("status", "shipped")
    .neq("assigned_reviewer_slack_id", "");
  if (error) return NextResponse.json({ ok: false, error: error.message });

  const now = Date.now();
  let released = 0;
  let reminded = 0;
  for (const p of data ?? []) {
    const slackId = String(p.assigned_reviewer_slack_id);
    const link = `${config.urls.dash}/review/${p.id}`;

    if (isAssignmentOverdue(p, now)) {
      // Guarded on the assignee still being the same, so a verdict landing
      // between the read and this write isn't undone.
      const { data: cleared } = await db
        .from("projects")
        .update({ assigned_reviewer_slack_id: "", assigned_at: null, assignment_reminded_at: null })
        .eq("id", p.id)
        .eq("status", "shipped")
        .eq("assigned_reviewer_slack_id", slackId)
        .select("id");
      if (!cleared || cleared.length === 0) continue;
      released++;
      const { data: forfeited } = await db
        .from("review_payouts")
        .update({
          status: "voided",
          paid_pixels: 0,
          cut_pct: 100,
          cut_reason: FORFEIT_REASON,
          settled_at: new Date().toISOString(),
        })
        .eq("project_id", p.id)
        .eq("status", "pending")
        .select("id");
      const lostPixel = (forfeited ?? []).length > 0;
      await dmUser(
        slackId,
        `"${p.name}" was waiting for you for 3 days after the maker re-shipped it, so it went back to the shared queue.` +
          (lostPixel ? " The pixel held for your request for changes was forfeited." : "") +
          ` You can still review it from the queue if it is on the first page: ${link}`,
      );
      continue;
    }

    if (needsAssignmentReminder(p, now)) {
      const start = assignmentClockStartMs(p);
      if (start === null) continue;
      const { data: marked } = await db
        .from("projects")
        .update({ assignment_reminded_at: new Date().toISOString() })
        .eq("id", p.id)
        .eq("status", "shipped")
        .eq("assigned_reviewer_slack_id", slackId)
        .select("id");
      if (!marked || marked.length === 0) continue;
      reminded++;
      await dmUser(
        slackId,
        `Reminder: "${p.name}" was re-shipped and is waiting for you, since you requested its changes. ` +
          `You have until ${dateLabel(start + ASSIGNMENT_WINDOW_MS)} UTC to review it, ` +
          `after that it goes back to the shared queue and you lose the pixel held for your request. ${link}`,
      );
    }
  }

  return NextResponse.json({ ok: true, checked: (data ?? []).length, released, reminded });
}
