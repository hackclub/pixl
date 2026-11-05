type StepState = "done" | "current" | "upcoming";
import { currentFirstPassAt } from "@/lib/reviewCycleDisplay";

const DOT: Record<StepState, string> = {
  done: "var(--hc-green)",
  current: "var(--hc-purple)",
  upcoming: "var(--border-strong)",
};

function Step({ label, state }: { label: string; state: StepState }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="hc-dot shrink-0" style={{ background: DOT[state] }} />
      <span className={`text-xs ${state === "upcoming" ? "hc-muted" : "font-bold"}`}>{label}</span>
    </div>
  );
}

// Fraud review is Robert now (see lib/robertSync.ts): a project can sit in
// status "fraud_review" for a while waiting on it, so it gets its own step
// rather than being lumped into "upcoming" alongside shipped/first pass.
// "Unified" has no signal we can read (it's a manual step the team does in
// Airtable after this system's part is done), so it's never marked "done"
// automatically, just shown as the final stop.
export function ReviewPipelineSteps({
  shippedAt,
  firstPassAt,
  status,
  airtableRecordId,
}: {
  shippedAt: string | null;
  firstPassAt: string | null;
  status: string;
  airtableRecordId: string | null;
}) {
  const firstPassThisCycle = currentFirstPassAt(status, firstPassAt);
  const approved = status === "approved";
  const pastFraudReview = status === "second_review" || approved;
  const fraudReview: StepState = status === "fraud_review" ? "current" : pastFraudReview ? "done" : "upcoming";
  const secondPass: StepState = approved ? "done" : status === "second_review" ? "current" : "upcoming";
  const airtable: StepState = airtableRecordId ? "done" : approved ? "current" : "upcoming";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <Step label="Initial submission" state={shippedAt ? "done" : "upcoming"} />
      <Step label="First pass" state={firstPassThisCycle ? "done" : shippedAt ? "current" : "upcoming"} />
      <Step label="Fraud review" state={fraudReview} />
      <Step label="Second pass" state={secondPass} />
      <Step label="Airtable" state={airtable} />
      <Step label="Unified" state="upcoming" />
    </div>
  );
}
