"use client";

import Link from "next/link";
import type { ShippedProject } from "@/lib/db";
import { markSpotChecked } from "@/app/actions";
import { LevelBadge, FundingBadge } from "@/app/_components/ProjectBadges";
import { PendingButton } from "@/app/_components/PendingButton";
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

// Same row shape as ReviewTable, minus the whole-row-navigates behavior -
// this is a read-only audit list, not an action queue, so only the project
// name links out. The "Checked" button is its own small server-action form.
export function SpotCheckTable({
  rows,
  handles,
}: {
  rows: ShippedProject[];
  handles: Map<string, string>;
}) {
  if (rows.length === 0) {
    return (
      <Card className="p-10 text-center text-muted-foreground">
        Nothing waiting on a spot check right now.
      </Card>
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
              First-pass reviewer
            </TableHead>
            <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Waiting
            </TableHead>
            <TableHead className="px-5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {""}
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
            return (
              <TableRow key={p.id}>
                <TableCell className="px-5 py-3.5">
                  <Link href={`/review/${p.id}`} className="flex items-center gap-3 min-w-0">
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
                      <div className="font-semibold truncate hover:text-brand">{p.name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground font-mono">#{p.id}</span>
                        <LevelBadge level={p.level} />
                        <FundingBadge needsFunding={p.needs_funding} fundingUsd={p.funding_usd} />
                      </div>
                    </div>
                  </Link>
                </TableCell>

                <TableCell className="py-3.5">
                  <div className="flex items-center gap-2 min-w-0 max-w-[200px]">
                    <span className="grid place-items-center w-6 h-6 rounded-full bg-primary/15 text-primary text-[0.6rem] font-semibold shrink-0">
                      {initials(String(maker))}
                    </span>
                    <span className="text-sm truncate text-foreground/80">{maker}</span>
                  </div>
                </TableCell>

                <TableCell className="py-3.5 text-sm text-foreground/80 truncate max-w-[180px]">
                  {p.first_pass_by ? p.first_pass_by.replace(/\s*\([^)]*\)\s*$/, "") : ","}
                </TableCell>

                <TableCell className="py-3.5 text-right">
                  <div className="text-foreground/70">{waited(p.first_pass_at)}</div>
                  <div className="text-xs text-muted-foreground">{fmtHM(p.hours)} logged</div>
                </TableCell>

                <TableCell className="px-5 py-3.5 text-right">
                  <form action={markSpotChecked}>
                    <input type="hidden" name="projectId" value={p.id} />
                    <PendingButton variant="outline" size="sm" pendingText="Marking…">
                      Checked
                    </PendingButton>
                  </form>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
