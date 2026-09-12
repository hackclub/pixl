import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/guard";
import { listActivityFeed, type FeedItem } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";

export const dynamic = "force-dynamic";

// How deep each source is read before the merge. Everything the filters can
// match lives inside this window - see listActivityFeed's header comment.
const DEPTH = 500;
const PER = 50;

const KINDS: { key: FeedItem["kind"]; label: string; variant: "destructive" | "info" | "success" | "warning" | "secondary" }[] = [
  { key: "mod", label: "Moderation", variant: "destructive" },
  { key: "review", label: "Review", variant: "info" },
  { key: "team", label: "Team & perms", variant: "warning" },
  { key: "payout", label: "Payouts", variant: "success" },
  { key: "pixels", label: "Pixels", variant: "secondary" },
];

const RANGES = [
  { key: "1", label: "24h" },
  { key: "7", label: "7d" },
  { key: "30", label: "30d" },
  { key: "", label: "All" },
];

function variantFor(kind: FeedItem["kind"]) {
  return KINDS.find((k) => k.key === kind)?.variant ?? "secondary";
}

function labelFor(kind: FeedItem["kind"]) {
  return KINDS.find((k) => k.key === kind)?.label ?? kind;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; q?: string; days?: string; page?: string }>;
}) {
  // Everything here crosses permission boundaries - a moderator's bans next to
  // a reviewer's verdicts next to permission grants - so it stays owner-only
  // rather than being assembled per-viewer like the overview widget is.
  const access = await requireAdmin();
  if (!access.isSuper) redirect("/");
  const { kind, q, days, page } = await searchParams;

  const activeKinds = KINDS.filter((k) => k.key === kind).map((k) => k.key);
  const search = (q ?? "").slice(0, 100);
  const dayRange = RANGES.some((r) => r.key === days && r.key) ? Number(days) : null;
  const since = dayRange
    ? new Date(Date.now() - dayRange * 86_400_000).toISOString()
    : undefined;

  const items = await listActivityFeed({
    mod: true,
    review: true,
    team: true,
    pixels: true,
    payouts: true,
    limit: DEPTH,
    kinds: activeKinds.length ? activeKinds : undefined,
    q: search || undefined,
    since,
  });

  const pages = Math.max(1, Math.ceil(items.length / PER));
  const cur = Math.min(Math.max(parseInt(page ?? "1", 10) || 1, 1), pages);
  const start = (cur - 1) * PER;
  const slice = items.slice(start, start + PER);

  const qp = (over: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const merged = { kind, q: search, days, page: cur, ...over };
    for (const [k, v] of Object.entries(merged)) {
      if (v === undefined || v === "" || (k === "page" && v === 1)) continue;
      params.set(k, String(v));
    }
    const s = params.toString();
    return s ? `/audit?${s}` : "/audit";
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-1">
        Audit log
      </h1>
      <p className="text-sm text-muted-foreground mb-5">
        Every moderation action, review verdict, permission change, reviewer
        payout and pixel movement in one stream, newest first.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="inline-flex items-center rounded-lg border border-border p-0.5 bg-card">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className={!kind ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : ""}
          >
            <Link href={qp({ kind: undefined, page: 1 })}>All</Link>
          </Button>
          {KINDS.map((k) => (
            <Button
              key={k.key}
              asChild
              variant="ghost"
              size="sm"
              className={kind === k.key ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : ""}
            >
              <Link href={qp({ kind: k.key, page: 1 })}>{k.label}</Link>
            </Button>
          ))}
        </div>

        <div className="inline-flex items-center rounded-lg border border-border p-0.5 bg-card">
          {RANGES.map((r) => (
            <Button
              key={r.key || "all"}
              asChild
              variant="ghost"
              size="sm"
              className={(days ?? "") === r.key ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : ""}
            >
              <Link href={qp({ days: r.key || undefined, page: 1 })}>{r.label}</Link>
            </Button>
          ))}
        </div>

        {/* A plain GET form so the filter survives a reload and is linkable,
            same as every other filter on this page. */}
        <form action="/audit" className="flex items-center gap-2">
          {kind && <input type="hidden" name="kind" value={kind} />}
          {days && <input type="hidden" name="days" value={days} />}
          <Input
            name="q"
            defaultValue={search}
            placeholder="Search actor, target, detail…"
            className="h-8 w-64"
          />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
          {search && (
            <Button asChild variant="ghost" size="sm">
              <Link href={qp({ q: undefined, page: 1 })}>Clear</Link>
            </Button>
          )}
        </form>
      </div>

      <Card className="divide-y divide-border py-0">
        {slice.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nothing matches those filters.
          </div>
        )}
        {slice.map((i) => {
          const row = (
            <div className="p-4 flex flex-wrap items-start gap-x-4 gap-y-1 text-sm">
              <Badge variant={variantFor(i.kind)} className="shrink-0 mt-0.5">
                {labelFor(i.kind)}
              </Badge>
              <div className="flex-1 min-w-64">
                <div className="font-medium text-foreground">{i.text}</div>
                {i.detail && (
                  <div className="text-xs text-muted-foreground mt-0.5 break-words">
                    {i.detail}
                  </div>
                )}
              </div>
              <time
                className="text-xs text-muted-foreground shrink-0 tabular-nums mt-0.5"
                dateTime={i.when}
              >
                {new Date(i.when).toLocaleString()}
              </time>
            </div>
          );
          const key = `${i.kind}-${i.when}-${i.text}`;
          return i.href ? (
            <Link key={key} href={i.href} className="block hover:bg-muted/50">
              {row}
            </Link>
          ) : (
            <div key={key}>{row}</div>
          );
        })}
      </Card>

      <div className="flex items-center justify-between gap-3 mt-4 text-sm">
        <span className="text-muted-foreground">
          {items.length === 0
            ? "No entries"
            : `Showing ${start + 1}–${Math.min(start + PER, items.length)} of ${items.length}`}
          {items.length >= DEPTH && " (capped at the most recent entries per source)"}
        </span>
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationLink
                href={qp({ page: cur - 1 })}
                aria-label="Previous page"
                className={cur <= 1 ? "pointer-events-none opacity-40" : ""}
              >
                ←
              </PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <span className="px-2 text-muted-foreground tabular-nums">
                {cur} / {pages}
              </span>
            </PaginationItem>
            <PaginationItem>
              <PaginationLink
                href={qp({ page: cur + 1 })}
                aria-label="Next page"
                className={cur >= pages ? "pointer-events-none opacity-40" : ""}
              >
                →
              </PaginationLink>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}
