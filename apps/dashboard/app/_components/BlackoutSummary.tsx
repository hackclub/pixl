import { BlackoutBadge } from "@/app/_components/BlackoutBadge";
import { Card } from "@/components/ui/card";
import { ENTRY_STATUS_LABEL, settleNoteText, type BlackoutEntry } from "@/lib/operations";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }) + " UTC";
const h = (n: number) => `${Math.round(n * 100) / 100}h`;

export function BlackoutSummary({ entry }: { entry: BlackoutEntry }) {
  return (
    <Card className="p-4 gap-2 border-amber-300/70 dark:border-amber-500/40">
      <div className="flex items-center gap-2 flex-wrap">
        <BlackoutBadge />
        <span className="text-sm font-semibold">{entry.operation.name}</span>
        <span className="text-xs text-muted-foreground">{ENTRY_STATUS_LABEL[entry.status]}</span>
      </div>
      <div className="text-xs text-muted-foreground grid gap-0.5">
        <span>Joined {fmt(entry.joinedAt)}{entry.firstQualifiedShipAt ? ` · first ship ${fmt(entry.firstQualifiedShipAt)}` : ""}</span>
        {entry.systemReason && <span>{entry.systemReason}</span>}
        {entry.decision && (
          <span>
            Ruled <b className="text-foreground">{entry.decision}</b>
            {entry.decidedBy && entry.decidedBy !== "system" ? ` by ${entry.decidedBy.replace(/\s*\([^)]*\)\s*$/, "")}` : ""}
            {entry.decisionNote ? ` , ${entry.decisionNote}` : ""}
          </span>
        )}
        {entry.status === "needs_changes" && entry.graceDeadline && (
          <span>Fix window open until {fmt(entry.graceDeadline)}</span>
        )}
      </div>
      {entry.contributors.some((c) => !c.evidenceOk) && (
        <div role="alert" className="rounded-md border border-rose-400 dark:border-rose-500/60 bg-rose-50 dark:bg-rose-500/10 px-2.5 py-1.5 text-xs">
          <b className="text-rose-700 dark:text-rose-300">Time evidence incomplete:</b> Hackatime couldn&apos;t be read at ship
          time for {entry.contributors.filter((c) => !c.evidenceOk).map((c) => c.name).join(", ")}; tracked hours may be
          under-counted.
        </div>
      )}
      {entry.contributors.some((c) => c.settled) && (
        <div className="grid gap-1">
          {entry.contributors.map((c) => (
            <div key={c.userId} className="text-xs flex justify-between gap-3 flex-wrap">
              <span>{c.name}</span>
              <span className="text-muted-foreground">
                {c.settled
                  ? `${h(c.paidHours)} at $${(c.effectiveUsdRate ?? 0).toFixed(2)}/hr (own rate $${(c.normalUsdRate ?? 0).toFixed(2)}), +${c.upliftPx} px`
                  : "not settled"}
                {c.settleNote ? ` , ${settleNoteText(c.settleNote)}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
