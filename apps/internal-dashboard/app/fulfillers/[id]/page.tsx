import { notFound } from "next/navigation";
import { requirePage } from "@/lib/guard";
import {
  listFulfillerIds,
  fulfillerStatsBySlackId,
  listOrdersForFulfiller,
  displayNamesBySlackId,
  type FulfillerStats,
  type OrderStatus,
} from "@/lib/db";
import { removeFulfillerAction } from "@/app/actions";
import { SlackHandle } from "@/app/fulfillment/SlackHandle";
import {
  ActionButton,
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  EmptyRow,
  Mono,
  PageHeader,
  Stat,
  StatGrid,
  Table,
  TextLink,
  formatDate,
  formatDateTime,
  type Tone,
} from "@/app/_ui/ui";

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

const STAGE_LABEL: Record<OrderStatus, string> = {
  pending: "New",
  claimed: "Claimed",
  ordered: "Ordered",
  credited: "Credited",
  shipped: "Shipped",
  done: "Done",
  cancelled: "Cancelled",
};

const STAGE_TONE: Record<OrderStatus, Tone> = {
  pending: "warning",
  claimed: "info",
  ordered: "info",
  credited: "purple",
  shipped: "cyan",
  done: "success",
  cancelled: "neutral",
};

const HISTORY_LIMIT = 100;

function fmtDuration(seconds: number): string {
  if (seconds <= 0) return "-";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export default async function FulfillerPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("owner");
  const { id } = await params;
  const slackId = decodeURIComponent(id);

  const fulfillerIds = await listFulfillerIds();
  if (!fulfillerIds.includes(slackId)) notFound();

  const [stats, orders, playerNames] = await Promise.all([
    fulfillerStatsBySlackId(),
    listOrdersForFulfiller(slackId, HISTORY_LIMIT),
    displayNamesBySlackId([slackId]),
  ]);
  const s = stats.get(slackId) ?? EMPTY_STATS;
  const name = playerNames.get(slackId) || slackId;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <ButtonLink href="/fulfillment?status=fulfillers" variant="ghost" size="sm" icon="view-back">
          Fulfillers
        </ButtonLink>
      </div>

      <PageHeader
        title={<SlackHandle id={slackId} fallback={name} />}
        description={
          <>
            <Mono>{slackId}</Mono> · last activity {s.lastActivity ? formatDate(s.lastActivity) : "never"}
          </>
        }
        actions={
          <form action={removeFulfillerAction}>
            <input type="hidden" name="slackId" value={slackId} />
            <ActionButton
              variant="danger"
              pendingLabel="Removing..."
              confirm={`Remove ${name} as a fulfiller?`}
              icon="member-remove"
            >
              Remove fulfiller
            </ActionButton>
          </form>
        }
      />

      <StatGrid>
        <Stat label="Orders claimed" value={s.claimed} />
        <Stat label="Shipped" value={s.shipped} />
        <Stat label="Closed (done)" value={s.done} />
        <Stat label="In queue now" value={s.inQueue} tone={s.inQueue > 0 ? "warning" : undefined} />
        <Stat label="Avg claim to ship" value={fmtDuration(s.avgShipSeconds)} />
        <Stat label="Pixels earned" value={s.pixelsEarned.toLocaleString()} tone="success" />
      </StatGrid>

      <Card padding="flush">
        <CardHeader
          title={orders.length === HISTORY_LIMIT ? `Order history (last ${HISTORY_LIMIT})` : "Order history"}
          icon="history"
          count={orders.length}
        />
        <Table headers={["Item", "Player", "Status", "Tracking", "Claimed", "Shipped"]}>
          {orders.length === 0 && <EmptyRow colSpan={6} title="No orders claimed yet" icon="package" />}
          {orders.map((o) => (
            <tr key={o.id}>
              <td className="font-bold">
                {o.quantity > 1 ? `${o.quantity}x ` : ""}
                {o.item_name || "(item removed)"}
              </td>
              <td>
                <TextLink href={`/players/${o.user_id}`}>{o.player_name}</TextLink>
              </td>
              <td>
                <Badge tone={STAGE_TONE[o.status] ?? "neutral"}>{STAGE_LABEL[o.status] ?? o.status}</Badge>
              </td>
              <td>{o.tracking ? <Mono>{o.tracking}</Mono> : <span className="hc-muted">-</span>}</td>
              <td className="hc-muted whitespace-nowrap">{formatDateTime(o.claimed_at)}</td>
              <td className="hc-muted whitespace-nowrap">{formatDateTime(o.shipped_at)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
