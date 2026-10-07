import Link from "next/link";
import { requirePagePerm } from "@/lib/guard";
import { getLiveMode } from "@/lib/liveModeServer";
import { LiveBlocked } from "@/app/_components/LiveBlocked";
import { liveName } from "@/lib/liveMode";
import { listViolations } from "@/lib/db";
import { slackHandles } from "@/lib/slack";
import { BanForm, WarnForm } from "@/app/_components/Moderate";
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

const PER = 20;

export default async function ViolationsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; q?: string; page?: string }>;
}) {
  await requirePagePerm(["warn", "ban"]);
  const live = await getLiveMode();
  if (live) return <LiveBlocked what="Violations" reason="This page is internal moderation data" />;
  const { kind, q, page } = await searchParams;
  const all = await listViolations(500);

  const chatCount = all.filter((v) => v.kind === "chat").length;
  const nameCount = all.length - chatCount;

  const query = (q ?? "").trim().toLowerCase();
  let rows = all;
  if (kind === "chat") rows = rows.filter((v) => v.kind === "chat");
  else if (kind === "name") rows = rows.filter((v) => v.kind !== "chat");
  if (query)
    rows = rows.filter(
      (v) =>
        liveName(live, v.users, v.users?.real_name || v.users?.display_name || "").toLowerCase().includes(query) ||
        (v.content ?? "").toLowerCase().includes(query),
    );

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PER));
  const cur = Math.min(Math.max(parseInt(page ?? "1", 10) || 1, 1), pages);
  const start = (cur - 1) * PER;
  const slice = rows.slice(start, start + PER);
  const handles = await slackHandles(slice.map((v) => v.users?.slack_id));

  const filters = [
    { key: "all", label: "All", count: all.length },
    { key: "chat", label: "Chat", count: chatCount },
    { key: "name", label: "Display names", count: nameCount },
  ];
  const activeKind = kind === "chat" || kind === "name" ? kind : "all";
  const withParams = (over: Record<string, string>) => {
    const k = over.kind ?? activeKind;
    const p = new URLSearchParams();
    if (k !== "all") p.set("kind", k);
    const qq = over.q ?? q;
    if (qq) p.set("q", qq);
    if (over.page && over.page !== "1") p.set("page", over.page);
    const s = p.toString();
    return s ? `/violations?${s}` : "/violations";
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-1">Violations</h1>
      <p className="text-sm text-muted-foreground mb-5">
        Every censored chat message and rejected display name, newest first.
      </p>

      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="inline-flex items-center rounded-lg border border-border p-0.5 bg-card">
          {filters.map((f) => (
            <Button
              key={f.key}
              asChild
              variant="ghost"
              size="sm"
              className={activeKind === f.key ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : ""}
            >
              <Link href={withParams({ kind: f.key })}>
                {f.label}
                <span className="text-[0.7rem] opacity-70">{f.count}</span>
              </Link>
            </Button>
          ))}
        </div>
        <form className="flex gap-2">
          {activeKind !== "all" && <input type="hidden" name="kind" value={activeKind} />}
          <Input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search player or text…"
            className="text-sm min-w-0 w-56"
          />
          <Button type="submit">Search</Button>
        </form>
      </div>

      <Card className="divide-y divide-border py-0">
        {slice.length === 0 && (
          <div className="p-6 text-muted-foreground text-sm text-center">No violations match.</div>
        )}
        {slice.map((v) => {
          const name = liveName(live, v.users, v.users?.real_name || v.users?.display_name || v.user_id);
          const handle = live ? null : ((v.users?.slack_id && handles.get(v.users.slack_id)) ?? null);
          const initials =
            (name || "?")
              .split(/\s+/)
              .map((w) => w[0])
              .slice(0, 2)
              .join("")
              .toUpperCase() || "?";
          return (
            <div key={v.id} className="p-4">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="grid place-items-center w-8 h-8 rounded-full bg-primary/15 text-primary text-xs font-semibold shrink-0">
                  {initials}
                </span>
                <div className="min-w-0">
                  <Link
                    href={`/players/${v.user_id}`}
                    className="font-medium hover:text-brand block truncate"
                  >
                    {name}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {handle ? `${handle} · ` : ""}
                    {!v.users?.slack_id && "no slack , can't DM · "}
                    {new Date(v.created_at).toLocaleString()}
                  </span>
                </div>
                <Badge
                  variant={v.kind === "chat" ? "warning" : "destructive"}
                  className="ml-auto"
                >
                  {v.kind === "chat" ? "chat" : v.kind}
                </Badge>
              </div>
              <div className="text-sm bg-muted border border-border rounded-lg px-3 py-1.5 my-2 break-words">
                {v.content}
              </div>
              <div className="flex gap-3 flex-wrap">
                <WarnForm userId={v.user_id} compact />
                <BanForm userId={v.user_id} compact />
              </div>
            </div>
          );
        })}
      </Card>

      {total > PER && (
        <div className="flex items-center justify-between gap-3 mt-4 text-sm">
          <span className="text-muted-foreground">
            Showing {start + 1}–{Math.min(start + PER, total)} of {total}
          </span>
          <Pagination className="mx-0 w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationLink
                  href={withParams({ page: String(cur - 1) })}
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
                  href={withParams({ page: String(cur + 1) })}
                  aria-label="Next page"
                  className={cur >= pages ? "pointer-events-none opacity-40" : ""}
                >
                  →
                </PaginationLink>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}
