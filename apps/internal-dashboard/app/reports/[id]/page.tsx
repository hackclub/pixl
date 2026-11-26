import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/guard";
import { getReport, listChatFor, reportCounts } from "@/lib/db";
import { resolveReport } from "@/app/actions";
import { BanForm, WarnForm } from "@/app/_components/Moderate";
import SlackName from "@/app/_ui/SlackName";
import {
  ActionButton,
  Badge,
  Card,
  CardHeader,
  DescriptionList,
  EmptyState,
  Icon,
  Muted,
  PageHeader,
  TextLink,
  formatDateTime,
} from "@/app/_ui/ui";
import { REPEAT_THRESHOLD, REPORT_STATUS_TONE, aiTone } from "../tones";

export const dynamic = "force-dynamic";

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePage("owner");
  const { id } = await params;
  const report = await getReport(Number(id));
  if (!report) notFound();

  // Reports are owner-only, so whoever is here can warn and ban.
  const [chat, counts] = await Promise.all([
    listChatFor(report.target_id, 10),
    reportCounts(report.target_id, report.reporter_id),
  ]);

  // Serial reporters get deanonymized to viewers; heavily-reported targets get
  // flagged for a closer look.
  const revealReporter = !report.anonymous || counts.byReporter >= REPEAT_THRESHOLD;
  const targetFlagged = counts.againstTarget >= REPEAT_THRESHOLD;

  let reporterNote: string | null = null;
  if (report.anonymous && revealReporter) {
    reporterNote = `Asked to stay anonymous, revealed because they filed ${counts.byReporter} reports.`;
  } else if (report.anonymous) {
    reporterNote = "Identity hidden by the reporter.";
  } else if (counts.byReporter >= REPEAT_THRESHOLD) {
    reporterNote = `${counts.byReporter} reports filed.`;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <TextLink href="/reports" className="inline-flex items-center gap-1 text-sm">
          <Icon glyph="view-back" size={18} />
          All reports
        </TextLink>
      </div>

      <PageHeader
        title={
          <>
            Report on {report.target_name}
            <Badge tone={REPORT_STATUS_TONE[report.status] ?? "neutral"}>
              <span className="capitalize">{report.status}</span>
            </Badge>
            {targetFlagged && (
              <Badge tone="danger" icon="flag">
                Repeat-reported ({counts.againstTarget})
              </Badge>
            )}
          </>
        }
        description={`Filed ${formatDateTime(report.created_at)}`}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Reason given" icon="message-simple" />
            {report.reason ? (
              <p className="text-sm break-words whitespace-pre-wrap">{report.reason}</p>
            ) : (
              <Muted className="text-sm">The reporter did not give a reason.</Muted>
            )}
          </Card>

          <Card>
            <CardHeader
              title="AI analysis"
              icon="wand-stars"
              action={
                report.ai_verdict ? (
                  <Badge tone={aiTone(report.ai_verdict)}>
                    <span className="capitalize">{report.ai_verdict}</span>
                    {report.ai_score != null ? ` ${report.ai_score}/100` : ""}
                  </Badge>
                ) : undefined
              }
            />
            {report.ai_at ? (
              <div className="flex flex-col gap-2 text-sm">
                {report.ai_score != null && (
                  <div>
                    Meanness likelihood <span className="font-bold">{report.ai_score}/100</span>
                  </div>
                )}
                {report.ai_summary && <p className="break-words whitespace-pre-wrap">{report.ai_summary}</p>}
                <Muted className="text-xs">Analysed {formatDateTime(report.ai_at)}</Muted>
              </div>
            ) : (
              <Muted className="text-sm">
                No AI result yet. The model may still be running, or the OpenRouter or Slack keys
                are not configured on the server.
              </Muted>
            )}
          </Card>

          <Card padding="flush">
            <CardHeader title={`${report.target_name}'s chat, last 10h`} icon="message-fill" count={chat.length} />
            {chat.length === 0 ? (
              <EmptyState title="No stored chat" icon="message-simple">
                Nothing in the last 10 hours. Chat is only stored going forward.
              </EmptyState>
            ) : (
              <ol className="max-h-96 overflow-y-auto">
                {chat.map((c, i) => (
                  <li
                    key={c.id}
                    className="flex gap-3 px-4 py-2 text-sm break-words"
                    style={i > 0 ? { borderTop: "1px solid var(--border)" } : undefined}
                  >
                    <Muted className="hc-mono shrink-0 text-xs">
                      {new Date(c.created_at).toLocaleTimeString("en-US", { timeZone: "UTC", hour12: false })}
                    </Muted>
                    <span className="min-w-0">{c.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="People" icon="people-2" />
            <DescriptionList
              items={[
                [
                  "Reported",
                  <div key="t">
                    <TextLink href={`/players/${report.target_id}`} className="font-bold">
                      {report.target_name}
                    </TextLink>
                    <div className="text-xs">
                      <Muted>
                        {report.target_slack ? <SlackName id={report.target_slack} /> : "No Slack linked"}
                      </Muted>
                    </div>
                  </div>,
                ],
                [
                  "Reporter",
                  <div key="r">
                    {revealReporter ? (
                      <TextLink href={`/players/${report.reporter_id}`} className="font-bold">
                        {report.reporter_name}
                      </TextLink>
                    ) : (
                      <Muted>Anonymous</Muted>
                    )}
                    {reporterNote && (
                      <div className="text-xs">
                        <Muted>{reporterNote}</Muted>
                      </div>
                    )}
                  </div>,
                ],
                ...(report.status !== "open" && report.handled_by
                  ? ([
                      [
                        <span key="h" className="capitalize">
                          {report.status} by
                        </span>,
                        <div key="hv">
                          {report.handled_by}
                          {report.handled_at && (
                            <div className="text-xs">
                              <Muted>{formatDateTime(report.handled_at)}</Muted>
                            </div>
                          )}
                        </div>,
                      ],
                    ] as [ReactNode, ReactNode][])
                  : []),
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Actions" icon="admin-badge" />
            <div className="flex flex-col gap-4">
              {report.status === "open" && (
                <div className="flex flex-wrap gap-2">
                  <form action={resolveReport}>
                    <input type="hidden" name="id" value={report.id} />
                    <input type="hidden" name="action" value="resolve" />
                    <ActionButton variant="success" size="sm" icon="checkmark" pendingLabel="Resolving...">
                      Mark resolved
                    </ActionButton>
                  </form>
                  <form action={resolveReport}>
                    <input type="hidden" name="id" value={report.id} />
                    <input type="hidden" name="action" value="dismiss" />
                    <ActionButton variant="ghost" size="sm" pendingLabel="Dismissing...">
                      Dismiss
                    </ActionButton>
                  </form>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <p className="hc-eyebrow">On {report.target_name}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <WarnForm userId={report.target_id} compact />
                  <BanForm userId={report.target_id} compact />
                </div>
              </div>

              {revealReporter && (
                <div className="flex flex-col gap-2">
                  <p className="hc-eyebrow">On the reporter, for false or abusive reports</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <WarnForm userId={report.reporter_id} compact />
                    <BanForm userId={report.reporter_id} compact />
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
