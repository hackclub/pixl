import {
  ERROR_TEXT,
  getBlackoutEntry,
  operationRpc,
  type BlackoutEntry,
} from "@/lib/operations";
import { refreshBlackoutEvidence } from "@/lib/gameServer";

export function isBlackoutReviewable(entry: BlackoutEntry | null): entry is BlackoutEntry {
  return (
    !!entry &&
    entry.firstQualifiedShipAt !== null &&
    entry.decidedBy !== "system" &&
    (entry.status === "shipped" || entry.status === "eligible" || entry.status === "ineligible")
  );
}

export interface BlackoutFormInput {
  decision: "eligible" | "ineligible" | null;
  note: string;
  hours: { user_id: string; hours: number }[];
}

export function parseBlackoutForm(formData: FormData, entry: BlackoutEntry): BlackoutFormInput {
  const raw = String(formData.get("blackoutDecision") ?? "");
  const decision = raw === "eligible" || raw === "ineligible" ? raw : null;
  const note = String(formData.get("blackoutNote") ?? "").trim().slice(0, 1000);
  const hours = entry.contributors.map((c) => {
    const v = Number(String(formData.get(`blackoutHours_${c.userId}`) ?? "0"));
    return { user_id: c.userId, hours: Number.isFinite(v) ? Math.round(v * 100) / 100 : -1 };
  });
  return { decision, note, hours };
}

export async function applyBlackoutDecision(args: {
  projectId: number;
  formData: FormData;
  by: string;
  stage: "first_pass" | "final";
}): Promise<string | null> {
  let entry = await getBlackoutEntry(args.projectId);
  if (!isBlackoutReviewable(entry)) return null;
  // Authoritative refresh, not a frontend concern: a project can ship once,
  // never reship, and keep earning eligible hours right up to Blackout's
  // end - nothing else re-syncs that, so every decision re-pulls the truth
  // first. Fail CLOSED: a decision must never be finalized against evidence
  // we couldn't confirm is current. If the refresh fails (PixlServer
  // unreachable, or it reports an error), abort before touching
  // operation_review_decision at all - no status change, no payout. This is
  // a retryable condition, not a rejection: the reviewer just needs to try
  // again once PixlServer is back.
  if (!(await refreshBlackoutEvidence(entry.id))) {
    return "Couldn't refresh this entry's Blackout evidence (PixlServer unreachable or the refresh failed) - the decision was NOT saved. Try again in a moment.";
  }
  const refreshed = await getBlackoutEntry(args.projectId);
  if (!isBlackoutReviewable(refreshed)) {
    return "This entry is no longer reviewable after refreshing its evidence. Reload the page.";
  }
  entry = refreshed;
  const input = parseBlackoutForm(args.formData, entry);
  if (!input.decision) return "Rule on this project's Operation Blackout entry: eligible or ineligible.";
  const res = await operationRpc.reviewDecision({
    slug: entry.operation.slug,
    projectId: args.projectId,
    decision: input.decision,
    note: input.note,
    by: args.by,
    stage: args.stage,
    hours: input.hours,
  });
  if (res.ok) return null;
  const base = ERROR_TEXT[String(res.error)] ?? "Couldn't save the Blackout decision.";
  return res.error === "exceeds_eligible" && res.max_hours != null
    ? `${base} (max ${res.max_hours}h for that person)`
    : base;
}
