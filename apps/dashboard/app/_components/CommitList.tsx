"use client";

import { useState } from "react";
import type { CommitResult } from "@/lib/github";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

const PER_PAGE = 8;

export function CommitList({ result }: { result: CommitResult }) {
  const [page, setPage] = useState(0);

  if (result.error === "not_github")
    return <div className="p-4 text-muted-foreground text-sm">Repo link isn&apos;t a GitHub URL.</div>;
  if (result.error === "not_found")
    return (
      <div className="p-4 text-destructive text-sm font-medium">
        {result.repo} , repo not found or private (404).
      </div>
    );
  if (result.error === "rate_limited")
    return (
      <div className="p-4 text-amber-600 dark:text-amber-400 text-sm font-medium">
        GitHub API rate limit hit , this is not &ldquo;no commits&rdquo;, the commit list
        just couldn&apos;t be fetched right now. Wait a bit and reload, or ask an admin to set
        GITHUB_TOKEN on the dashboard to raise the limit.
      </div>
    );
  if (result.error === "forbidden")
    return (
      <div className="p-4 text-amber-600 dark:text-amber-400 text-sm font-medium">
        GitHub refused this request , not a rate limit, and not &ldquo;no commits&rdquo;.
        {result.detail ? (
          <span className="block mt-1 font-normal text-muted-foreground">{result.detail}</span>
        ) : null}
      </div>
    );
  if (result.error)
    return (
      <div className="p-4 text-muted-foreground text-sm">
        Couldn&apos;t load commits ({result.error}).
      </div>
    );
  if (result.commits.length === 0)
    return <div className="p-4 text-muted-foreground text-sm">No commits.</div>;

  const total = result.commits.length;
  const pages = Math.ceil(total / PER_PAGE);
  const start = page * PER_PAGE;
  const shown = result.commits.slice(start, start + PER_PAGE);
  const hasTracking = result.commits.some((c) => c.tracked !== undefined);

  const gaps = new Map<string, number>();
  const asc = result.commits
    .filter((c) => c.date)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < asc.length; i++) {
    const s =
      (new Date(asc[i].date).getTime() - new Date(asc[i - 1].date).getTime()) / 1000;
    if (Number.isFinite(s) && s >= 0) gaps.set(asc[i].sha, s);
  }
  const fmtGap = (s: number) => {
    if (s < 60) return `${Math.round(s)}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 86400) return `${Math.round(s / 3600)}h`;
    return `${Math.round(s / 86400)}d`;
  };

  const trackedBadge = (secs?: number) => {
    if (secs === undefined) return null;
    if (secs < 120)
      return (
        <Badge
          variant="destructive"
          className="shrink-0"
          title="Almost no tracked coding time between this commit and the previous one , code appeared without coding."
        >
          ~0m coded
        </Badge>
      );
    const h = secs / 3600;
    return (
      <Badge
        variant="secondary"
        className="shrink-0"
        title="Hackatime coding time between this commit and the previous one"
      >
        {h >= 1 ? `${h.toFixed(1)}h` : `${Math.round(secs / 60)}m`} coded
      </Badge>
    );
  };

  return (
    <div>
      {hasTracking && (
        <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border">
          &ldquo;coded&rdquo; = Hackatime time between commits.{" "}
          <span className="text-destructive">~0m coded</span> means code landed
          with no tracked coding behind it , check for pasted/AI-dumped work.
        </div>
      )}
      <Table>
        <TableBody>
          {shown.map((c) => (
            <TableRow key={c.sha} className="hover:bg-transparent">
              <TableCell className="p-3 align-baseline whitespace-normal">
                <div className="flex items-baseline gap-3 text-sm">
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-primary shrink-0 hover:underline"
                  >
                    {c.sha}
                  </a>
                  <span className="flex-1 min-w-0 break-words">{c.message}</span>
                  {c.ai && (
                    <Badge
                      variant="violet"
                      className="shrink-0"
                      title="This commit is signed by an AI tool (co-author trailer / bot author / generated-with footer). Check the AI-used disclosure."
                    >
                      AI commit
                    </Badge>
                  )}
                  {c.additions !== undefined && (
                    <span
                      className={`text-xs shrink-0 tabular-nums ${
                        c.tracked !== undefined &&
                        c.additions >= 200 &&
                        c.additions / (Math.max(c.tracked, 60) / 3600) > 1500
                          ? "font-semibold"
                          : ""
                      }`}
                      title={
                        c.tracked !== undefined &&
                        c.additions >= 200 &&
                        c.additions / (Math.max(c.tracked, 60) / 3600) > 1500
                          ? "Huge amount of code vs almost no tracked coding time , possible paste/AI dump."
                          : "Lines added / removed"
                      }
                    >
                      <span className="text-emerald-600 dark:text-emerald-400">
                        +{c.additions}
                      </span>{" "}
                      <span className="text-rose-600 dark:text-rose-400">
                        −{c.deletions ?? 0}
                      </span>
                    </span>
                  )}
                  {gaps.has(c.sha) && (
                    <span
                      className="text-xs text-muted-foreground shrink-0 tabular-nums"
                      title="Wall-clock time since the previous commit"
                    >
                      +{fmtGap(gaps.get(c.sha)!)}
                    </span>
                  )}
                  {trackedBadge(c.tracked)}
                  <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
                    {c.author}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {c.date ? new Date(c.date).toLocaleDateString() : ""}
                  </span>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {pages > 1 && (
        <div className="flex items-center justify-between gap-3 p-3 border-t border-border text-sm">
          <span className="text-muted-foreground tabular-nums">
            {start + 1}–{Math.min(start + PER_PAGE, total)} of {total}
          </span>
          <Pagination className="mx-0 w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  text="Prev"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  aria-disabled={page === 0}
                  className={page === 0 ? "pointer-events-none opacity-40" : "cursor-pointer"}
                />
              </PaginationItem>
              <PaginationItem>
                <span className="px-2 text-muted-foreground tabular-nums">
                  {page + 1} / {pages}
                </span>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  text="Next"
                  onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                  aria-disabled={page >= pages - 1}
                  className={page >= pages - 1 ? "pointer-events-none opacity-40" : "cursor-pointer"}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}
