import { cn } from "@/lib/utils";

type StepState = "done" | "current" | "upcoming";

function Step({ label, state }: { label: string; state: StepState }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full shrink-0",
          state === "done" && "bg-emerald-500",
          state === "current" && "bg-violet-500",
          state === "upcoming" && "bg-muted-foreground/30",
        )}
      />
      <span
        className={cn(
          "text-xs",
          state === "upcoming" ? "text-muted-foreground" : "text-foreground font-medium",
        )}
      >
        {label}
      </span>
    </div>
  );
}

// Fraud review (Joe) used to sit between "shipped" and "second pass" - it's
// folded into second pass now (see SecondPassChecklist), so this pipeline
// only ever shows five stages. "Unified" has no signal we can read - it's a
// manual step the team does in Airtable after this system's part is done -
// so it's never marked "done" automatically, just shown as the final stop.
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
  const approved = status === "approved";
  const secondPass: StepState = approved ? "done" : status === "second_review" ? "current" : "upcoming";
  const airtable: StepState = airtableRecordId ? "done" : approved ? "current" : "upcoming";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <Step label="Initial submission" state={shippedAt ? "done" : "upcoming"} />
      <Step label="First pass" state={firstPassAt ? "done" : shippedAt ? "current" : "upcoming"} />
      <Step label="Second pass" state={secondPass} />
      <Step label="Airtable" state={airtable} />
      <Step label="Unified" state="upcoming" />
    </div>
  );
}
