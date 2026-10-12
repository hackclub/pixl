import Link from "next/link";
import { cookies } from "next/headers";
import { requirePage, requireGuidelinesAck } from "@/lib/guard";
import { canSeeBuilderPII } from "@/lib/reviewAccess";
import { listShippedProjects, listReviewAudits } from "@/lib/db";
import { slackHandles } from "@/lib/slack";
import { listBlackoutQueueProjectIds } from "@/lib/operations";
import { getHideReviewers } from "@/lib/liveModeServer";
import { reviewerName } from "@/lib/liveMode";
import { ReviewTable } from "@/app/_components/ReviewTable";
import { LiveReview } from "@/app/_components/LiveReview";
import { REVIEW_SORTS, REVIEW_SORT_COOKIE } from "@/lib/reviewSort";
import {
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  Muted,
  Pagination,
  Table,
  TextLink,
  formatDateTime,
} from "@/app/_ui/ui";

export const dynamic = "force-dynamic";

const PER = 15;
const SORTS = REVIEW_SORTS;

export default async function ReviewListPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; sort?: string; kind?: string; blackout?: string }>;
}) {
  const access = await requirePage("reviewer");
  await requireGuidelinesAck(access);
  const viewer = access.session.slackId;
  const { page, sort: sortParam, kind: rawKind, blackout } = await searchParams;
  // No ?sort= in the URL: use the reviewer's last pick (set by proxy.ts).
  const sort = sortParam ?? (await cookies()).get(REVIEW_SORT_COOKIE)?.value;
  const onlyBlackout = blackout === "1";
  // Hardware and software have separate review queues. A reviewer restricted
  // to one queue (access.reviewQueues) can't view or query the other, so clamp
  // to their allowed queue regardless of what the URL asks for.
  const requestedKind: "software" | "hardware" = rawKind === "hardware" ? "hardware" : "software";
  const kind: "software" | "hardware" = access.reviewQueues === "both" ? requestedKind : access.reviewQueues;
  const kindQ = kind === "hardware" ? "&kind=hardware" : "";
  const hideReviewers = await getHideReviewers();

  // First-pass work only. Projects waiting on Robert live on the Fraud
  // reviews tab and spot checks on the Spot check tab.
  const [myRecent, rowsAll, blackoutIds] = await Promise.all([
    listReviewAudits(5, viewer, { realNames: canSeeBuilderPII(access) }),
    listShippedProjects(viewer, kind, { includeClaimed: true }),
    listBlackoutQueueProjectIds(),
  ]);
  const blackoutSet = new Set(blackoutIds);
  const inBlackout = (p: { id: number | string }) => blackoutSet.has(Number(p.id));
  const blackoutCount = rowsAll.filter(inBlackout).length;
  let rows = onlyBlackout ? rowsAll.filter(inBlackout) : rowsAll;
  if (sort === "hours") rows = [...rows].sort((a, b) => b.hours - a.hours);
  else if (sort === "status") rows = [...rows].sort((a, b) => a.status.localeCompare(b.status));

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PER));
  const cur = Math.min(Math.max(parseInt(page ?? "1", 10) || 1, 1), pages);
  const slice = rows.slice((cur - 1) * PER, cur * PER);
  // While live (names not revealed), other reviewers' names never leave the
  // server: their claim isn't resolved to a Slack handle and first_pass_by is
  // masked before the rows reach ReviewTable's client props.
  const claimId = (id: string | null | undefined) => (hideReviewers && id !== viewer ? null : id);
  const masked = <T extends { first_pass_by?: string | null }>(list: T[]): T[] =>
    hideReviewers
      ? list.map((p) =>
          p.first_pass_by && reviewerName(p.first_pass_by, viewer, true) === "Reviewer"
            ? { ...p, first_pass_by: "Reviewer" }
            : p,
        )
      : list;
  // One handle lookup for every visible row: makers plus the reviewers
  // holding a claim, so the "is reviewing" tag can name them.
  const handles = await slackHandles(
    slice.flatMap((p) => [p.users?.slack_id, claimId(p.claimedBy)]),
  );

  const sortKey = SORTS.some((s) => s.key === sort) ? sort : "oldest";
  const blackoutQ = onlyBlackout ? "&blackout=1" : "";
  const qp = (p: number) => `/review?page=${p}${sortKey !== "oldest" ? `&sort=${sortKey}` : ""}${kindQ}${blackoutQ}`;

  return (
    <div className="flex flex-col gap-6">
      {access.reviewQueues === "both" && (
        <div className="hc-segmented self-start" role="tablist">
          {(["software", "hardware"] as const).map((k) => (
            <Link
              key={k}
              href={k === "hardware" ? "/review?kind=hardware" : "/review"}
              role="tab"
              aria-selected={kind === k}
              className="hc-segmented-item inline-flex items-center justify-center px-4"
            >
              {k === "software" ? "Software queue" : "Hardware queue"}
            </Link>
          ))}
        </div>
      )}

      <div>
        <Card padding="flush">
          <CardHeader
            title={kind === "hardware" ? "Hardware queue" : "Needs review"}
            icon="clock"
            count={total}
            action={
              <div className="flex flex-wrap items-center gap-3">
                <LiveReview />
                {(blackoutCount > 0 || onlyBlackout) && (
                  <ButtonLink
                    href={
                      onlyBlackout ? `/review${kindQ ? `?${kindQ.slice(1)}` : ""}` : `/review?blackout=1${kindQ}`
                    }
                    variant={onlyBlackout ? "primary" : "outline"}
                    size="sm"
                  >
                    Blackout queue ({blackoutCount}){onlyBlackout ? ", show all" : ""}
                  </ButtonLink>
                )}
              </div>
            }
          />
          <div className="hc-tabs" role="tablist">
            {SORTS.map((s) => (
              <Link
                key={s.key}
                href={`/review?sort=${s.key}${kindQ}${blackoutQ}`}
                className="hc-tab"
                role="tab"
                aria-selected={sortKey === s.key}
              >
                {s.label}
              </Link>
            ))}
          </div>
          <ReviewTable makerLinks={access.isOwner}
            rows={masked(slice)}
            handles={handles}
            blackoutIds={blackoutIds}
            emptyLabel="Queue's clear. Nothing waiting for review."
          />
        </Card>
        <Pagination page={cur} totalPages={pages} hrefFor={qp} />
      </div>

      {myRecent.length > 0 && (
        <Card padding="flush">
          <CardHeader title="Recently reviewed by you" icon="history" />
          <Table headers={["Project", "Verdict", "Player", "When"]}>
            {myRecent.map((a) => (
              <tr key={a.id}>
                <td>
                  <TextLink href={`/projects/${a.project_id}`} className="font-bold">
                    {a.project_name}
                  </TextLink>
                </td>
                <td>
                  <Badge>{a.verdict.replaceAll("_", " ")}</Badge>
                </td>
                <td>{a.player_name}</td>
                <td className="whitespace-nowrap">
                  <Muted>{formatDateTime(a.created_at)}</Muted>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
