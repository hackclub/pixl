import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canView } from "@/lib/guard";
import { getLiveMode } from "@/lib/liveModeServer";
import { liveName } from "@/lib/liveMode";
import {
  getStats,
  getGrowthSeries,
  getPixelFlowSeries,
  listViolations,
  listActivityFeed,
} from "@/lib/db";
import { GrowthChart } from "@/app/_components/GrowthChart";
import { PixelFlowChart } from "@/app/_components/PixelFlowChart";
import { Badge } from "@/app/_components/ProjectBadges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const FEED_BADGE: Record<
  string,
  { label: string; tone: "amber" | "rose" | "green" | "blue" }
> = {
  mod: { label: "mod", tone: "amber" },
  team: { label: "team", tone: "rose" },
  review: { label: "review", tone: "green" },
  pixels: { label: "pixels", tone: "blue" },
  payout: { label: "payout", tone: "blue" },
};

export const dynamic = "force-dynamic";

const RANGES = [14, 30, 60, 90];

export default async function Overview({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const access = await requireAdmin();
  const live = await getLiveMode();
  // Reviewers / sub-admins don't get the owner Overview; their home is their own
  // reviewer stats. Only owners (isSuper) see the full dashboard overview.
  if (!access.isSuper && access.perms.has("review")) redirect("/review/stats");
  const showModeration = canView(access, ["warn", "ban"]);
  const { range } = await searchParams;
  const days = RANGES.includes(Number(range)) ? Number(range) : 30;
  const [stats, growth, pixelFlow, recent, feed] = await Promise.all([
    getStats(),
    getGrowthSeries(days),
    access.isSuper ? getPixelFlowSeries(days) : Promise.resolve([]),
    showModeration ? listViolations(8) : Promise.resolve([]),
    listActivityFeed({
      mod: showModeration,
      review: canView(access, ["review"]),
      team: access.isSuper,
      pixels: access.isSuper,
      payouts: access.isSuper,
      limit: 8,
    }),
  ]);

  const cards = [
    {
      label: "Players",
      value: stats.players,
      delta: stats.playersWeek,
      accent: false,
    },
    {
      label: "Projects",
      value: stats.projects,
      delta: stats.projectsWeek,
      accent: false,
    },
    ...(showModeration
      ? [
          {
            label: "Violations · 7d",
            value: stats.violations7d,
            delta: null,
            accent: false,
          },
          {
            label: "Active bans",
            value: stats.activeBans,
            delta: null,
            accent: true,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 w-full">
        {cards.map((c) => (
          <Card key={c.label} className="w-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {c.label}
              </CardTitle>
            </CardHeader>

            <CardContent>
              <div className="flex items-end gap-2">
                <div
                  className={`text-3xl font-bold tabular-nums ${
                    c.accent ? "text-brand" : ""
                  }`}
                >
                  {c.value.toLocaleString()}
                </div>

                {c.delta !== null && c.delta > 0 && (
                  <span className="text-xs font-medium text-emerald-500">
                    ▲ {c.delta}/wk
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h3 className="text-lg font-semibold text-foreground tracking-tight mb-3">
          New players
        </h3>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Today", value: stats.playersToday },
            { label: "This week", value: stats.playersWeek },
            { label: "This month", value: stats.playersMonth },
          ].map((c) => (
            <Card key={c.label} className="p-5 gap-0">
              <div className="text-sm font-medium text-muted-foreground">
                {c.label}
              </div>
              <div className="text-3xl font-semibold text-foreground tabular-nums mt-2">
                +{c.value.toLocaleString()}
              </div>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="text-lg font-semibold text-foreground tracking-tight">
            Growth
          </h3>
          <div className="inline-flex items-center rounded-lg border border-border p-0.5 bg-card">
            {RANGES.map((r) => (
              <Button
                key={r}
                asChild
                variant="ghost"
                size="sm"
                className={
                  r === days
                    ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                    : ""
                }
              >
                <Link href={r === 30 ? "/" : `/?range=${r}`}>{r}d</Link>
              </Button>
            ))}
          </div>
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          <Card className="p-5">
            <GrowthChart
              title="Players"
              series="players"
              kind="cumulative"
              points={growth.players}
            />
          </Card>
          <Card className="p-5">
            <GrowthChart
              title="Projects"
              series="projects"
              kind="cumulative"
              points={growth.projects}
            />
          </Card>
          {showModeration && (
            <Card className="p-5 lg:col-span-2">
              <GrowthChart
                title="Violations"
                series="violations"
                kind="daily"
                points={growth.violations}
              />
            </Card>
          )}
          {access.isSuper && (
            <Card className="p-5 lg:col-span-2">
              <PixelFlowChart points={pixelFlow} />
            </Card>
          )}
        </div>
      </div>

      {feed.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-foreground tracking-tight mb-3">
            Activity
          </h3>
          <Card className="divide-y divide-border py-0">
            {feed.map((f, i) => {
              const badge = FEED_BADGE[f.kind] ?? FEED_BADGE.mod;
              return (
                <div
                  key={i}
                  className="p-3.5 flex flex-wrap items-center gap-x-3 gap-y-1"
                >
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                  <div className="flex-1 min-w-0">
                    {f.href ? (
                      <Link
                        href={f.href}
                        className="font-medium text-sm hover:text-brand"
                      >
                        {f.text}
                      </Link>
                    ) : (
                      <span className="font-medium text-sm">{f.text}</span>
                    )}
                    {f.detail && (
                      <div className="text-xs text-muted-foreground truncate">
                        {f.detail}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">
                    {new Date(f.when).toLocaleString()}
                  </div>
                </div>
              );
            })}
          </Card>
        </div>
      )}

      {showModeration && (
        <div>
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
            <h3 className="text-lg font-semibold text-foreground tracking-tight">
              Latest violations
            </h3>
            <Link
              href="/violations"
              className="text-brand font-medium text-sm hover:underline"
            >
              See all →
            </Link>
          </div>
          <Card className="divide-y divide-border py-0">
            {recent.length === 0 && (
              <div className="p-5 text-muted-foreground text-sm">
                Nothing yet , squeaky clean.
              </div>
            )}
            {recent.map((v) => (
              <div
                key={v.id}
                className="p-4 flex flex-wrap items-center gap-x-4 gap-y-1"
              >
                <Badge tone={v.kind === "chat" ? "amber" : "rose"}>
                  {v.kind}
                </Badge>
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/players/${v.user_id}`}
                    className="font-medium hover:text-brand"
                  >
                    {liveName(live, v.users, v.users?.real_name || v.users?.display_name || v.user_id)}
                  </Link>
                  <div className="text-sm text-muted-foreground truncate">
                    “{v.content}”
                  </div>
                </div>
                <div className="text-xs text-muted-foreground shrink-0">
                  {new Date(v.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
