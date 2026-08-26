"use client";

import { useEffect, useState } from "react";
import type { CommitResult } from "@/lib/github";
import type { HackatimeReport } from "@/lib/hackatime";
import type { JournalRow, ModActionRow } from "@/lib/db";
import type { YswsShip } from "@/lib/ysws";
import { CommitList } from "@/app/_components/CommitList";
import { renderMarkdown } from "@/lib/markdown";
import { HackatimePanel } from "@/app/_components/HackatimePanel";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const VERDICT_LABEL: Record<
  string,
  { label: string; variant: "success" | "destructive" | "info" }
> = {
  project_approved: { label: "Approved", variant: "success" },
  project_needs_changes: { label: "Needs changes", variant: "destructive" },
  review_reverted: { label: "Reverted", variant: "info" },
  project_sent_to_first_pass: { label: "Sent to first pass", variant: "info" },
};

export interface YswsImport {
  ysws: string;
  hours: number;
  approvedAt: string | null;
}

// HURT reads ?repo= on load and pulls the repo apart in-page, so the reviewer
// never has to leave the dashboard to run a fraud check.
const HURT_URL = "https://hurt-xi.vercel.app";

// HURT reads this with URLSearchParams, which unescapes it fine either way,
// but its own GitHub API calls choke on a percent-encoded repo URL (the
// colon/slashes need to reach it literal) , so this must NOT be
// encodeURIComponent'd like a normal query value.
function hurtSrc(repoUrl: string): string {
  return `${HURT_URL}/?repo=${repoUrl}`;
}

// HURT only accepts github.com URLs , anything else (GitLab, a zip, a bare
// domain) makes it ignore the param and sit on its own empty input, so the tab
// is hidden rather than shown broken.
function isGithubUrl(url: string | null): url is string {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "github.com" || host === "www.github.com";
  } catch {
    return false;
  }
}

export function ReviewDetailTabs({
  commits,
  journals,
  verdicts,
  yswsShips,
  yswsImport,
  hackatime,
  repoUrl,
  projectKind,
}: {
  commits: CommitResult;
  journals: JournalRow[];
  verdicts: ModActionRow[];
  yswsShips: YswsShip[];
  yswsImport: YswsImport | null;
  hackatime: HackatimeReport | null;
  repoUrl: string | null;
  projectKind: string;
}) {
  const [tab, setTab] = useState<
    "commits" | "journals" | "reviews" | "ysws" | "hackatime" | "fraud"
  >("commits");
  // Don't make every review page load a third-party app , mount the frame the
  // first time a reviewer actually opens the tab, then keep it mounted.
  const [fraudOpened, setFraudOpened] = useState(false);
  // HURT is a hardware fraud-check tool (it inspects the repo for CAD/BOM/wiring
  // evidence) — irrelevant noise on a software project's review page.
  const fraudRepo = projectKind === "hardware" && isGithubUrl(repoUrl) ? repoUrl : null;

  useEffect(() => {
    if (tab === "fraud") setFraudOpened(true);
  }, [tab]);

  useEffect(() => {
    const open = () => {
      if (location.hash === "#hackatime" && hackatime) setTab("hackatime");
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, [hackatime]);

  const tabs: { key: typeof tab; label: string; count?: number }[] = [
    { key: "commits" as const, label: "Commits", count: commits.commits.length },
    { key: "journals" as const, label: "Journals", count: journals.length },
    ...(hackatime?.ok
      ? [{ key: "hackatime" as const, label: "Hackatime", count: hackatime.projects.filter((p) => p.linked).length }]
      : []),
    { key: "reviews" as const, label: "Past reviews", count: verdicts.length },
    {
      key: "ysws" as const,
      label: "Other YSWS",
      count: yswsShips.filter((s) => s.urlMatch).length + (yswsImport ? 1 : 0),
    },
    ...(fraudRepo ? [{ key: "fraud" as const, label: "HURT check" }] : []),
  ];

  return (
    <Card className="overflow-hidden py-0">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as typeof tab)}
        className="gap-0"
      >
        <TabsList
          variant="line"
          className="h-auto w-full justify-start rounded-none border-b border-border px-2"
        >
          {tabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="py-3">
              {t.label}
              {t.count !== undefined && (
                <Badge
                  variant={tab === t.key ? "default" : "secondary"}
                  className="ml-1"
                >
                  {t.count}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="commits">
          <CommitList result={commits} />
        </TabsContent>

        {hackatime && (
          <TabsContent value="hackatime">
            <HackatimePanel report={hackatime} />
          </TabsContent>
        )}

        <TabsContent value="journals">
          <div className="divide-y divide-border">
            {journals.length === 0 && (
              <div className="p-5 text-sm text-muted-foreground">
                No journal entries.
              </div>
            )}
            {journals.map((j) => (
              <div key={j.id} className="p-4">
                <div className="flex items-center gap-3 mb-1">
                  <Badge variant="secondary">
                    {Math.round((Number(j.hours) || 0) * 10) / 10}h
                  </Badge>
                  {j.edited_at && (
                    <span className="text-xs text-muted-foreground">
                      edited {new Date(j.edited_at).toLocaleString()}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto">
                    {new Date(j.created_at).toLocaleString()}
                  </span>
                </div>
                <div
                  className="md text-sm break-words text-foreground/80"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(j.content) }}
                />
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="ysws">
          {yswsImport && (
            <div className="p-4 border-b border-border bg-muted/40">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <Badge variant="info">imported from {yswsImport.ysws}</Badge>
                <Badge variant="secondary">{yswsImport.hours}h there</Badge>
                {yswsImport.approvedAt && (
                  <span className="text-xs text-muted-foreground ml-auto">
                    approved {new Date(yswsImport.approvedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className="text-sm text-foreground/70">
                The maker brought this in through the importer, so the earlier ship was
                declared up front , this is not an undisclosed double dip. Those{" "}
                {yswsImport.hours}h were not credited here; only time tracked since the
                import counts. Credit the new work, not the whole project.
              </div>
            </div>
          )}
          {(() => {
            const matches = yswsShips.filter((s) => s.urlMatch);
            const Row = (s: YswsShip, i: number) => (
              <div key={i} className="p-4">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-medium text-sm">{s.ysws}</span>
                  {s.urlMatch && (
                    <Badge variant="destructive">
                      same repo/demo as this submission
                    </Badge>
                  )}
                  <Badge variant="secondary">{s.hours}h</Badge>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {s.approvedAt
                      ? `approved ${new Date(s.approvedAt).toLocaleDateString()}`
                      : "no date"}
                  </span>
                </div>
                {s.description && (
                  <div className="text-sm text-foreground/70 break-words mb-1">
                    {s.description}
                  </div>
                )}
                <div className="flex gap-3 text-xs">
                  {s.codeUrl && s.codeUrl !== "null" && (
                    <a href={s.codeUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      repo ↗
                    </a>
                  )}
                  {s.demoUrl && s.demoUrl !== "null" && (
                    <a href={s.demoUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      demo ↗
                    </a>
                  )}
                </div>
              </div>
            );
            return (
              <div className="divide-y divide-border">
                {matches.length === 0 ? (
                  <div className="p-5 text-sm text-muted-foreground">
                    {yswsImport
                      ? "The archive doesn't match this project's current repo/demo , the links were edited since it was imported. The import record above still applies."
                      : "This project's repo/demo isn't in the YSWS archive , no sign it was double-dipped."}
                  </div>
                ) : (
                  <>
                    <div className="px-4 pt-4 text-xs font-semibold uppercase tracking-wide text-destructive">
                      ⚠ This exact project also shipped to another YSWS
                    </div>
                    {matches.map(Row)}
                  </>
                )}
              </div>
            );
          })()}
        </TabsContent>

        {fraudRepo && (
          <TabsContent value="fraud">
            <div className="flex items-center gap-3 border-b border-border px-4 py-2 text-xs text-muted-foreground">
              <span>
                HURT, loaded with{" "}
                <span className="font-mono break-all text-foreground/80">{fraudRepo}</span>
              </span>
              <a
                href={hurtSrc(fraudRepo)}
                target="_blank"
                rel="noreferrer"
                className="ml-auto shrink-0 text-primary hover:underline"
              >
                open full screen ↗
              </a>
            </div>
            {fraudOpened ? (
              <iframe
                key={fraudRepo}
                src={hurtSrc(fraudRepo)}
                title="HURT check"
                className="block h-[80vh] w-full border-0 bg-white"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="p-5 text-sm text-muted-foreground">Loading…</div>
            )}
          </TabsContent>
        )}

        <TabsContent value="reviews">
          <div className="divide-y divide-border">
            {verdicts.length === 0 && (
              <div className="p-5 text-sm text-muted-foreground">
                No past reviews.
              </div>
            )}
            {verdicts.map((v) => {
              const meta = VERDICT_LABEL[v.action] ?? {
                label: v.action,
                variant: "secondary" as const,
              };
              return (
                <div
                  key={v.id}
                  className="p-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
                >
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                  <div className="flex-1 min-w-48">
                    <span className="font-medium">{v.actor}</span>
                    <div className="text-foreground/70 break-words">{v.detail}</div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(v.created_at).toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </Card>
  );
}
