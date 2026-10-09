import Link from "next/link";
import { redirect } from "next/navigation";
import {
  requireAdmin,
  isSecondPassReviewer,
  EDIT_SUBMISSION,
  ownerSlackIds,
  secondPassSlackIds,
  NO_REVIEW,
} from "@/lib/guard";
import {
  listAdmins,
  listSuperAdminIds,
  reviewerStatsBySlackId,
  displayNamesBySlackId,
  type ReviewerStats,
} from "@/lib/db";
import { addReviewer } from "@/app/actions";
import { slackHandles } from "@/lib/slack";
import { TeamLog } from "@/app/_components/TeamLog";
import { PendingButton } from "@/app/_components/PendingButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

const PER = 15;

const EMPTY_STATS: ReviewerStats = {
  reviews: 0,
  approved: 0,
  firstPass: 0,
  needsChanges: 0,
  hoursApproved: 0,
  avgSeconds: 0,
  repoOpenRate: 0,
  flagged: 0,
  lastReview: null,
};

function fmtDate(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-2 text-center">
      <div className="text-lg font-semibold tabular-nums leading-tight">{value}</div>
      <div className="text-[0.7rem] text-muted-foreground mt-0.5 whitespace-nowrap">{label}</div>
    </div>
  );
}

export default async function ReviewersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const access = await requireAdmin();
  if (!access.isSuper) redirect("/");
  const { q, page } = await searchParams;

  const [admins, stats, superIds] = await Promise.all([
    listAdmins(),
    reviewerStatsBySlackId(),
    listSuperAdminIds(),
  ]);
  const tableReviewers = admins.filter((a) => a.permissions.includes("review"));
  const inTable = new Set(tableReviewers.map((r) => r.slack_id));
  const blocked = new Set(
    admins.filter((a) => a.permissions.includes(NO_REVIEW)).map((a) => a.slack_id),
  );
  // Super admins hold every permission, so they review whether or not they
  // have an admins row , same as the env owners they sit alongside.
  const owners = new Set([...ownerSlackIds(), ...superIds]);
  const implicit = [...new Set([...owners, ...secondPassSlackIds()])].filter(
    (id) => !inTable.has(id) && !blocked.has(id),
  );
  const allReviewers = [
    ...implicit.map((id) => ({ slack_id: id, name: "", permissions: [] as string[] })),
    ...tableReviewers.map((r) => ({
      slack_id: r.slack_id,
      name: r.name,
      permissions: r.permissions,
    })),
  ];
  const ids = allReviewers.map((r) => r.slack_id);
  const [handles, playerNames] = await Promise.all([
    slackHandles(ids),
    displayNamesBySlackId(ids),
  ]);
  const displayFor = (r: { slack_id: string; name: string }) =>
    r.name || handles.get(r.slack_id) || playerNames.get(r.slack_id) || r.slack_id;

  const needle = (q ?? "").trim().toLowerCase();
  const filtered = needle
    ? allReviewers.filter((r) => {
        const handle = handles.get(r.slack_id) ?? "";
        return (
          displayFor(r).toLowerCase().includes(needle) ||
          r.slack_id.toLowerCase().includes(needle) ||
          handle.toLowerCase().includes(needle)
        );
      })
    : allReviewers;

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / PER));
  const cur = Math.min(Math.max(parseInt(page ?? "1", 10) || 1, 1), pages);
  const start = (cur - 1) * PER;
  const reviewers = filtered.slice(start, start + PER);
  const qp = (n: number) =>
    `/reviewers?page=${n}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  const totals = [...stats.values()].reduce(
    (acc, s) => {
      acc.reviews += s.reviews;
      acc.approved += s.approved;
      acc.hours += s.hoursApproved;
      return acc;
    },
    { reviews: 0, approved: 0, hours: 0 },
  );

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Reviewers</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Everyone who can work the ship queue. Click a reviewer for their full stats and
            review history.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Card className="flex-row divide-x divide-border py-0">
            <StatCell label="reviews all-time" value={String(totals.reviews)} />
            <StatCell label="final approvals" value={String(totals.approved)} />
            <StatCell
              label="hours credited"
              value={String(Math.round(totals.hours * 10) / 10)}
            />
          </Card>
        </div>
      </div>

      <Card className="p-5 md:p-6 gap-0">
        <div className="text-base font-semibold mb-4">Add a reviewer</div>
        <form action={addReviewer} className="grid sm:grid-cols-[1fr_1fr_auto] gap-4 items-end">
          <Label className="block font-normal">
            <span className="block text-sm font-medium mb-1.5">Name</span>
            <Input name="name" placeholder="e.g. Alex Rivera" className="w-full text-sm" />
          </Label>
          <Label className="block font-normal">
            <span className="block text-sm font-medium mb-1.5">Slack member ID</span>
            <Input
              name="slackId"
              required
              placeholder="U0XXXXXXX"
              className="w-full text-sm font-mono"
            />
          </Label>
          <PendingButton className="bg-brand text-white border-transparent" pendingText="Adding…">
            Add reviewer
          </PendingButton>
        </form>
        <p className="text-xs text-muted-foreground mt-2">
          Slack → profile → ⋯ → Copy member ID. If they&apos;re already an admin, this just
          grants them review access on top.
        </p>
      </Card>

      <div>
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="text-sm font-medium text-muted-foreground">
            {total} reviewer{total === 1 ? "" : "s"}
            {needle ? ` matching “${q}”` : ""}
          </div>
          <form className="flex gap-2">
            <Input
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search reviewers…"
              className="text-sm w-56"
            />
            <Button type="submit">Search</Button>
          </form>
        </div>

        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="p-3">Reviewer</TableHead>
                <TableHead className="p-3">Reviews</TableHead>
                <TableHead className="p-3">Approved</TableHead>
                <TableHead className="p-3">Hours credited</TableHead>
                <TableHead className="p-3">Flags</TableHead>
                <TableHead className="p-3">Last review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviewers.map((r) => {
                const handle = (r.slack_id && handles.get(r.slack_id)) ?? r.slack_id;
                const s = stats.get(r.slack_id) ?? EMPTY_STATS;
                return (
                  <TableRow key={r.slack_id}>
                    <TableCell className="p-3">
                      <Link
                        href={`/reviewers/${r.slack_id}`}
                        className="font-bold hover:text-brand"
                      >
                        {displayFor(r)}
                      </Link>
                      <span className="inline-flex gap-1 ml-2 align-middle">
                        {owners.has(r.slack_id) && (
                          <Badge variant="destructive" className="text-[0.65rem] uppercase tracking-wide">
                            admin
                          </Badge>
                        )}
                        {isSecondPassReviewer(r.slack_id, r.permissions, owners.has(r.slack_id)) && (
                          <Badge variant="success" className="text-[0.65rem] uppercase tracking-wide">
                            second pass
                          </Badge>
                        )}
                        {r.permissions.includes(EDIT_SUBMISSION) && (
                          <Badge variant="info" className="text-[0.65rem] uppercase tracking-wide">
                            edits submissions
                          </Badge>
                        )}
                      </span>
                      <div className="text-xs text-muted-foreground font-mono">{handle}</div>
                    </TableCell>
                    <TableCell className="p-3 tabular-nums">{s.reviews}</TableCell>
                    <TableCell className="p-3 tabular-nums">{s.approved}</TableCell>
                    <TableCell className="p-3 tabular-nums">
                      {Math.round(s.hoursApproved * 10) / 10}
                    </TableCell>
                    <TableCell
                      className={`p-3 tabular-nums ${
                        s.flagged > 0 ? "text-rose-600 dark:text-rose-400 font-bold" : ""
                      }`}
                    >
                      {s.flagged}
                    </TableCell>
                    <TableCell className="p-3 text-muted-foreground">{fmtDate(s.lastReview)}</TableCell>
                  </TableRow>
                );
              })}
              {reviewers.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell className="p-5 text-muted-foreground" colSpan={6}>
                    {needle
                      ? "No reviewers match that search."
                      : "No reviewers yet. Add someone above to start clearing the queue."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>

        {total > 0 && (
          <div className="flex items-center justify-between gap-3 mt-4 text-sm">
            <span className="text-muted-foreground">
              Showing {start + 1}–{Math.min(start + PER, total)} of {total}
            </span>
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationLink
                    href={qp(cur - 1)}
                    aria-label="Previous page"
                    className={cur <= 1 ? "pointer-events-none opacity-40" : ""}
                  >
                    ←
                  </PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <span className="px-2 text-muted-foreground tabular-nums">
                    {cur} / {pages}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink
                    href={qp(cur + 1)}
                    aria-label="Next page"
                    className={cur >= pages ? "pointer-events-none opacity-40" : ""}
                  >
                    →
                  </PaginationLink>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </div>

      <TeamLog />
    </div>
  );
}
