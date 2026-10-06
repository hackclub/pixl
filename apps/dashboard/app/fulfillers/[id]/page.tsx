import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/guard";
import { getLiveMode } from "@/lib/liveModeServer";
import { LiveBlocked } from "@/app/_components/LiveBlocked";
import {
  listFulfillerIds,
  fulfillerStatsBySlackId,
  listOrdersForFulfiller,
  displayNamesBySlackId,
  type FulfillerStats,
  type OrderStatus,
} from "@/lib/db";
import { removeFulfillerAction } from "@/app/actions";
import { PendingButton } from "@/app/_components/PendingButton";
import { slackHandle } from "@/lib/slack";
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

export const dynamic = "force-dynamic";

const EMPTY_STATS: FulfillerStats = {
  claimed: 0,
  shipped: 0,
  done: 0,
  inQueue: 0,
  avgShipSeconds: 0,
  lastActivity: null,
  pixelsEarned: 0,
};

const STATUS_BADGE: Record<OrderStatus, "secondary" | "success" | "destructive" | "warning"> = {
  pending: "secondary",
  ordered: "warning",
  credited: "warning",
  shipped: "success",
  done: "success",
  cancelled: "destructive",
};

const STAGE_LABEL: Record<OrderStatus, string> = {
  pending: "New",
  ordered: "Ordered",
  credited: "Credited",
  shipped: "Shipped",
  done: "Done",
  cancelled: "Cancelled",
};

function fmtDuration(seconds: number): string {
  if (seconds <= 0) return ",";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4 gap-0">
      <div className="text-xl font-semibold tabular-nums leading-tight">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </Card>
  );
}

export default async function FulfillerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const access = await requireAdmin();
  if (!access.isSuper) redirect("/");
  if (await getLiveMode()) return <LiveBlocked what="Fulfillers" />;
  const { id } = await params;
  const slackId = decodeURIComponent(id);

  const fulfillerIds = await listFulfillerIds();
  const listed = fulfillerIds.includes(slackId);
  if (!listed) notFound();

  const [stats, orders, handle, playerNames] = await Promise.all([
    fulfillerStatsBySlackId(),
    listOrdersForFulfiller(slackId, 100),
    slackHandle(slackId),
    displayNamesBySlackId([slackId]),
  ]);
  const s = stats.get(slackId) ?? EMPTY_STATS;
  const display = handle || playerNames.get(slackId) || slackId;
  const initials =
    display
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <div className="space-y-8">
      <div>
        <Link href="/fulfillment?status=fulfillers" className="text-sm text-muted-foreground hover:text-brand">
          ← Fulfillers
        </Link>
      </div>

      <Card className="p-5 md:p-6 gap-0 flex-row items-start justify-between flex-wrap">
        <div className="flex items-center gap-4 min-w-0">
          <span className="grid place-items-center w-14 h-14 rounded-full bg-brand/10 text-brand text-lg font-semibold shrink-0">
            {initials}
          </span>
          <div className="min-w-0">
            <div className="text-xl font-semibold flex items-center gap-2 flex-wrap">{display}</div>
            <div className="text-sm text-muted-foreground font-mono truncate">
              {handle ?? slackId} · {slackId}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              last activity {fmtDate(s.lastActivity)}
            </div>
          </div>
        </div>
        <form action={removeFulfillerAction}>
          <input type="hidden" name="slackId" value={slackId} />
          <PendingButton
            variant="outline"
            pendingText="Removing…"
            confirm={`Remove ${display} as a fulfiller?`}
            className="text-rose-600 border-rose-200 dark:border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-600"
          >
            Remove fulfiller
          </PendingButton>
        </form>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="orders claimed" value={String(s.claimed)} />
        <Stat label="shipped" value={String(s.shipped)} />
        <Stat label="closed (done)" value={String(s.done)} />
        <Stat label="currently in queue" value={String(s.inQueue)} />
        <Stat label="avg claim → ship" value={fmtDuration(s.avgShipSeconds)} />
      </div>

      <div>
        <div className="text-sm font-medium text-muted-foreground mb-3">
          Order history{orders.length === 100 ? " (last 100)" : ""}
        </div>
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="p-3">Item</TableHead>
                <TableHead className="p-3">Player</TableHead>
                <TableHead className="p-3">Status</TableHead>
                <TableHead className="p-3">Tracking</TableHead>
                <TableHead className="p-3">Claimed</TableHead>
                <TableHead className="p-3">Shipped</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id} className="align-top">
                  <TableCell className="p-3 font-medium">
                    {o.quantity > 1 ? `${o.quantity}× ` : ""}
                    {o.item_name || "(item removed)"}
                  </TableCell>
                  <TableCell className="p-3">
                    <Link href={`/players/${o.user_id}`} className="hover:text-brand">
                      {o.player_name}
                    </Link>
                  </TableCell>
                  <TableCell className="p-3">
                    <Badge variant={STATUS_BADGE[o.status] ?? "secondary"} className="capitalize">
                      {STAGE_LABEL[o.status] ?? o.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="p-3 font-mono text-xs">{o.tracking || ","}</TableCell>
                  <TableCell className="p-3 text-muted-foreground whitespace-nowrap">
                    {o.claimed_at ? fmtDateTime(o.claimed_at) : ","}
                  </TableCell>
                  <TableCell className="p-3 text-muted-foreground whitespace-nowrap">
                    {o.shipped_at ? fmtDateTime(o.shipped_at) : ","}
                  </TableCell>
                </TableRow>
              ))}
              {orders.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell className="p-5 text-muted-foreground" colSpan={6}>
                    No orders claimed yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
