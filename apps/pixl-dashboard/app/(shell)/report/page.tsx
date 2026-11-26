import type { Metadata } from "next";
import { Card, CardTitle, PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { serverApi } from "@/lib/server-api";
import { ReportForm } from "./report-form";

export const metadata: Metadata = { title: "Report a player" };

interface MyReport {
  id?: number | string;
  target_name: string;
  status: string;
  anonymous: boolean;
  reason?: string | null;
  created_at: string;
}

const tag = "border-2 border-stroke px-[7px] py-[2px] text-[11px]";

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!isFinite(s)) return "";
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US");
}

export default async function ReportPage() {
  const mine = (await serverApi<{ reports?: MyReport[] }>("/api/reports/mine"))?.reports ?? [];

  return (
    <div className="mx-auto max-w-[720px]">
      <PageHeader title="REPORT A PLAYER" sub="Seen someone being mean? Let the team know. You can stay anonymous." />

      <Card className="mb-6">
        <CardTitle className="mb-3 text-gold">FILE A REPORT</CardTitle>
        <ReportForm />
      </Card>

      <Card>
        <CardTitle className="mb-3 text-gold">YOUR REPORTS</CardTitle>
        {mine.length === 0 ? (
          <p className="p-1.5 text-sm text-faint">You haven&apos;t filed any reports.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {mine.map((r, i) => {
              const done = r.status !== "open";
              return (
                <div key={String(r.id ?? i)} className="border-2 border-stroke bg-panel-deep px-[14px] py-[12px]">
                  <div className="flex flex-wrap items-baseline gap-[10px]">
                    <span className="font-bold">{r.target_name}</span>
                    <span className={cn(tag, done ? "text-teal" : "text-gold")}>{done ? r.status.toUpperCase() : "OPEN"}</span>
                    <span className={cn(tag, "text-faint")}>{r.anonymous ? "ANONYMOUS" : "IDENTITY SHARED"}</span>
                    <span className="ml-auto text-[12px] text-faint">{timeAgo(r.created_at)}</span>
                  </div>
                  {r.reason ? <div className="mt-[6px] text-[13.5px] leading-[1.5] whitespace-pre-wrap">{r.reason}</div> : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
