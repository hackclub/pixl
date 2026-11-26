import { requirePage } from "@/lib/guard";
import { listReports } from "@/lib/db";
import {
  Badge,
  Card,
  EmptyRow,
  Flash,
  LinkTabs,
  Muted,
  PageHeader,
  Table,
  TextLink,
  formatDateTime,
} from "@/app/_ui/ui";
import { REPEAT_THRESHOLD, REPORT_STATUS_TONE, aiTone } from "./tones";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; verror?: string }>;
}) {
  await requirePage("owner");
  const { status, verror } = await searchParams;
  const all = await listReports(500);

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        count={openCount}
        description="Players flagged by other players. Owners only. Each report runs an AI pass over the reported player's recent chat."
      />

      <Flash error={verror} />

      <Card padding="flush">
        <LinkTabs
          active={activeStatus}
          tabs={[
            { key: "open", href: "/reports", label: "Open", count: openCount },
            { key: "resolved", href: "/reports?status=resolved", label: "Resolved" },
            { key: "dismissed", href: "/reports?status=dismissed", label: "Dismissed" },
            { key: "all", href: "/reports?status=all", label: "All", count: all.length },
          ]}
        />
        <Table headers={["Reported player", "Status", "AI verdict", "Reported by", "Filed"]}>
          {rows.map((r) => {
            const targetTotal = targetCounts.get(r.target_id) ?? 0;
            const reporterFlagged = (reporterCounts.get(r.reporter_id) ?? 0) >= REPEAT_THRESHOLD;
            return (
              <tr key={r.id}>
                <td className="max-w-md">
                  <div className="flex flex-wrap items-center gap-2">
                    <TextLink href={`/reports/${r.id}`} className="font-bold">
                      {r.target_name}
                    </TextLink>
                    {targetTotal >= REPEAT_THRESHOLD && (
                      <Badge tone="danger" icon="flag">
                        {targetTotal} reports
                      </Badge>
                    )}
                  </div>
                  {r.reason && <div className="mt-1 line-clamp-2 text-sm break-words">{r.reason}</div>}
                  {r.ai_summary && (
                    <div className="mt-1 line-clamp-2 text-xs break-words">
                      <Muted>AI: {r.ai_summary}</Muted>
                    </div>
                  )}
                </td>
                <td>
                  <Badge tone={REPORT_STATUS_TONE[r.status] ?? "neutral"}>
                    <span className="capitalize">{r.status}</span>
                  </Badge>
                </td>
                <td>
                  {r.ai_verdict ? (
                    <Badge tone={aiTone(r.ai_verdict)}>
                      <span className="capitalize">{r.ai_verdict}</span>
                      {r.ai_score != null ? ` ${r.ai_score}/100` : ""}
                    </Badge>
                  ) : (
                    <Muted>-</Muted>
                  )}
                </td>
                <td>
                  {!r.anonymous || reporterFlagged ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {r.reporter_name}
                      {r.anonymous && (
                        <Badge tone="danger" icon="flag">
                          Unmasked
                        </Badge>
                      )}
                    </span>
                  ) : (
                    <Muted>Anonymous</Muted>
                  )}
                </td>
                <td className="whitespace-nowrap">
                  <Muted>{formatDateTime(r.created_at)}</Muted>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <EmptyRow colSpan={5} title="No reports here" icon="checkmark-all">
              Nothing matches this filter.
            </EmptyRow>
          )}
        </Table>
      </Card>
    </div>
  );
}
