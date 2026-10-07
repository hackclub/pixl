import Link from "next/link";
import { notFound } from "next/navigation";
import { requireReportViewer, getAccess, canView, isModerator } from "@/lib/guard";
import { getLiveMode } from "@/lib/liveModeServer";
import { LiveBlocked } from "@/app/_components/LiveBlocked";
import { getReport, listChatFor, reportCounts } from "@/lib/db";
import { resolveReport } from "@/app/actions";
import { slackHandle } from "@/lib/slack";
import { BanForm, ProposeBanForm, WarnForm } from "@/app/_components/Moderate";
import { PendingButton } from "@/app/_components/PendingButton";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function aiBadge(verdict: string): "destructive" | "warning" | "outline" | "default" {
  const v = verdict.toLowerCase();
  if (v === "severe") return "destructive";
  if (v === "concerning") return "warning";
  if (v === "minor") return "outline";
  return "default";
}

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireReportViewer();
  if (await getLiveMode()) return <LiveBlocked what="Reports" />;
  const { id } = await params;
  const report = await getReport(Number(id));
  if (!report) notFound();

  const [chat, access, targetHandle, counts, moderator] = await Promise.all([
    listChatFor(report.target_id, 10),
    getAccess(),
    slackHandle(report.target_slack),
    reportCounts(report.target_id, report.reporter_id),
    isModerator(),
  ]);
  const canBan = !!access && canView(access, ["ban"]);
  const canWarn = (!!access && canView(access, ["warn"])) || moderator;
  const canProposeBan = !canBan && moderator;

  // Serial reporters get deanonymized to viewers; heavily-reported targets get
  // flagged for a closer look.
  const REPEAT_THRESHOLD = 3;
  const revealReporter = !report.anonymous || counts.byReporter >= REPEAT_THRESHOLD;
  const targetFlagged = counts.againstTarget >= REPEAT_THRESHOLD;

  return (
    <div className="max-w-3xl">
      <Link href="/reports" className="text-sm text-muted-foreground hover:text-brand">
        ← All reports
      </Link>

      <div className="flex items-center gap-3 flex-wrap mt-3 mb-5">
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">
          Report on {report.target_name}
        </h1>
        <Badge variant={report.status === "open" ? "warning" : "default"} className="capitalize">
          {report.status}
        </Badge>
        {report.ai_verdict && (
          <Badge variant={aiBadge(report.ai_verdict)} className="capitalize">
            AI: {report.ai_verdict}
            {report.ai_score != null ? ` ${report.ai_score}/100` : ""}
          </Badge>
        )}
        {targetFlagged && (
          <Badge variant="destructive">🚩 Repeat-reported ({counts.againstTarget})</Badge>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <Card className="p-4 gap-0">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Reported player
          </div>
          <Link href={`/players/${report.target_id}`} className="font-semibold hover:text-brand">
            {report.target_name}
          </Link>
          <div className="text-xs text-muted-foreground mt-0.5">
            {targetHandle ? targetHandle : report.target_slack ? report.target_slack : "no slack linked"}
          </div>
        </Card>
        <Card className="p-4 gap-0">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Reported by
          </div>
          {revealReporter ? (
            <Link href={`/players/${report.reporter_id}`} className="font-semibold hover:text-brand">
              {report.reporter_name}
            </Link>
          ) : (
            <span className="font-semibold text-muted-foreground">Anonymous</span>
          )}
          <div className="text-xs text-muted-foreground mt-0.5">
            {new Date(report.created_at).toLocaleString()}
            {report.anonymous && revealReporter
              ? ` · 🚩 identity revealed , filed ${counts.byReporter} reports`
              : report.anonymous
                ? " · identity hidden by reporter"
                : ""}
            {!report.anonymous && counts.byReporter >= REPEAT_THRESHOLD
              ? ` · ${counts.byReporter} reports filed`
              : ""}
          </div>
        </Card>
      </div>

      {report.reason && (
        <Card className="p-4 gap-0 mb-4">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Reason given
          </div>
          <p className="text-sm whitespace-pre-wrap break-words">{report.reason}</p>
        </Card>
      )}

      <Card className="p-4 gap-0 mb-4 ring-violet-300 dark:ring-violet-500/30">
        <div className="text-xs font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wide mb-1">
          🤖 AI analysis
        </div>
        {report.ai_at ? (
          <>
            <div className="text-sm">
              <span className="font-semibold capitalize">{report.ai_verdict || ","}</span>
              {report.ai_score != null && (
                <span className="text-muted-foreground"> · meanness likelihood {report.ai_score}/100</span>
              )}
            </div>
            {report.ai_summary && (
              <p className="text-sm text-foreground/80 mt-1 whitespace-pre-wrap break-words">
                {report.ai_summary}
              </p>
            )}
            <div className="text-xs text-muted-foreground mt-1">
              analysed {new Date(report.ai_at).toLocaleString()}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No AI result yet , the model may still be running, or OpenRouter/Slack keys aren&apos;t
            configured on the server.
          </p>
        )}
      </Card>

      <Card className="p-4 gap-0 mb-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          {report.target_name}&apos;s chat , last 10h ({chat.length})
        </div>
        {chat.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No stored chat in the last 10 hours (chat is only stored going forward, once the
            migration is applied).
          </p>
        ) : (
          <div className="rounded-lg border border-border divide-y divide-border max-h-96 overflow-y-auto">
            {chat.map((c) => (
              <div key={c.id} className="px-3 py-1.5 text-sm break-words">
                <span className="text-xs text-muted-foreground tabular-nums mr-2">
                  {new Date(c.created_at).toLocaleTimeString()}
                </span>
                {c.text}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4 gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Actions</div>
          {report.status === "open" && (
            <div className="flex gap-2 ml-auto">
              <form action={resolveReport}>
                <input type="hidden" name="id" value={report.id} />
                <input type="hidden" name="action" value="resolve" />
                <PendingButton type="submit" size="sm" variant="outline" pendingText="Resolving…">
                  Mark resolved
                </PendingButton>
              </form>
              <form action={resolveReport}>
                <input type="hidden" name="id" value={report.id} />
                <input type="hidden" name="action" value="dismiss" />
                <PendingButton
                  type="submit"
                  size="sm"
                  variant="ghost"
                  pendingText="Dismissing…"
                  className="text-muted-foreground"
                >
                  Dismiss
                </PendingButton>
              </form>
            </div>
          )}
        </div>

        {(canWarn || canBan || canProposeBan) && (
          <div className="flex flex-col gap-2 pt-2 border-t border-border">
            <div className="text-xs text-muted-foreground">
              On the reported player (<span className="font-medium">{report.target_name}</span>)
            </div>
            <div className="flex gap-3 flex-wrap items-center">
              {canWarn && <WarnForm userId={report.target_id} compact />}
              {canBan && <BanForm userId={report.target_id} compact />}
              {canProposeBan && <ProposeBanForm userId={report.target_id} compact />}
            </div>
          </div>
        )}

        {revealReporter && (canWarn || canBan || canProposeBan) && (
          <div className="flex flex-col gap-2 pt-2 border-t border-border">
            <div className="text-xs text-muted-foreground">
              On the reporter (<span className="font-medium">{report.reporter_name}</span>) , for false or
              abusive reports
            </div>
            <div className="flex gap-3 flex-wrap items-center">
              {canWarn && <WarnForm userId={report.reporter_id} compact />}
              {canBan && <BanForm userId={report.reporter_id} compact />}
              {canProposeBan && <ProposeBanForm userId={report.reporter_id} compact />}
            </div>
          </div>
        )}
        {report.status !== "open" && report.handled_by && (
          <div className="text-xs text-muted-foreground">
            {report.status} by {report.handled_by}
            {report.handled_at ? ` · ${new Date(report.handled_at).toLocaleString()}` : ""}
          </div>
        )}
        {!canBan && !canWarn && !canProposeBan && (
          <div className="text-xs text-muted-foreground">
            You can resolve reports, but banning/warning needs admin or moderator permissions.
          </div>
        )}
      </Card>
    </div>
  );
}
