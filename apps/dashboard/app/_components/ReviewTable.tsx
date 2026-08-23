"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ShippedProject } from "@/lib/db";
import { LevelBadge, StatusBadge, FundingBadge } from "@/app/_components/ProjectBadges";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function fmtHM(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function waited(iso: string | null): string {
  if (!iso) return ",";
  const d = Math.max(0, Date.now() - new Date(iso).getTime());
  const days = Math.floor(d / 86_400_000);
  if (days >= 1) return `${days}d`;
  const hrs = Math.floor(d / 3_600_000);
  return `${hrs}h`;
}

function initials(name: string): string {
  return (
    name
      .replace(/^@/, "")
      .split(/[\s_]+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

export function ReviewTable({
  rows,
  handles,
  emptyLabel = "Nothing here.",
}: {
  rows: ShippedProject[];
  handles: Map<string, string>;
  emptyLabel?: string;
}) {
  const router = useRouter();
  if (rows.length === 0) {
    return (
      <Card className="p-10 text-center text-muted-foreground">{emptyLabel}</Card>
    );
  }
  return (
    <Card className="overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Project
            </TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Maker
            </TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Status
            </TableHead>
            <TableHead className="px-5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Waiting
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => {
            const maker =
              p.users?.real_name ||
              (p.users?.slack_id && handles.get(p.users.slack_id)) ||
              p.users?.display_name ||
              p.users?.slack_id ||
              p.user_id;
            const href = `/review/${p.id}`;
            return (
              <TableRow
                key={p.id}
                className="cursor-pointer"
                tabIndex={0}
                role="link"
                aria-label={p.name}
                onClick={() => router.push(href)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") router.push(href);
                }}
              >
                {/* The stretched-link overlay needs a `position`d ancestor to
                    size against. That used to be this row (a real <tr>), but
                    position:relative on a table-row box isn't a reliable
                    containing block across browsers — every row's overlay was
                    collapsing onto the table's own relative wrapper div, so
                    only the last row (last in paint order) ever caught hover
                    or clicks. Scoping it to this <td> keeps a real, accessible
                    anchor (new-tab/ctrl-click support) over the Project cell;
                    the row's own onClick above covers the rest of the row so
                    the whole thing is still clickable like before. */}
                <TableCell className="relative px-5 py-3.5">
                  <Link
                    href={`/review/${p.id}`}
                    prefetch={false}
                    aria-label={p.name}
                    className="absolute inset-0 z-10"
                  />
                  <div className="flex items-center gap-3 min-w-0">
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt=""
                        className="w-10 h-10 rounded-lg object-cover border border-border shrink-0"
                      />
                    ) : (
                      <span className="w-10 h-10 rounded-lg bg-muted border border-border shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{p.name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground font-mono">
                          #{p.id}
                        </span>
                        <LevelBadge level={p.level} />
                        <FundingBadge needsFunding={p.needs_funding} fundingUsd={p.funding_usd} />
                      </div>
                    </div>
                  </div>
                </TableCell>

                <TableCell className="py-3.5">
                  <div className="flex items-center gap-2 min-w-0 max-w-[240px]">
                    <span className="grid place-items-center w-6 h-6 rounded-full bg-primary/15 text-primary text-[0.6rem] font-semibold shrink-0">
                      {initials(String(maker))}
                    </span>
                    <span className="text-sm truncate text-foreground/80">
                      {maker}
                    </span>
                  </div>
                </TableCell>

                <TableCell className="py-3.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <StatusBadge status={p.status} />
                    {p.own && (
                      <Badge
                        variant="warning"
                        className="text-[0.65rem] uppercase tracking-wide"
                      >
                        yours
                      </Badge>
                    )}
                  </div>
                </TableCell>

                <TableCell className="px-5 py-3.5 text-right">
                  <div className="text-foreground/70">{waited(p.shipped_at)}</div>
                  <div className="text-xs text-muted-foreground">
                    {fmtHM(p.hours)} logged
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
