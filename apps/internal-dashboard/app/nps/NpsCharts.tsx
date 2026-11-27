import { Details, Muted, Table } from "@/app/_ui/ui";
import { npsBucket, type BucketShares } from "@/lib/npsMath";

// Server-rendered CSS charts in the same style as ReviewVerdictChart: no chart
// library, theme variables only. No text sits on a colored fill; values live in
// a legend or above the bars, and every chart has a table view.

const BUCKET_COLOR = {
  detractor: "var(--hc-red)",
  passive: "var(--hc-yellow)",
  promoter: "var(--hc-green)",
} as const;

const BUCKET_LABEL = { detractor: "Detractors (0-6)", passive: "Passives (7-8)", promoter: "Promoters (9-10)" } as const;

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="inline-block size-3 shrink-0 rounded-sm" style={{ background: color }} />;
}

// One 100% bar split into detractors, passives and promoters, 2px gaps between.
export function ShareBar({ shares }: { shares: BucketShares }) {
  const parts = (["detractor", "passive", "promoter"] as const).map((b) => {
    const count = b === "detractor" ? shares.detractors : b === "passive" ? shares.passives : shares.promoters;
    const pct = b === "detractor" ? shares.pct.detractors : b === "passive" ? shares.pct.passives : shares.pct.promoters;
    return { b, count, pct };
  });
  const summary = parts.map((p) => `${BUCKET_LABEL[p.b]}: ${p.pct}% (${p.count})`).join(", ");
  return (
    <div className="flex flex-col gap-3">
      <div role="img" aria-label={summary} className="flex h-8 w-full gap-[2px] overflow-hidden rounded-md bg-[var(--sunken)]">
        {parts
          .filter((p) => p.count > 0)
          .map((p) => (
            <div key={p.b} title={`${BUCKET_LABEL[p.b]}: ${p.pct}% (${p.count})`} style={{ width: `${(p.count / shares.total) * 100}%`, background: BUCKET_COLOR[p.b] }} />
          ))}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {parts.map((p) => (
          <span key={p.b} className="inline-flex items-center gap-2">
            <Swatch color={BUCKET_COLOR[p.b]} />
            <span>{BUCKET_LABEL[p.b]}</span>
            <span className="hc-mono font-bold">{p.pct}%</span>
            <Muted>({p.count})</Muted>
          </span>
        ))}
      </div>
    </div>
  );
}

// Eleven columns, one per score 0..10, colored by bucket, count above each.
export function ScoreColumns({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  return (
    <div className="flex flex-col gap-3">
      <div role="img" aria-label={`Answers per score from 0 to 10, ${total} in total`} className="flex h-44 items-end gap-1 border-b border-[var(--border-strong)]">
        {counts.map((count, score) => (
          <div key={score} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`Score ${score}: ${count} answer${count === 1 ? "" : "s"}`}>
            <span className="hc-mono text-xs">{count > 0 ? count : ""}</span>
            <div
              className="w-full rounded-t-md"
              style={{ height: count > 0 ? `max(4px, ${(count / max) * 82}%)` : 0, background: BUCKET_COLOR[npsBucket(score)] }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1">
        {counts.map((_, score) => (
          <span key={score} className="hc-mono hc-caption min-w-0 flex-1 text-center text-xs">
            {score}
          </span>
        ))}
      </div>
      <Details summary="Table view">
        <Table headers={["Score", "Answers"]}>
          {counts.map((count, score) => (
            <tr key={score}>
              <td>{score}</td>
              <td className="hc-mono">{count}</td>
            </tr>
          ))}
        </Table>
      </Details>
    </div>
  );
}

// Mean 1..5 rating per area as horizontal bars on a fixed 1..5 scale.
export function RatingBars({ items }: { items: { key: string; label: string; avg: number | null; n: number }[] }) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((it) => (
        <div key={it.key} className="flex flex-wrap items-center gap-x-3 gap-y-1" title={it.avg === null ? `${it.label}: no ratings` : `${it.label}: ${it.avg} out of 5 from ${it.n}`}>
          <div className="hc-caption w-60 shrink-0 text-sm">{it.label}</div>
          <div className="h-5 min-w-40 flex-1 overflow-hidden rounded-md bg-[var(--sunken)]" role="img" aria-label={it.avg === null ? "No ratings" : `${it.avg} out of 5`}>
            {it.avg !== null && <div className="h-full rounded-md" style={{ width: `${(it.avg / 5) * 100}%`, background: "var(--hc-cyan)" }} />}
          </div>
          <div className="hc-mono w-24 shrink-0 text-sm">
            {it.avg === null ? <Muted>no ratings</Muted> : <><span className="font-bold">{it.avg}</span> <Muted>/ 5 ({it.n})</Muted></>}
          </div>
        </div>
      ))}
    </div>
  );
}

// NPS per month, drawn from a center line: right (green) positive, left (red) negative.
export function TrendBars({ points }: { points: { wave: string; n: number; nps: number | null }[] }) {
  return (
    <div className="flex flex-col gap-2">
      {points.map((p) => {
        const v = p.nps ?? 0;
        const half = Math.min(100, Math.abs(v)) / 2;
        return (
          <div key={p.wave} className="flex items-center gap-3" title={`${p.wave}: NPS ${p.nps ?? "n/a"} from ${p.n} answer${p.n === 1 ? "" : "s"}`}>
            <div className="hc-mono hc-caption w-20 shrink-0 text-sm">{p.wave}</div>
            <div className="relative h-5 flex-1 rounded-md bg-[var(--sunken)]" role="img" aria-label={`NPS ${p.nps ?? "not available"}`}>
              <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--border-strong)]" />
              {v !== 0 && (
                <div
                  className="absolute inset-y-0 rounded-md"
                  style={{ width: `${half}%`, [v > 0 ? "left" : "right"]: "50%", background: v > 0 ? "var(--hc-green)" : "var(--hc-red)" }}
                />
              )}
            </div>
            <div className="hc-mono w-28 shrink-0 text-sm">
              <span className="font-bold">{p.nps === null ? "-" : p.nps > 0 ? `+${p.nps}` : p.nps}</span> <Muted>({p.n})</Muted>
            </div>
          </div>
        );
      })}
    </div>
  );
}
