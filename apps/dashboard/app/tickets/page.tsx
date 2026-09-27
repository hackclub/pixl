import { requireHelper } from "@/lib/guard";
import { ticketStats, ticketActivity, resolverLeaderboard } from "@/lib/tickets";
import { listHelpers } from "@/lib/db";
import { slackHandles } from "@/lib/slack";
import { addHelperAction, removeHelperAction } from "@/app/actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PendingButton } from "@/app/_components/PendingButton";
import { TicketsClient } from "./TicketsClient";
import { TicketsActivityChart } from "./TicketsActivityChart";

export const dynamic = "force-dynamic";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4 gap-1">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </Card>
  );
}

async function HelperManager() {
  const helpers = await listHelpers();
  const handles = await slackHandles(helpers.map((h) => h.slack_user_id));
  return (
    <Card className="p-5 mb-6">
      <div className="text-sm font-semibold mb-1">Helpers</div>
      <p className="text-xs text-muted-foreground mb-3">
        Only helpers (and owners) can see and work tickets. This is the same list the
        Pixorpheus bot manages with <code>/pixl-addhelper</code>.
      </p>
      <form action={addHelperAction} className="flex flex-wrap gap-2 mb-3">
        <Input
          name="slackId"
          placeholder="Slack user ID (U0…)"
          className="max-w-56 text-sm font-mono"
          required
        />
        <PendingButton pendingText="Adding…">Add helper</PendingButton>
      </form>
      {helpers.length === 0 ? (
        <div className="text-xs text-muted-foreground">No helpers yet.</div>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {helpers.map((h) => (
            <li
              key={h.slack_user_id}
              className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1 text-sm"
            >
              <span className="font-medium">
                {handles.get(h.slack_user_id) ?? `@${h.slack_user_id}`}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{h.slack_user_id}</span>
              <form action={removeHelperAction}>
                <input type="hidden" name="slackId" value={h.slack_user_id} />
                <button
                  type="submit"
                  className="text-xs text-destructive hover:underline"
                  title="Remove helper"
                >
                  remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function ResolverLeaderboard() {
  const rows = (await resolverLeaderboard()).slice(0, 15);
  const handles = await slackHandles(rows.map((r) => r.slackId));
  return (
    <Card className="p-5 mb-6 gap-3">
      <div className="text-sm font-semibold">Top resolvers</div>
      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">No resolved tickets yet.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Helper</TableHead>
              <TableHead className="text-right">Last 7 days</TableHead>
              <TableHead className="text-right">Last 30 days</TableHead>
              <TableHead className="text-right">All time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r.slackId}>
                <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="font-medium">
                  {handles.get(r.slackId) ?? `@${r.slackId}`}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.last7d}</TableCell>
                <TableCell className="text-right tabular-nums">{r.last30d}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{r.total}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export default async function TicketsPage() {
  const access = await requireHelper();
  const [stats, activity] = await Promise.all([ticketStats(), ticketActivity()]);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-1">Tickets</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Support requests from the Slack help channel. Reply in-thread or resolve from here.
      </p>

      <div className="grid grid-cols-3 gap-3 mb-6 max-w-lg">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Open" value={stats.open} />
        <StatCard label="Resolved" value={stats.resolved} />
      </div>

      {access.isSuper && <HelperManager />}

      <Card className="p-5 mb-6">
        <TicketsActivityChart points={activity} />
      </Card>

      <ResolverLeaderboard />

      <TicketsClient />
    </div>
  );
}
