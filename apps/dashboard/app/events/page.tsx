import { redirect } from "next/navigation";
import { requirePagePerm } from "@/lib/guard";
import {
  listEvents,
  listShopItems,
  communityGoalShipCount,
  bountyClaimCount,
  EVENT_TYPES,
  type DashEventRow,
} from "@/lib/db";
import { createEvent, stopEvent, deleteEvent } from "@/app/actions";
import { CreateEventForm } from "@/app/_components/CreateEventForm";
import { PendingButton } from "@/app/_components/PendingButton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function status(ev: DashEventRow): "live" | "upcoming" | "ended" | "stopped" {
  const now = new Date().toISOString();
  if (ev.stopped_at) return "stopped";
  if (ev.starts_at > now) return "upcoming";
  if (ev.ends_at <= now) return "ended";
  return "live";
}

const STATUS_VARIANT: Record<string, "success" | "secondary" | "destructive"> = {
  live: "success",
  upcoming: "secondary",
  ended: "secondary",
  stopped: "destructive",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function configSummary(ev: DashEventRow): string {
  const c = ev.config;
  switch (ev.type) {
    case "bounty":
      return `+${Number(c.reward) || 0} px per project${c.description ? ` , ${c.description}` : ""}`;
    case "community_goal":
      return `${Number(c.target) || 0} ships → +${Number(c.bonusPct) || 0}% for every shipper${c.projectType ? ` (${c.projectType} only)` : ""}`;
    case "mystery_merchant":
      return `items ${(Array.isArray(c.itemIds) ? c.itemIds : []).join(", ")}`;
    case "review_blitz":
      return `reviewer payouts ×${Number(c.mult) || 1}`;
    default:
      return "window-only leaderboard in the explore menu";
  }
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string }>;
}) {
  const access = await requirePagePerm(["events"]);
  const { error, created } = await searchParams;

  const [events, allShopItems] = await Promise.all([listEvents(), listShopItems()]);
  // Trophies (unlock_xp > 0) are earned, not sold - never offer one as a
  // limited mystery-merchant item.
  const shopItems = allShopItems.filter((i) => i.unlock_xp === 0);
  const progress = new Map<number, number>();
  const claims = new Map<number, number>();
  for (const ev of events) {
    if (ev.type === "community_goal" && status(ev) !== "upcoming")
      progress.set(ev.id, await communityGoalShipCount(ev));
    if (ev.type === "bounty") claims.set(ev.id, await bountyClaimCount(ev.id));
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Events</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Weekend events players see in-game the moment they go live. All times are UTC. Bonus
          math runs server-side , nothing here hands out free pixels.
        </p>
      </div>

      {created && (
        <Alert>
          <AlertDescription className="font-medium text-emerald-600 dark:text-emerald-400">
            Event created.
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="font-medium text-destructive">{error}</AlertDescription>
        </Alert>
      )}

      <Card className="p-5 md:p-6 gap-0">
        <div className="text-base font-semibold mb-1">Start an event</div>
        <p className="text-xs text-muted-foreground mb-4">
          Fill only the fields your event type uses , the rest are ignored.
        </p>
        <CreateEventForm
          action={createEvent}
          types={EVENT_TYPES}
          shopItems={shopItems.map((i) => ({ id: i.id, name: i.name, active: i.active }))}
        />
      </Card>

      <div>
        <div className="text-sm font-medium text-muted-foreground mb-3">All events</div>
        <div className="space-y-3">
          {events.map((ev) => {
            const st = status(ev);
            return (
              <Card key={ev.id} className="p-4 gap-0 flex-row items-start justify-between flex-wrap">
                <div className="min-w-0">
                  <div className="font-bold flex items-center gap-2 flex-wrap">
                    {ev.name}
                    <Badge variant="secondary" className="text-[0.65rem] uppercase tracking-wide">
                      {EVENT_TYPES[ev.type] ?? ev.type}
                    </Badge>
                    <Badge variant={STATUS_VARIANT[st]} className="text-[0.65rem] uppercase tracking-wide">
                      {st}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">{configSummary(ev)}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {fmt(ev.starts_at)} → {fmt(ev.ends_at)} UTC
                    {ev.created_by ? ` · by ${ev.created_by.replace(/\s*\([^)]*\)\s*$/, "")}` : ""}
                  </div>
                  {ev.type === "community_goal" && progress.has(ev.id) && (
                    <div className="mt-2 max-w-sm">
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>
                          {progress.get(ev.id)} / {Number(ev.config.target) || 0} ships
                        </span>
                        <span>
                          {(progress.get(ev.id) ?? 0) >= (Number(ev.config.target) || Infinity)
                            ? "GOAL HIT 🎉"
                            : `+${Number(ev.config.bonusPct) || 0}% if hit`}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-emerald-500"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.round(
                                ((progress.get(ev.id) ?? 0) / (Number(ev.config.target) || 1)) * 100,
                              ),
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                  {ev.type === "bounty" && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {claims.get(ev.id) ?? 0} project{(claims.get(ev.id) ?? 0) === 1 ? "" : "s"} claimed it
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {(st === "live" || st === "upcoming") && (
                    <form action={stopEvent}>
                      <input type="hidden" name="id" value={ev.id} />
                      <PendingButton
                        variant="outline"
                        size="sm"
                        pendingText="Stopping…"
                        confirm={`Stop "${ev.name}" now? Players stop seeing it immediately.`}
                        className="text-rose-600 border-rose-200 dark:border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-600"
                      >
                        Stop
                      </PendingButton>
                    </form>
                  )}
                  {st !== "live" && (
                    <form action={deleteEvent}>
                      <input type="hidden" name="id" value={ev.id} />
                      <PendingButton
                        variant="ghost"
                        size="sm"
                        pendingText="Deleting…"
                        confirm={`Delete "${ev.name}"? This can't be undone.`}
                        className="text-muted-foreground"
                      >
                        Delete
                      </PendingButton>
                    </form>
                  )}
                </div>
              </Card>
            );
          })}
          {events.length === 0 && (
            <Card className="p-5 text-muted-foreground text-sm">
              No events yet. Start one above , players see it in-game instantly.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
