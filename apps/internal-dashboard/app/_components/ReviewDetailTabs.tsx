"use client";

import { useEffect, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { AiTimePanel } from "@/app/_components/AiTimePanel";
import { ReadmePanel } from "@/app/_components/ReadmePanel";
import type { CommitResult } from "@/lib/commits";
import type { HackatimeReport } from "@/lib/hackatime";
import type { FraudyAiCheck } from "@/lib/fraudy";
import type { JournalRow, ReviewAuditRow } from "@/lib/db";
import type { YswsShip } from "@/lib/ysws";
import { CommitList } from "@/app/_components/CommitList";
import { renderMarkdown } from "@/lib/markdown";
import { HackatimePanel } from "@/app/_components/HackatimePanel";
import { setJournalHours } from "@/app/actions";
import { useLiveMode, useReviewerName } from "@/app/_components/LiveMode";
import { parseAuditNote, type AuditHeader } from "@/lib/auditNote";
import { isSafeUrl } from "@/lib/safeUrl";
import { Badge, Button, Callout, Card, CountBadge, EmptyState, formatDate, formatDateTime, Input, Mono, Muted, Textarea, TextLink, type Tone } from "@/app/_ui/ui";
import { actionErrorMessage } from "@/app/_ui/actionError";

const VERDICT_LABEL: Record<string, { label: string; tone: Tone }> = {
  approved: { label: "Approved", tone: "success" },
  first_pass_approved: { label: "Approved (1st pass)", tone: "success" },
  needs_changes: { label: "Needs changes", tone: "danger" },
  banned: { label: "Banned", tone: "danger" },
  first_pass_banned: { label: "Ban proposed", tone: "danger" },
  reverted: { label: "Reverted", tone: "info" },
};

// The structured audit-note sections (buildAuditNote in lib/auditNote.ts),
// same labels as the Audit notes page.
const SECTION_LABEL: Record<AuditHeader, string> = {
  "TECHNICAL FEATURES": "Technical features",
  "DEFLATION REASON": "Deflation reason",
  "AGE JUSTIFICATION": "Age justification",
  NOTES: "Additional notes",
};

export interface YswsImport {
  ysws: string;
  hours: number;
  approvedAt: string | null;
}

// HURT reads ?repo= on load and pulls the repo apart in-page, so the reviewer
// never has to leave the dashboard to run a fraud check.
const HURT_URL = "https://hurt-xi.vercel.app";

// Deliberately not encodeURIComponent'd: HURT's own GitHub API calls choke on
// a percent-encoded repo URL. It also 404s on a trailing .git, so strip that.
function hurtSrc(repoUrl: string): string {
  return `${HURT_URL}/?repo=${repoUrl.replace(/\.git\/?$/i, "")}`;
}

// HURT only accepts github.com URLs; anything else leaves it on an empty
// input, so the tab is hidden rather than shown broken.
function isGithubUrl(url: string | null): url is string {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "github.com" || host === "www.github.com";
  } catch {
    return false;
  }
}

// Per-entry credit, outside the main verdict form. Lowering it below the
// claimed hours needs a written reason, same rule as the verdict form's
// deflationReason (setJournalHours enforces it server-side too).
function JournalHoursForm({
  journalId,
  projectId,
  claimed,
  approvedHours,
  deflationReason,
}: {
  journalId: number;
  projectId: number;
  claimed: number;
  approvedHours: number | null;
  deflationReason: string | null;
}) {
  const [value, setValue] = useState(String(approvedHours ?? claimed));
  // Seeded from the persisted reason so reopening shows what was written.
  const [reason, setReason] = useState(deflationReason ?? "");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const numeric = Number(value);
  const willDeflate = value.trim() !== "" && Number.isFinite(numeric) && numeric < claimed;

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget);
    setResult(null);
    startTransition(async () => {
      try {
        await setJournalHours(fd);
        setResult({ ok: true, text: "Saved." });
      } catch (err) {
        setResult({ ok: false, text: actionErrorMessage(err, "save this entry's hours") });
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <input type="hidden" name="journalId" value={journalId} />
      <input type="hidden" name="projectId" value={projectId} />
      <label className="flex flex-wrap items-center gap-2">
        <span className="hc-label">Credit</span>
        <Input
          name="hours"
          type="number"
          min={0}
          max={claimed}
          step="0.1"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setResult(null);
          }}
          className="w-24"
        />
        <Muted className="text-sm">/ {claimed}h</Muted>
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Set"}
        </Button>
        {result?.ok && <span className="hc-save-status" data-tone="success">{result.text}</span>}
      </label>
      {willDeflate && (
        <Textarea
          name="deflationReason"
          required
          rows={2}
          placeholder="Why lower this entry's hours? (required)"
          className="max-w-md"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      )}
      {result && !result.ok && (
        <Callout tone="danger" icon="important">
          {result.text}
        </Callout>
      )}
    </form>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="hc-eyebrow mb-1">{label}</p>
      <p className="whitespace-pre-wrap break-words text-sm">{children}</p>
    </div>
  );
}

type TabKey = "commits" | "readme" | "journals" | "reviews" | "ysws" | "hackatime" | "fraud" | "ai_time";

export function ReviewDetailTabs({
  projectId,
  commits,
  journals,
  contributorNames,
  reviewAudits,
  yswsShips,
  yswsImport,
  hackatime,
  repoUrl,
  projectKind,
  usedAi,
  aiNotes,
  fraudyChecks,
  canViewAiTime,
}: {
  projectId: number;
  commits: CommitResult;
  journals: JournalRow[];
  /** user_id -> display name, owner plus accepted collaborators. Entries are
   * only labelled when there's more than one contributor to tell apart. */
  contributorNames: Record<string, string>;
  reviewAudits: ReviewAuditRow[];
  yswsShips: YswsShip[];
  yswsImport: YswsImport | null;
  hackatime: HackatimeReport | null;
  repoUrl: string | null;
  projectKind: string;
  usedAi: boolean;
  aiNotes: string | null;
  /** Hackatime project name -> Fraudy's check-ai result. */
  fraudyChecks: Record<string, FraudyAiCheck | null>;
  /** Owner or second-pass reviewer only - hidden from first-pass-only reviewers. */
  canViewAiTime: boolean;
}) {
  // Live mode keeps each past review's verdict and hours but drops its
  // internal audit-note sections (technical features, deflation reason, ...).
  const live = useLiveMode();
  const reviewerName = useReviewerName();
  const [tab, setTab] = useState<TabKey>("commits");
  const [commitsState, setCommitsState] = useState(commits);

  useEffect(() => {
    setCommitsState(commits);
  }, [commits]);

  // Don't load a third-party app on every review page: mount the frame the
  // first time the tab is opened, then keep it mounted.
  const [fraudOpened, setFraudOpened] = useState(false);
  // HURT is a hardware fraud check (CAD/BOM/wiring evidence), noise on software.
  const fraudRepo = projectKind === "hardware" && isGithubUrl(repoUrl) ? repoUrl : null;

  useEffect(() => {
    if (tab === "fraud") setFraudOpened(true);
  }, [tab]);

  // The page header links to #hackatime.
  useEffect(() => {
    const open = () => {
      if (location.hash === "#hackatime" && hackatime) setTab("hackatime");
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, [hackatime]);

  const yswsMatches = yswsShips.filter((s) => s.urlMatch);
  const multipleContributors = Object.keys(contributorNames).length > 1;

  const tabs: { key: TabKey; label: string; count?: number | string }[] = [
    {
      key: "commits",
      label: "Commits",
      count: commitsState.hasMore ? `${commitsState.commits.length}+` : commitsState.commits.length,
    },
    ...(repoUrl ? [{ key: "readme" as const, label: "README" }] : []),
    { key: "journals", label: "Journals", count: journals.length },
    ...(hackatime?.ok
      ? [{ key: "hackatime" as const, label: "Hackatime", count: hackatime.projects.filter((p) => p.linked).length }]
      : []),
    { key: "reviews", label: "Past reviews", count: reviewAudits.length },
    { key: "ysws", label: "Other YSWS", count: yswsMatches.length + (yswsImport ? 1 : 0) },
    ...(fraudRepo ? [{ key: "fraud" as const, label: "HURT check" }] : []),
    ...(canViewAiTime ? [{ key: "ai_time" as const, label: "AI time" }] : []),
  ];

  // The earliest/latest tracked Hackatime activity, so a reviewer can compare
  // it against each other ship's approval date (the archive has no start date,
  // so overlap can't be proven outright).
  const trackedRange = (() => {
    const linked = (hackatime?.projects ?? []).filter((p) => p.linked);
    const firsts = linked.map((p) => p.firstActivity).filter((n): n is number => n != null);
    const lasts = linked.map((p) => p.lastActivity).filter((n): n is number => n != null);
    if (firsts.length === 0 || lasts.length === 0) return null;
    return { first: Math.min(...firsts), last: Math.max(...lasts) };
  })();

  return (
    <Card padding="flush">
      <div className="hc-tabs hc-tabs-fill" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className="hc-tab gap-2"
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.count !== undefined && <CountBadge>{t.count}</CountBadge>}
          </button>
        ))}
      </div>

      <div role="tabpanel" hidden={tab !== "commits"}>
        <CommitList result={commitsState} projectId={projectId} onCommitsChange={setCommitsState} />
      </div>

      <div role="tabpanel" hidden={tab !== "readme"}>
        <ReadmePanel projectId={projectId} active={tab === "readme"} />
      </div>

      {hackatime && (
        <div role="tabpanel" hidden={tab !== "hackatime"}>
          <HackatimePanel report={hackatime} />
        </div>
      )}

      <div role="tabpanel" hidden={tab !== "journals"}>
        {journals.length === 0 ? (
          <EmptyState title="No journal entries" icon="docs" />
        ) : (
          <ul>
            {journals.map((j) => {
              const claimed = Math.round((Number(j.hours) || 0) * 10) / 10;
              const deflated = j.approved_hours != null && Number(j.approved_hours) !== claimed;
              return (
                <li key={j.id} className="flex flex-col gap-2 border-b border-[var(--border)] p-4 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {multipleContributors && <Badge outline>{contributorNames[j.user_id] ?? "unknown"}</Badge>}
                    <span className={deflated ? "line-through opacity-60" : ""}>
                      <Badge>{claimed}h claimed</Badge>
                    </span>
                    {deflated && (
                      <Badge tone="warning">{Math.round(Number(j.approved_hours) * 10) / 10}h credited</Badge>
                    )}
                    {j.edited_at && <Muted className="text-xs">edited {formatDateTime(j.edited_at)}</Muted>}
                    <Muted className="ml-auto text-xs">{formatDateTime(j.created_at)}</Muted>
                  </div>
                  {j.title && <p className="text-sm font-bold">{j.title}</p>}
                  <div
                    className="hc-markdown text-sm"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(j.content) }}
                  />
                  <JournalHoursForm
                    journalId={j.id}
                    projectId={projectId}
                    claimed={claimed}
                    approvedHours={j.approved_hours}
                    deflationReason={j.deflation_reason}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div role="tabpanel" hidden={tab !== "ysws"}>
        {yswsImport && (
          <div className="border-b border-[var(--border)] p-4">
            <Callout tone="info" icon="important">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Badge tone="info">imported from {yswsImport.ysws}</Badge>
                <Badge>{yswsImport.hours}h there</Badge>
                {yswsImport.approvedAt && (
                  <Muted className="text-xs">approved {formatDate(yswsImport.approvedAt)}</Muted>
                )}
              </div>
              The maker brought this in through the importer, so the earlier ship was declared up front. This is not an
              undisclosed double dip. Those {yswsImport.hours}h were not credited here; only time tracked since the
              import counts. Credit the new work, not the whole project.
            </Callout>
          </div>
        )}
        {yswsMatches.length === 0 ? (
          <EmptyState title="No other YSWS ships" icon="checkmark">
            {yswsImport
              ? "The archive doesn't match this project's current repo or demo, so the links were edited since it was imported. The import record above still applies."
              : "This project's repo and demo aren't in the YSWS archive. No sign it was double-dipped."}
          </EmptyState>
        ) : (
          <>
            <div className="flex flex-col gap-2 border-b border-[var(--border)] p-4">
              <Callout tone="danger" icon="important">
                This exact project also shipped to another YSWS.
              </Callout>
              {trackedRange && (
                <p className="hc-caption text-sm">
                  This project&apos;s own tracked coding time here:{" "}
                  <Mono>
                    {formatDate(trackedRange.first * 1000)} to{" "}
                    {formatDate(trackedRange.last * 1000)}
                  </Mono>
                  . Compare it against each ship&apos;s approval date below to judge overlap.
                </p>
              )}
            </div>
            <ul>
              {yswsMatches.map((s, i) => (
                <li key={i} className="flex flex-col gap-1 border-b border-[var(--border)] p-4 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold">{s.ysws}</span>
                    <Badge tone="danger">same repo/demo as this submission</Badge>
                    <Badge>{s.hours}h</Badge>
                    <Muted className="ml-auto text-xs">
                      {s.approvedAt ? `approved ${formatDate(s.approvedAt)}` : "no date"}
                    </Muted>
                  </div>
                  {s.description && <p className="hc-caption break-words text-sm">{s.description}</p>}
                  <div className="flex gap-3 text-sm">
                    {s.codeUrl && s.codeUrl !== "null" && isSafeUrl(s.codeUrl) && (
                      <TextLink href={s.codeUrl} external>
                        Repo
                      </TextLink>
                    )}
                    {s.demoUrl && s.demoUrl !== "null" && isSafeUrl(s.demoUrl) && (
                      <TextLink href={s.demoUrl} external>
                        Demo
                      </TextLink>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {fraudRepo && (
        <div role="tabpanel" hidden={tab !== "fraud"}>
          <div className="hc-caption flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 text-sm">
            <span className="min-w-0">
              HURT, loaded with <Mono>{fraudRepo}</Mono>
            </span>
            <TextLink href={hurtSrc(fraudRepo)} external className="ml-auto shrink-0">
              Open full screen
            </TextLink>
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
            <p className="hc-caption p-6 text-sm">Loading…</p>
          )}
        </div>
      )}

      <div role="tabpanel" hidden={tab !== "reviews"}>
        {reviewAudits.length === 0 ? (
          <EmptyState title="No past reviews" icon="history">
            This is the first time anyone is reviewing it.
          </EmptyState>
        ) : (
          <ul>
            {reviewAudits.map((v) => {
              const meta = VERDICT_LABEL[v.verdict] ?? { label: v.verdict.replaceAll("_", " "), tone: "neutral" as const };
              const sections = v.audit_note && !live ? parseAuditNote(v.audit_note) : null;
              const sectionKeys = sections
                ? (Object.keys(SECTION_LABEL) as AuditHeader[]).filter((h) => sections[h]?.trim())
                : [];
              const hasMore = sectionKeys.length > 0 || !!v.note?.trim();
              return (
                <li key={v.id} className="border-b border-[var(--border)] p-3 last:border-b-0">
                  <details className="hc-details">
                    <summary>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <span className="min-w-0 flex-1">
                        {reviewerName(v.reviewer)}
                        <Muted>
                          {v.approved_hours !== null && v.approved_hours !== v.claimed_hours
                            ? ` · ${v.claimed_hours}h → ${v.approved_hours}h credited`
                            : ` · ${v.claimed_hours}h credited`}
                        </Muted>
                      </span>
                      <Muted className="text-xs font-normal">{formatDateTime(v.created_at)}</Muted>
                    </summary>
                    <div className="hc-details-body flex flex-col gap-3">
                      {v.note?.trim() && <Section label="Note to player">{v.note}</Section>}
                      {sections && sectionKeys.map((h) => (
                        <Section key={h} label={SECTION_LABEL[h]}>
                          {sections[h]}
                        </Section>
                      ))}
                      {!hasMore && <p className="hc-caption text-sm">No additional notes.</p>}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {canViewAiTime && (
        <div role="tabpanel" hidden={tab !== "ai_time"}>
          <AiTimePanel
            commits={commitsState.commits}
            hackatime={hackatime}
            usedAi={usedAi}
            aiNotes={aiNotes}
            fraudyChecks={fraudyChecks}
          />
        </div>
      )}
    </Card>
  );
}
