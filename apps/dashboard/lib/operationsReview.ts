import {
  ERROR_TEXT,
  getBlackoutEntry,
  operationRpc,
  type BlackoutEntry,
} from "@/lib/operations";

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
  const entry = await getBlackoutEntry(args.projectId);
  if (!isBlackoutReviewable(entry)) return null;
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
