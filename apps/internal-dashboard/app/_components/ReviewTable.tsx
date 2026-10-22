"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { queueWaitSince } from "@/lib/queueWait";
import type { ShippedProject } from "@/lib/db";
import type { QueueLock } from "@/lib/reviewAssignment";
import { LevelBadge, StatusBadge, FundingBadge, TypeBadge, BeaconBadge } from "@/app/_components/ProjectBadges";
import { BlackoutBadge } from "@/app/_components/BlackoutBadge";
import { useLiveMode, useReviewerName } from "@/app/_components/LiveMode";
import { RowSelect, SelectAllBox } from "@/app/_components/MassSelect";
import { Badge, ButtonLink, EmptyRow, EmptyState, Mono, Muted, Table, buttonClass } from "@/app/_ui/ui";

function fmtHM(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function waited(iso: string | null): string {
  if (!iso) return "-";
  const d = Math.max(0, Date.now() - new Date(iso).getTime());
  const days = Math.floor(d / 86_400_000);
  if (days >= 1) return `${days}d`;
  return `${Math.floor(d / 3_600_000)}h`;
}

function QueueMeta({
  p,
  blackout,
  lockLabel,
}: {
  p: ShippedProject;
  blackout: boolean;
  lockLabel: string | null;
}) {
  // The card's maker line already shows #id above this, so it's badges only
  // here (the desktop table keeps its own inline meta with the id).
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      {lockLabel && <Badge icon="private">{lockLabel}</Badge>}
      <LevelBadge level={p.level} />
      <TypeBadge type={p.project_type} />
      <FundingBadge needsFunding={p.needs_funding} fundingUsd={p.funding_usd} />
      {p.is_peak && <BeaconBadge />}
      {blackout && <BlackoutBadge />}
    </div>
  );
}

function QueueStatus({ p, claimer }: { p: ShippedProject; claimer: (id: string) => string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusBadge status={p.status} />
      {p.own && <Badge tone="warning">Yours</Badge>}
      {p.hold_at && (
        <span title={p.hold_reason || "On hold"}>
          <Badge icon="private">On hold</Badge>
        </span>
      )}
      {p.claimedBy && (
        <span
          title={`${claimer(p.claimedBy)} opened this for review in the last 30 minutes. You can still open it, but you can't grade it while their claim is live.`}
        >
          <Badge tone="info" icon="view">
            {claimer(p.claimedBy)} is reviewing
          </Badge>
        </span>
      )}
    </div>
  );
}

// The queue's project list. Renders a bare table: callers put it inside a
// <Card padding="flush"> (or a Details) with their own header.
export function ReviewTable({
  rows,
  handles,
  hackatimeUserIds,
  emptyLabel = "Nothing here.",
  blackoutIds = [],
  makerLinks = false,
  selectName,
  locks,
}: {
  rows: ShippedProject[];
  handles: Map<string, string>;
  /** project id -> Hackatime user id (see hackatimeUserIdsFor in
   * lib/hackatime.ts). Only passed by second-pass queue views: the presence
   * of this prop (not its contents) decides whether the Telescreen column
   * renders at all, so a plain first-pass queue never shows it. */
  hackatimeUserIds?: Map<number, string>;
  emptyLabel?: string;
  /** Project ids that are Operation Blackout entries, shown with a badge. */
  blackoutIds?: number[];
  /** Link each maker to their player page. Owners only: /players is theirs. */
  makerLinks?: boolean;
  /** Adds a checkbox column whose ticked rows submit under this field name
   * (the table must sit inside a <form>). */
  selectName?: string;
  /** project id -> why the row can't be opened. Locked rows stay visible but
   * aren't clickable (first-pass queue only, see openableQueueIds). */
  locks?: Record<number, QueueLock>;
}) {
  const blackoutSet = new Set(blackoutIds);
  const router = useRouter();
  const live = useLiveMode();
  const reviewerName = useReviewerName();
  // claimedBy is a bare Slack id: while live (names not revealed) anyone but
  // the viewer is just "A reviewer"; otherwise their Slack handle.
  const claimer = (id: string) =>
    reviewerName(id) === "Reviewer" ? "A reviewer" : (handles.get(id) ?? "someone");
  // Only lists mixing in second_review rows have a first-pass reviewer to
  // show, so skip the column instead of rendering it always empty.
  const showFirstPass = rows.some((p) => p.first_pass_by);
  const headers = [
    ...(selectName ? [<SelectAllBox key="select" />] : []),
    "Project",
    "Maker",
    "Status",
    ...(showFirstPass ? ["First pass"] : []),
    ...(hackatimeUserIds ? ["Telescreen"] : []),
    "Waiting",
  ];

  return (
    <>
      <Table headers={headers} className="hc-queue-table">
        {rows.map((p) => {
          // Never the legal name: these rows are client props, and the queue
          // queries don't select real_name (see QUEUE_SELECT, lib/db.ts).
          const maker = live
            ? "Builder"
            : (p.users?.slack_id && handles.get(p.users.slack_id)) ||
              p.users?.display_name ||
              p.users?.slack_id ||
              p.user_id;
          const href = `/review/${p.id}`;
          const telescreenId = !live ? hackatimeUserIds?.get(p.id) : undefined;
          const lock = locks?.[Number(p.id)];
          const lockLabel = !lock
            ? null
            : lock.reason === "page"
              ? "Locked: only the first page can be opened"
              : `Reserved for ${lock.assignee ?? "the reviewer who asked for changes"}${
                  lock.until
                    ? ` until ${new Date(lock.until).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`
                    : ""
                }`;
          return (
            <tr
              key={p.id}
              className={lock ? "cursor-not-allowed opacity-60" : "cursor-pointer"}
              onClick={lock ? undefined : () => router.push(href)}
              title={lockLabel ?? undefined}
            >
              {selectName && (
                <td onClick={(e) => e.stopPropagation()}>
                  <RowSelect id={String(p.id)} name={selectName} label={`Select ${p.name}`} />
                </td>
              )}
              {/* A real anchor over the Project cell keeps ctrl/middle-click and
                  keyboard navigation working; the row's onClick covers the rest.
                  The overlay is scoped to this <td> because position:relative on
                  a <tr> isn't a reliable containing block across browsers. */}
              <td className="relative">
                {!lock && <Link href={href} prefetch={false} aria-label={p.name} className="absolute inset-0 z-10" />}
                <div className="flex min-w-0 items-center gap-3">
                  {p.image_url ? (
                    <img
                      src={p.image_url}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-md border border-[var(--border)] object-cover"
                    />
                  ) : (
                    <span className="h-10 w-10 shrink-0 rounded-md border border-[var(--border)] bg-[var(--sunken)]" />
                  )}
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-bold">{p.name}</span>
                      {blackoutSet.has(Number(p.id)) && <BlackoutBadge className="shrink-0" />}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Muted className="text-xs">
                        <Mono>#{p.id}</Mono>
                      </Muted>
                      {lockLabel && <Badge icon="private">{lockLabel}</Badge>}
                      <LevelBadge level={p.level} />
                      <TypeBadge type={p.project_type} />
                      <FundingBadge needsFunding={p.needs_funding} fundingUsd={p.funding_usd} />
                      {p.is_peak && <BeaconBadge />}
                    </div>
                  </div>
                </div>
              </td>
              <td>
                {makerLinks && !live ? (
                  <Link
                    href={`/players/${p.user_id}`}
                    prefetch={false}
                    className="hc-link block max-w-[220px] truncate"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {maker}
                  </Link>
                ) : (
                  <span className="block max-w-[220px] truncate">{maker}</span>
                )}
              </td>
              <td>
                <QueueStatus p={p} claimer={claimer} />
              </td>
              {showFirstPass && (
                <td>
                  <span className="block max-w-[180px] truncate">{reviewerName(p.first_pass_by, "-")}</span>
                </td>
              )}
              {hackatimeUserIds && (
                <td onClick={(e) => e.stopPropagation()}>
                  {telescreenId ? (
                    <ButtonLink
                      href={`https://telescreen.hackclub.com/workbench/hackatime/overview?u=${encodeURIComponent(telescreenId)}`}
                      variant="outline"
                      size="sm"
                      external
                    >
                      Telescreen
                    </ButtonLink>
                  ) : (
                    <Muted>-</Muted>
                  )}
                </td>
              )}
              <td className="whitespace-nowrap">
                <div className="font-bold">{waited(queueWaitSince(p))}</div>
                <Muted className="text-xs">{fmtHM(p.hours)} logged</Muted>
              </td>
            </tr>
          );
        })}
        {rows.length === 0 && <EmptyRow colSpan={headers.length} title={emptyLabel} icon="checkmark" />}
      </Table>

      <ul className="hc-queue-cards">
        {/* The table's select-all is hidden with the table on phones, so give
            the card list its own header row for mass-action queues. */}
        {selectName && (
          <li className="hc-queue-card-select-all">
            <SelectAllBox>
              <span className="text-xs font-medium">Select all</span>
            </SelectAllBox>
          </li>
        )}
        {rows.map((p) => {
          const maker = live
            ? "Builder"
            : (p.users?.slack_id && handles.get(p.users.slack_id)) ||
              p.users?.display_name ||
              p.users?.slack_id ||
              p.user_id;
          const href = `/review/${p.id}`;
          const telescreenId = !live ? hackatimeUserIds?.get(p.id) : undefined;
          const lock = locks?.[Number(p.id)];
          const lockLabel = !lock
            ? null
            : lock.reason === "page"
              ? "Locked: only the first page can be opened"
              : `Reserved for ${lock.assignee ?? "the reviewer who asked for changes"}${
                  lock.until
                    ? ` until ${new Date(lock.until).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`
                    : ""
                }`;
          return (
            <li key={`card-${p.id}`} className={`hc-queue-card${lock ? " is-locked" : ""}`} title={lockLabel ?? undefined}>
              {!lock && <Link href={href} prefetch={false} aria-label={p.name} className="hc-queue-card-hit" />}
              <div className="hc-queue-card-body">
                <div className="hc-queue-card-top">
                  {selectName && (
                    <div className="hc-queue-card-check">
                      <RowSelect id={String(p.id)} name={selectName} label={`Select ${p.name}`} />
                    </div>
                  )}
                  {p.image_url ? (
                    <img
                      src={p.image_url}
                      alt=""
                      className="h-11 w-11 shrink-0 rounded-md border border-[var(--border)] object-cover"
                    />
                  ) : (
                    <span className="h-11 w-11 shrink-0 rounded-md border border-[var(--border)] bg-[var(--sunken)]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{p.name}</span>
                    <div className="hc-queue-card-maker">
                      <Muted className="text-xs">
                        <Mono>#{p.id}</Mono>
                      </Muted>
                      <span aria-hidden>·</span>
                      {makerLinks && !live ? (
                        <Link
                          href={`/players/${p.user_id}`}
                          prefetch={false}
                          className="hc-link truncate"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {maker}
                        </Link>
                      ) : (
                        <span className="truncate">{maker}</span>
                      )}
                    </div>
                    <QueueMeta p={p} blackout={blackoutSet.has(Number(p.id))} lockLabel={lockLabel} />
                  </div>
                  <div className="hc-queue-card-side">
                    <span className="hc-queue-card-wait">{waited(queueWaitSince(p))}</span>
                    <Muted className="text-xs">{fmtHM(p.hours)} logged</Muted>
                  </div>
                </div>
                <div className="hc-queue-card-bottom">
                  <QueueStatus p={p} claimer={claimer} />
                  {telescreenId && (
                    <a
                      href={`https://telescreen.hackclub.com/workbench/hackatime/overview?u=${encodeURIComponent(telescreenId)}`}
                      target="_blank"
                      rel="noreferrer"
                      className={`${buttonClass("outline", "sm")} hc-queue-card-telescreen`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Telescreen
                    </a>
                  )}
                </div>
              </div>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="hc-queue-card hc-queue-card-empty">
            <EmptyState title={emptyLabel} icon="checkmark" />
          </li>
        )}
      </ul>
    </>
  );
}
