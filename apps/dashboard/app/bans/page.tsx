import Link from "next/link";
import { requirePagePerm, canView } from "@/lib/guard";
import { getLiveMode } from "@/lib/liveModeServer";
import { LiveBlocked } from "@/app/_components/LiveBlocked";
import { liveName } from "@/lib/liveMode";
import { listBans, listBanLog, listBanProposals, banIsActive } from "@/lib/db";
import { LiftBanForm } from "@/app/_components/Moderate";
import { confirmBanProposal, rejectBanProposal } from "@/app/actions";
import { PendingButton } from "@/app/_components/PendingButton";
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

export default async function BansPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const access = await requirePagePerm(["warn", "ban"]);
  const live = await getLiveMode();
  if (live) return <LiveBlocked what="Bans" reason="This page is internal moderation data" />;
  const canConfirm = canView(access, ["ban"]);
  const { tab } = await searchParams;
  const active = tab === "logs" ? "logs" : tab === "proposed" ? "proposed" : "bans";
  const [bans, log, proposals] = await Promise.all([
    active === "bans" ? listBans() : Promise.resolve([]),
    active === "logs" ? listBanLog() : Promise.resolve([]),
    listBanProposals("pending"),
  ]);
  const pendingCount = proposals.length;

  const tabs = [
    { key: "bans", label: "Bans", href: "/bans" },
    { key: "proposed", label: `Proposed${pendingCount ? ` (${pendingCount})` : ""}`, href: "/bans?tab=proposed" },
    { key: "logs", label: "Ban log", href: "/bans?tab=logs" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-1">Bans</h1>
      <p className="text-sm text-muted-foreground mb-5">
        {active === "bans"
          ? "Every ban ever issued, newest first. Lifting removes all active bans for that player."
          : active === "proposed"
            ? "Bans proposed by moderators, waiting on an admin to confirm or reject."
            : "Every ban and lift action with who did it, newest first."}
      </p>

      <div className="flex gap-1 rounded-md border border-border p-1 w-fit mb-6">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`px-3.5 py-1.5 text-sm rounded transition-colors ${
              active === t.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {active === "bans" ? (
        <Card className="overflow-hidden py-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="p-3">Player</TableHead>
                  <TableHead className="p-3">Reason</TableHead>
                  <TableHead className="p-3">Banned by</TableHead>
                  <TableHead className="p-3">Expires</TableHead>
                  <TableHead className="p-3">Status</TableHead>
                  <TableHead className="p-3">Issued</TableHead>
                  <TableHead className="p-3"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bans.map((b) => {
                  const isActive = banIsActive(b);
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="p-3">
                        <Link href={`/players/${b.user_id}`} className="font-bold hover:text-brand">
                          {liveName(live, b.users, b.users?.real_name || b.users?.display_name || b.user_id)}
                        </Link>
                      </TableCell>
                      <TableCell className="p-3 max-w-64">
                        <div className="truncate">{b.reason || ","}</div>
                      </TableCell>
                      <TableCell className="p-3 text-foreground/70">{b.banned_by}</TableCell>
                      <TableCell className="p-3 text-muted-foreground">
                        {b.expires_at ? new Date(b.expires_at).toLocaleString() : "never"}
                      </TableCell>
                      <TableCell className="p-3">
                        {isActive ? (
                          <Badge className="bg-brand text-white">active</Badge>
                        ) : b.lifted_at ? (
                          <Badge variant="success">lifted</Badge>
                        ) : (
                          <Badge variant="secondary">expired</Badge>
                        )}
                      </TableCell>
                      <TableCell className="p-3 text-muted-foreground">
                        {new Date(b.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="p-3">{isActive && <LiftBanForm userId={b.user_id} />}</TableCell>
                    </TableRow>
                  );
                })}
                {bans.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="p-5 text-muted-foreground" colSpan={7}>
                      No bans issued yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      ) : active === "proposed" ? (
        <Card className="divide-y divide-border py-0">
          {proposals.length === 0 && (
            <div className="p-5 text-muted-foreground text-sm">No bans waiting on confirmation.</div>
          )}
          {proposals.map((p) => (
            <div key={p.id} className="p-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <div className="flex-1 min-w-48">
                <Link href={`/players/${p.user_id}`} className="font-bold hover:text-brand">
                  {liveName(live, p.users, p.users?.real_name || p.users?.display_name || p.user_id)}
                </Link>
                <div className="text-foreground/70 break-words">{p.reason}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {p.hours > 0 ? `${p.hours}h` : "permanent"} · proposed by {p.proposed_by} ·{" "}
                  {new Date(p.created_at).toLocaleString()}
                </div>
              </div>
              {canConfirm ? (
                <div className="flex gap-2 shrink-0">
                  <form action={confirmBanProposal}>
                    <input type="hidden" name="id" value={p.id} />
                    <PendingButton
                      type="submit"
                      size="sm"
                      pendingText="Confirming…"
                      confirm={`Confirm the ban on ${liveName(live, p.users, p.users?.real_name || p.users?.display_name || p.user_id)}?`}
                      className="bg-brand text-white border-transparent"
                    >
                      Confirm ban
                    </PendingButton>
                  </form>
                  <form action={rejectBanProposal}>
                    <input type="hidden" name="id" value={p.id} />
                    <PendingButton
                      type="submit"
                      size="sm"
                      variant="outline"
                      pendingText="Rejecting…"
                      className="text-muted-foreground"
                    >
                      Reject
                    </PendingButton>
                  </form>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground shrink-0">
                  Needs the &ldquo;ban&rdquo; permission to decide
                </span>
              )}
            </div>
          ))}
        </Card>
      ) : (
        <Card className="divide-y divide-border py-0">
          {log.length === 0 && (
            <div className="p-5 text-muted-foreground text-sm">No ban actions yet.</div>
          )}
          {log.map((r) => (
            <div key={r.id} className="p-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <Badge variant={r.action === "ban" ? "destructive" : "success"} className="shrink-0">
                {r.action === "ban" ? "banned" : "lifted"}
              </Badge>
              <div className="flex-1 min-w-48">
                <span className="font-bold">{r.actor}</span>
                {" → "}
                <Link href={`/players/${r.user_id}`} className="font-bold hover:text-brand">
                  {r.player_name}
                </Link>
                <div className="text-foreground/70 break-words">{r.detail}</div>
              </div>
              <div className="text-xs text-muted-foreground shrink-0">
                {new Date(r.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
