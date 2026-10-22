"use client";

import type { Commit } from "@/lib/commits";
import { classifyAiEditorTime } from "@/lib/aiEditorTime";
import type { HackatimeReport } from "@/lib/hackatime";
import { Badge, Callout, EmptyState, Mono, Muted, Stat, StatGrid } from "@/app/_ui/ui";

function fmtSecs(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Cross-references what the maker declared, what Hackatime tracked them
// coding in, and which commits an AI tool signed - three independent,
// imperfect signals that corroborate (or contradict) each other.
export function AiTimePanel({
  commits,
  hackatime,
  usedAi,
  aiNotes,
}: {
  commits: Commit[];
  hackatime: HackatimeReport | null;
  usedAi: boolean;
  aiNotes: string | null;
}) {
  const aiCommits = commits.filter((c) => c.ai);
  const split = hackatime?.ok ? classifyAiEditorTime(hackatime.editors) : null;
  const mismatch = aiCommits.length > 0 && !usedAi;

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
        <p className="hc-eyebrow mb-2">Hackatime editor time</p>
        {split && split.totalSeconds > 0 ? (
          <StatGrid>
            <Stat
              label="In AI-assisted editors"
              value={fmtSecs(split.aiSeconds)}
              icon="clock"
              tone={split.aiSeconds > 0 ? "warning" : undefined}
              hint={`of ${fmtSecs(split.totalSeconds)} tracked`}
            />
            <Stat
              label="AI editors used"
              value={split.aiEditors.length > 0 ? split.aiEditors.map((e) => e.name).join(", ") : "none"}
            />
          </StatGrid>
        ) : (
          <p className="hc-caption text-sm">No Hackatime editor data available for this maker.</p>
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
