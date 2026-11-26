import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePage, can, landingFor } from "@/lib/guard";
import {
  getStats,
  getGrowthSeries,
  getPixelFlowSeries,
  listViolations,
  listActivityFeed,
} from "@/lib/db";
import { GrowthChart } from "@/app/_components/GrowthChart";
import { PixelFlowChart } from "@/app/_components/PixelFlowChart";
import {
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  Mono,
  Muted,
  PageHeader,
  Stat,
  StatGrid,
  TextLink,
  formatDateTime,
  type Tone,
} from "@/app/_ui/ui";

const FEED_BADGE: Record<string, { label: string; tone: Tone }> = {
  mod: { label: "Mod", tone: "warning" },
  team: { label: "Team", tone: "danger" },
  review: { label: "Review", tone: "success" },
  pixels: { label: "Pixels", tone: "info" },
  payout: { label: "Payout", tone: "info" },
};

export const dynamic = "force-dynamic";

const RANGES = [14, 30, 60, 90];

const ROW = "flex items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-3 last:border-b-0";

export default async function Overview({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const access = await requirePage("staff");
  // Only owners get the full overview. Reviewers land on their own stats,
  // helpers and fulfillers on their own queue.
  if (!access.isOwner) redirect(access.isReviewer ? "/review/stats" : landingFor(access));
  const showModeration = can(access, "owner");
  const showPixels = access.isOwner;
  const { range } = await searchParams;
  const days = RANGES.includes(Number(range)) ? Number(range) : 30;
  const [stats, growth, pixelFlow, recent, feed] = await Promise.all([
    getStats(),
    getGrowthSeries(days),
    showPixels ? getPixelFlowSeries(days) : Promise.resolve([]),
    showModeration ? listViolations(8) : Promise.resolve([]),
    listActivityFeed({
      mod: showModeration,
      review: can(access, "reviewer"),
      team: access.isOwner,
      pixels: showPixels,
      payouts: showPixels,
      limit: 8,
    }),
  ]);

  const rangePicker = (
    <div className="hc-segmented" role="tablist" aria-label="Chart range">
      {RANGES.map((r) => (
        <Link
          key={r}
          href={r === 30 ? "/" : `/?range=${r}`}
          role="tab"
          aria-selected={r === days}
          className="hc-segmented-item inline-flex items-center justify-center px-3"
        >
          {r}d
        </Link>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Overview" description="Everything happening across Pixl." actions={rangePicker} />

      <StatGrid>
        <Stat
          label="Players"
          value={stats.players.toLocaleString()}
          icon="people-3"
          href="/players"
          hint={`+${stats.playersToday} today, +${stats.playersWeek} this week, +${stats.playersMonth} this month`}
        />
        <Stat
          label="Projects"
          value={stats.projects.toLocaleString()}
          icon="rep"
          href="/projects"
          hint={stats.projectsWeek > 0 ? `+${stats.projectsWeek} this week` : undefined}
        />
        {showModeration && (
          <>
            <Stat
              label="Violations, 7d"
              value={stats.violations7d.toLocaleString()}
              icon="important"
              tone="warning"
              href="/violations"
            />
            <Stat
              label="Active bans"
              value={stats.activeBans.toLocaleString()}
              icon="private"
              tone="danger"
              href="/bans"
            />
          </>
        )}
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <GrowthChart title="Players" series="players" kind="cumulative" points={growth.players} />
        </Card>
        <Card>
          <GrowthChart title="Projects" series="projects" kind="cumulative" points={growth.projects} />
        </Card>
        {showModeration && (
          <Card className="lg:col-span-2">
            <GrowthChart title="Violations" series="violations" kind="daily" points={growth.violations} />
          </Card>
        )}
        {showPixels && (
          <Card className="lg:col-span-2">
            <PixelFlowChart points={pixelFlow} />
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card padding="flush">
          <CardHeader title="Recent activity" icon="history" />
          {feed.length === 0 ? (
            <EmptyState title="Nothing yet" icon="history" />
          ) : (
            <ul>
              {feed.map((f, i) => {
                const badge = FEED_BADGE[f.kind] ?? FEED_BADGE.mod;
                return (
                  <li key={i} className={ROW}>
                    <div className="flex min-w-0 items-center gap-3">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                      <div className="min-w-0">
                        {f.href ? (
                          <TextLink href={f.href} className="font-bold">
                            {f.text}
                          </TextLink>
                        ) : (
                          <span className="font-bold">{f.text}</span>
                        )}
                        {f.detail && <div className="truncate text-sm hc-muted">{f.detail}</div>}
                      </div>
                    </div>
                    <Muted className="shrink-0 text-xs">
                      <Mono>{formatDateTime(f.when)}</Mono>
                    </Muted>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {showModeration && (
          <Card padding="flush">
            <CardHeader
              title="Latest violations"
              icon="important"
              action={
                <ButtonLink href="/violations" variant="ghost" size="sm">
                  View all
                </ButtonLink>
              }
            />
            {recent.length === 0 ? (
              <EmptyState title="Squeaky clean" icon="checkmark-all">
                No violations yet.
              </EmptyState>
            ) : (
              <ul>
                {recent.map((v) => (
                  <li key={v.id} className={ROW}>
                    <div className="flex min-w-0 items-center gap-3">
                      <Badge tone={v.kind === "chat" ? "warning" : "danger"}>{v.kind}</Badge>
                      <div className="min-w-0">
                        <TextLink href={`/players/${v.user_id}`} className="font-bold">
                          {v.users?.real_name || v.users?.display_name || v.user_id}
                        </TextLink>
                        <div className="truncate text-sm hc-muted">&ldquo;{v.content}&rdquo;</div>
                      </div>
                    </div>
                    <Muted className="shrink-0 text-xs">
                      <Mono>{formatDateTime(v.created_at)}</Mono>
                    </Muted>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
