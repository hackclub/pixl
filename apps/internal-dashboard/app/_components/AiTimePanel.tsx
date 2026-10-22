"use client";

import type { Commit } from "@/lib/commits";
import type { HackatimeReport } from "@/lib/hackatime";
import type { FraudyAiCheck } from "@/lib/fraudy";
import { fraudyHours } from "@/lib/fraudy";
import { Badge, Callout, EmptyState, Mono, Muted, Stat, StatGrid } from "@/app/_ui/ui";

// Cross-references what the maker declared, Fraudy's own human/AI split of
// their tracked Hackatime time, and which commits an AI tool signed - three
// independent, imperfect signals that corroborate (or contradict) each
// other.
export function AiTimePanel({
  commits,
  hackatime,
  usedAi,
  aiNotes,
  fraudyChecks,
}: {
  commits: Commit[];
  hackatime: HackatimeReport | null;
  usedAi: boolean;
  aiNotes: string | null;
  /** Hackatime project name -> Fraudy's check-ai result, null when Fraudy had
   * no numbers for that project. */
  fraudyChecks: Record<string, FraudyAiCheck | null>;
}) {
  const aiCommits = commits.filter((c) => c.ai);
  const mismatch = aiCommits.length > 0 && !usedAi;
  const linked = (hackatime?.projects ?? []).filter((p) => p.linked);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <p className="hc-eyebrow mb-1">Maker&apos;s AI declaration</p>
        {usedAi ? (
          <p className="whitespace-pre-wrap break-words text-sm">
            {aiNotes || "Ticked “AI used” but gave no details (pre-dates the details field)."}
          </p>
        ) : (
          <p className="hc-caption text-sm">Maker did not declare AI use.</p>
        )}
      </div>

      {mismatch && (
        <Callout tone="danger" icon="important">
          {aiCommits.length} commit{aiCommits.length === 1 ? "" : "s"} in this repo{" "}
          {aiCommits.length === 1 ? "is" : "are"} signed by an AI tool, but the maker did not tick &ldquo;AI
          used&rdquo;.
        </Callout>
      )}

      <div>
        <p className="hc-eyebrow mb-2">Fraudy AI check</p>
        {linked.length === 0 ? (
          <p className="hc-caption text-sm">No linked Hackatime projects to check.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {linked.map((hp) => {
              const check = fraudyChecks[hp.name];
              return (
                <li key={hp.name} className="flex flex-col gap-2 border-b border-[var(--border)] pb-2 last:border-b-0">
                  <span className="text-sm font-bold">{hp.name}</span>
                  {!check ? (
                    <Badge outline>Fraudy has no data for {hp.name}</Badge>
                  ) : (
                    <StatGrid>
                      <Stat label="Human seconds" value={`${fraudyHours(check.humanSeconds)}h`} icon="clock" />
                      <Stat
                        label="AI seconds"
                        value={`${fraudyHours(check.aiSeconds)}h`}
                        tone={check.aiSeconds > 0 ? "warning" : undefined}
                      />
                      <Stat
                        label="Recommended deflation"
                        value={check.deflationSeconds > 0 ? `${fraudyHours(check.deflationSeconds)}h` : "none"}
                        tone={check.deflationSeconds > 0 ? "danger" : "success"}
                      />
                    </StatGrid>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <p className="hc-eyebrow mb-2">Commits signed by an AI tool ({aiCommits.length})</p>
        {aiCommits.length === 0 ? (
          <EmptyState title="No AI-signed commits" icon="checkmark">
            No sign in commit messages or authorship of an AI tool committing directly. This only catches tools
            that announce themselves, so absence proves nothing.
          </EmptyState>
        ) : (
          <ul>
            {aiCommits.map((c) => (
              <li key={c.sha} className="flex flex-col gap-1 border-b border-[var(--border)] py-2 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Mono>{c.sha.slice(0, 7)}</Mono>
                  <Badge tone="warning" icon="important">
                    AI signed
                  </Badge>
                  <Muted className="ml-auto text-xs">{c.author}</Muted>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">{c.message}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
