import { requirePage } from "@/lib/guard";
import { listNpsRows } from "@/lib/nps";
import {
  averageRatings,
  bucketShares,
  isWave,
  npsBucket,
  npsBySegment,
  npsScore,
  scoreDistribution,
  waveTrend,
} from "@/lib/npsMath";
import { Badge, Card, CardHeader, EmptyState, LinkTabs, Muted, PageHeader, Stat, StatGrid, Table, formatDate } from "@/app/_ui/ui";
import { RatingBars, ScoreColumns, ShareBar, TrendBars } from "./NpsCharts";

export const dynamic = "force-dynamic";

export const metadata = { title: "NPS" };

const COMMENTS_SHOWN = 100;

const signed = (n: number | null) => (n === null ? "-" : n > 0 ? `+${n}` : String(n));

export default async function NpsPage({ searchParams }: { searchParams: Promise<{ wave?: string }> }) {
  await requirePage("owner");
  const { wave } = await searchParams;
  const all = await listNpsRows();

  const waves = [...new Set(all.map((r) => r.wave))].sort().reverse();
  const active = isWave(wave) && waves.includes(wave) ? wave : "all";
  const rows = active === "all" ? all : all.filter((r) => r.wave === active);

  const tabs = [
    { key: "all", href: "/nps", label: "All time", count: all.length },
    ...waves.map((w) => ({ key: w, href: `/nps?wave=${w}`, label: w, count: all.filter((r) => r.wave === w).length })),
  ];

  const header = (
    <PageHeader
      title="NPS"
      description="Answers to the player survey. They are shown without who gave them."
    />
  );

  if (all.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState title="No answers yet" icon="message">
            The survey is only open to the people listed in NPS_PREVIEW_SLACK_IDS while NPS_MODE is preview. Answers show up here as soon as one comes in.
          </EmptyState>
        </Card>
      </>
    );
  }

  const score = npsScore(rows);
  const shares = bucketShares(rows);
  const trend = waveTrend(all);
  const segments = npsBySegment(rows);
  const ratings = averageRatings(rows);
  const comments = rows.filter((r) => r.reason || r.fixText).slice(0, COMMENTS_SHOWN);
  const mean = rows.length ? (rows.reduce((s, r) => s + r.score, 0) / rows.length).toFixed(1) : "-";
  const tone = score === null ? undefined : score >= 30 ? "success" : score >= 0 ? "warning" : "danger";

  return (
    <div className="flex flex-col gap-6">
      {header}
      <LinkTabs tabs={tabs} active={active} />

      <StatGrid>
        <Stat label="NPS" value={signed(score)} icon="rep" tone={tone} hint="Promoters minus detractors, from -100 to 100" />
        <Stat label="Answers" value={rows.length} icon="message" />
        <Stat label="Average score" value={mean} icon="pie-chart" hint="Out of 10" />
        <Stat label="Promoters" value={`${shares.pct.promoters}%`} tone="success" hint={`${shares.promoters} answer${shares.promoters === 1 ? "" : "s"}`} />
        <Stat label="Detractors" value={`${shares.pct.detractors}%`} tone="danger" hint={`${shares.detractors} answer${shares.detractors === 1 ? "" : "s"}`} />
      </StatGrid>

      <Card>
        <CardHeader title="Who is happy" />
        <ShareBar shares={shares} />
      </Card>

      <Card>
        <CardHeader title="How people scored" />
        <ScoreColumns counts={scoreDistribution(rows)} />
      </Card>

      <Card>
        <CardHeader title="Rating by area" />
        <RatingBars items={ratings} />
        <p className="hc-caption mt-3 text-xs">Rating each area is optional, so the number of answers behind each bar is in brackets.</p>
      </Card>

      <Card>
        <CardHeader title="NPS by group" />
        <Table headers={["Group", "Answers", "NPS"]}>
          {segments.map((s) => (
            <tr key={s.key}>
              <td>{s.label}</td>
              <td className="hc-mono">{s.n}</td>
              <td className="hc-mono">
                {s.n === 0 ? <Muted>-</Muted> : s.low ? <Muted>{signed(s.nps)}</Muted> : <span className="font-bold">{signed(s.nps)}</span>}{" "}
                {s.n > 0 && s.low && <Badge outline>few answers</Badge>}
              </td>
            </tr>
          ))}
        </Table>
        <p className="hc-caption mt-3 text-xs">Groups overlap, one player can be in several. Under 5 answers the number moves a lot, so treat it as a hint.</p>
      </Card>

      {trend.length > 1 && (
        <Card>
          <CardHeader title="NPS by month" />
          <TrendBars points={trend} />
        </Card>
      )}

      <Card>
        <CardHeader title="What people said" />
        {comments.length === 0 ? (
          <EmptyState title="No written answers yet" icon="message" />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {comments.map((r, i) => {
              const b = npsBucket(r.score);
              return (
                <li key={`${r.createdAt}-${i}`} className="flex flex-col gap-1 border-b border-[var(--border-strong)] pb-4 last:border-b-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={b === "promoter" ? "success" : b === "passive" ? "yellow" : "danger"}>{r.score} / 10</Badge>
                    <Muted className="text-xs">{formatDate(r.createdAt)}</Muted>
                  </div>
                  {r.reason && <p className="m-0 break-words whitespace-pre-wrap">{r.reason}</p>}
                  {r.fixText && (
                    <p className="m-0 break-words whitespace-pre-wrap">
                      <Muted>For the next program: </Muted>
                      {r.fixText}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
