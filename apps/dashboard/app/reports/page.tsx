import Link from "next/link";
import { requireReportViewer, getAccess } from "@/lib/guard";
import { getLiveMode } from "@/lib/liveModeServer";
import { LiveBlocked } from "@/app/_components/LiveBlocked";
import { listReports, listReportViewers, listModerators } from "@/lib/db";
import {
  addReportViewerAction,
  removeReportViewerAction,
  addModeratorAction,
  removeModeratorAction,
} from "@/app/actions";
import { PendingButton } from "@/app/_components/PendingButton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, "warning" | "default" | "destructive"> = {
  open: "warning",
  resolved: "default",
  dismissed: "destructive",
};

function aiBadge(verdict: string): "destructive" | "warning" | "outline" | "default" {
  const v = verdict.toLowerCase();
  if (v === "severe") return "destructive";
  if (v === "concerning") return "warning";
  if (v === "minor") return "outline";
  return "default";
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; verror?: string }>;
}) {
  const session = await requireReportViewer();
  if (await getLiveMode()) return <LiveBlocked what="Reports" />;
  const { status, verror } = await searchParams;
  const [all, viewers, moderators, access] = await Promise.all([
    listReports(500),
    listReportViewers(),
    listModerators(),
    getAccess(),
  ]);
  const isOwner = !!access?.isSuper;

  const REPEAT_THRESHOLD = 3;
  const targetCounts = new Map<string, number>();
  const reporterCounts = new Map<string, number>();
  for (const r of all) {
    targetCounts.set(r.target_id, (targetCounts.get(r.target_id) ?? 0) + 1);
    reporterCounts.set(r.reporter_id, (reporterCounts.get(r.reporter_id) ?? 0) + 1);
  }

  const openCount = all.filter((r) => r.status === "open").length;
  const activeStatus =
    status === "resolved" || status === "dismissed" || status === "all" ? status : "open";
  const rows = activeStatus === "all" ? all : all.filter((r) => r.status === activeStatus);

  const filters = [
    { key: "open", label: "Open", count: openCount },
    { key: "resolved", label: "Resolved" },
    { key: "dismissed", label: "Dismissed" },
    { key: "all", label: "All", count: all.length },
  ];
  const href = (s: string) => (s === "open" ? "/reports" : `/reports?status=${s}`);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-1">Reports</h1>
      <p className="text-sm text-muted-foreground mb-5">
        Players flagged by other players. Only report viewers can see this , regular admins
        can&apos;t. Each report runs an AI pass over the reported player&apos;s recent chat.
      </p>

      {verror && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="font-medium text-destructive">{verror}</AlertDescription>
        </Alert>
      )}

      <div className="inline-flex items-center rounded-lg border border-border p-0.5 bg-card mb-4">
        {filters.map((f) => (
          <Button
            key={f.key}
            asChild
            variant="ghost"
            size="sm"
            className={
              activeStatus === f.key
                ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                : ""
            }
          >
            <Link href={href(f.key)}>
              {f.label}
              {typeof f.count === "number" ? ` (${f.count})` : ""}
            </Link>
          </Button>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {rows.length === 0 && (
          <Card className="p-6 text-muted-foreground text-sm text-center">No reports here.</Card>
        )}
        {rows.map((r) => (
          <Link key={r.id} href={`/reports/${r.id}`} className="block">
            <Card className="p-4 gap-0 transition-[box-shadow] hover:ring-brand/40">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-medium text-foreground">{r.target_name}</span>
                <Badge variant={STATUS_BADGE[r.status] ?? "default"} className="capitalize">
                  {r.status}
                </Badge>
                {r.ai_verdict && (
                  <Badge variant={aiBadge(r.ai_verdict)} className="capitalize">
                    AI: {r.ai_verdict}
                    {r.ai_score != null ? ` ${r.ai_score}/100` : ""}
                  </Badge>
                )}
                {(targetCounts.get(r.target_id) ?? 0) >= REPEAT_THRESHOLD && (
                  <Badge variant="destructive">🚩 {targetCounts.get(r.target_id)}×</Badge>
                )}
                <span className="text-xs text-muted-foreground ml-auto">
                  {!r.anonymous || (reporterCounts.get(r.reporter_id) ?? 0) >= REPEAT_THRESHOLD
                    ? `by ${r.reporter_name}${r.anonymous ? " 🚩" : ""}`
                    : "anonymous"}{" "}
                  · {new Date(r.created_at).toLocaleString()}
                </span>
              </div>
              {r.reason && (
                <p className="text-sm text-foreground/80 mt-2 line-clamp-2 break-words">{r.reason}</p>
              )}
              {r.ai_summary && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2 break-words">
                  🤖 {r.ai_summary}
                </p>
              )}
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-8">
        <details className="rounded-xl border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold select-none">
            Report viewers ({viewers.length}) , who can see reports
          </summary>
          <p className="text-xs text-muted-foreground mt-2 mb-3">
            Only these Slack users can see reports (you can&apos;t remove yourself). Add mods by
            their Slack member ID.
          </p>
          <div className="flex flex-col divide-y divide-border border border-border rounded-lg mb-3">
            {viewers.map((v) => (
              <div key={v.slack_id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="font-mono">{v.slack_id}</span>
                <span className="text-xs text-muted-foreground">added by {v.added_by || "seed"}</span>
                {v.slack_id !== session.slackId ? (
                  <form action={removeReportViewerAction} className="ml-auto">
                    <input type="hidden" name="slackId" value={v.slack_id} />
                    <PendingButton
                      type="submit"
                      size="sm"
                      variant="ghost"
                      pendingText="Removing…"
                      confirm={`Remove ${v.slack_id} from report viewers?`}
                      className="text-destructive"
                    >
                      Remove
                    </PendingButton>
                  </form>
                ) : (
                  <span className="ml-auto text-xs text-muted-foreground">you</span>
                )}
              </div>
            ))}
          </div>
          <form action={addReportViewerAction} className="flex gap-2">
            <Input name="slackId" placeholder="Slack member ID (U…)" className="text-sm font-mono max-w-xs" />
            <PendingButton type="submit" size="sm" pendingText="Adding…">
              Add viewer
            </PendingButton>
          </form>
        </details>
      </div>

      {isOwner && (
        <div className="mt-3">
          <details className="rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer text-sm font-semibold select-none">
              Moderators ({moderators.length})
            </summary>
            <p className="text-xs text-muted-foreground mt-2 mb-3">
              Moderators can see reports, warn players, and propose a ban , only an admin with the
              &ldquo;ban&rdquo; permission can confirm a proposal (on the{" "}
              <Link href="/bans" className="text-brand underline">
                Bans
              </Link>{" "}
              page). They still need an admin row (any permissions, even none) on the{" "}
              <Link href="/admins" className="text-brand underline">
                Admins
              </Link>{" "}
              page to be able to sign in at all.
            </p>
            <div className="flex flex-col divide-y divide-border border border-border rounded-lg mb-3">
              {moderators.map((m) => (
                <div key={m.slack_id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="font-mono">{m.slack_id}</span>
                  {m.name && <span className="text-muted-foreground">{m.name}</span>}
                  <span className="text-xs text-muted-foreground">added by {m.added_by || "seed"}</span>
                  <form action={removeModeratorAction} className="ml-auto">
                    <input type="hidden" name="slackId" value={m.slack_id} />
                    <PendingButton
                      type="submit"
                      size="sm"
                      variant="ghost"
                      pendingText="Removing…"
                      confirm={`Remove ${m.name || m.slack_id} as a moderator?`}
                      className="text-destructive"
                    >
                      Remove
                    </PendingButton>
                  </form>
                </div>
              ))}
              {moderators.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted-foreground">No moderators yet.</div>
              )}
            </div>
            <form action={addModeratorAction} className="flex gap-2">
              <Input name="slackId" placeholder="Slack member ID (U…)" className="text-sm font-mono max-w-40" />
              <Input name="name" placeholder="Name (optional)" className="text-sm max-w-40" />
              <PendingButton type="submit" size="sm" pendingText="Adding…">
                Add moderator
              </PendingButton>
            </form>
          </details>
        </div>
      )}
    </div>
  );
}
