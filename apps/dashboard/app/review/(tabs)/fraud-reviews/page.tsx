import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePagePerm, requireGuidelinesAck } from "@/lib/guard";
import { listRobertReviews, type RobertReviewRow } from "@/lib/db";
import { FRAUD_SCORE_THRESHOLD } from "@/lib/robertOutcome";
import { StatusBadge } from "@/app/_components/ProjectBadges";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

function dayKey(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 10) : "unknown";
}

function dayLabel(key: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (key === today) return "Today";
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (key === yesterday) return "Yesterday";
  return key;
}

function timeLabel(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(11, 16) + " UTC" : "";
}

function fmtHours(hours: number | null): string {
  return hours == null ? "-" : `${Math.round(hours * 10) / 10}h`;
}

function maker(p: RobertReviewRow): string {
  return p.users?.display_name || p.users?.real_name || "Unknown";
}

// Read-only log of every score Robert's fraud reviewer has given, newest
// first, grouped by day. Spot check (supers only) is where a fraud-range
// project actually gets decided; this is the full picture, including the
// projects that already left Spot check.
export default async function FraudReviewsPage() {
  const access = await requirePagePerm(["review"]);
  await requireGuidelinesAck(access);
  if (!access.canSecondPass) redirect("/review");

  const rows = await listRobertReviews();
  const days = new Map<string, RobertReviewRow[]>();
  for (const r of rows) {
    const key = dayKey(r.robert_reviewed_at);
    days.set(key, [...(days.get(key) ?? []), r]);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-3">Fraud reviews</h1>
      <p className="text-sm text-muted-foreground mb-4 max-w-2xl">
        Every score Robert&apos;s fraud reviewer has given, newest first. A score of{" "}
        {FRAUD_SCORE_THRESHOLD} or below is Robert&apos;s &quot;Fraud&quot; range; those still go to Spot check
        for a decision here, nothing is banned automatically.
      </p>
      {rows.length === 0 && (
        <Card className="p-5 text-sm text-muted-foreground">No fraud reviews yet.</Card>
      )}
      {[...days.entries()].map(([key, dayRows]) => {
        const fraud = dayRows.filter((r) => r.robert_trust_score <= FRAUD_SCORE_THRESHOLD).length;
        return (
          <div key={key} className="mb-8">
            <div className="flex items-baseline gap-3 mb-2">
              <h2 className="text-lg font-semibold text-foreground">{dayLabel(key)}</h2>
              <span className="text-sm text-muted-foreground">
                {dayRows.length} reviewed, {fraud} in the fraud range
              </span>
            </div>
            <Card className="overflow-hidden p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-5">Project</TableHead>
                    <TableHead className="px-5">Score</TableHead>
                    <TableHead className="px-5">Robert&apos;s note</TableHead>
                    <TableHead className="px-5">In Pixl</TableHead>
                    <TableHead className="px-5 text-right">Credited</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dayRows.map((p) => {
                    const isFraud = p.robert_trust_score <= FRAUD_SCORE_THRESHOLD;
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="px-5 py-3.5 align-top">
                          <Link href={`/review/${p.id}`} className="font-medium text-foreground hover:underline">
                            {p.name}
                          </Link>
                          <div className="text-xs text-muted-foreground">
                            #{p.id} , {maker(p)}
                          </div>
                          <div className="text-xs text-muted-foreground">{timeLabel(p.robert_reviewed_at)}</div>
                        </TableCell>
                        <TableCell className="px-5 py-3.5 align-top">
                          <Badge variant={isFraud ? "destructive" : "secondary"}>{p.robert_trust_score}/10</Badge>
                        </TableCell>
                        <TableCell className="px-5 py-3.5 align-top whitespace-normal max-w-md text-sm text-foreground/80">
                          {p.robert_note || <span className="text-muted-foreground">No note given.</span>}
                        </TableCell>
                        <TableCell className="px-5 py-3.5 align-top">
                          {p.banned_at ? <Badge variant="destructive">Banned</Badge> : <StatusBadge status={p.status} />}
                        </TableCell>
                        <TableCell className="px-5 py-3.5 align-top text-right text-sm text-foreground/70">
                          <div>{fmtHours(p.approved_hours)}</div>
                          <div className="text-xs text-muted-foreground">
                            {fmtHours(p.hackatime_seconds == null ? null : p.hackatime_seconds / 3600)} tracked
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </div>
        );
      })}
    </div>
  );
}
