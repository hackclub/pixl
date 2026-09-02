import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePagePerm } from "@/lib/guard";
import { listPixelTransactions } from "@/lib/db";
import { config } from "@/app/_generated/config";
import { PixelAdjustForm } from "@/app/_components/PixelAdjustForm";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

const PER = 25;

const REASON_LABEL: Record<string, string> = {
  project_approved: "Project approved",
  review_reverted: "Verdict reverted",
  manual_deduction: "Manual deduction",
  manual_grant: "Manual grant",
};

const MANUAL_REASONS = new Set(["manual_grant", "manual_deduction"]);

// Manual grants/deductions pack their justification into created_by as
// "actor , note". Split it so the note names the transaction and the By
// column shows just who did it.
function splitBy(reason: string, createdBy: string): { actor: string; note: string } {
  if (MANUAL_REASONS.has(reason)) {
    const i = createdBy.indexOf(" , ");
    if (i !== -1) return { actor: createdBy.slice(0, i), note: createdBy.slice(i + 3) };
  }
  return { actor: createdBy, note: "" };
}

function fmt(n: number): string {
  return String(Math.round(n));
}

export default async function PixelsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    filter?: string;
    user?: string;
    error?: string;
    adjusted?: string;
  }>;
}) {
  const access = await requirePagePerm(["pixels"]);
  const { page, filter, user, error, adjusted } = await searchParams;
  const all = await listPixelTransactions(1000);

  // amount is bigint in Postgres, which the driver hands back as a string , summing
  // it with plain `+` silently does string concatenation instead of addition.
  const issued = all
    .filter((t) => Number(t.amount) > 0)
    .reduce((s, t) => s + Number(t.amount), 0);
  const spent = all
    .filter((t) => Number(t.amount) < 0)
    .reduce((s, t) => s + Number(t.amount), 0);
  const net = issued + spent;

  const activeFilter = filter === "given" || filter === "spent" ? filter : "all";
  let rows = all;
  if (activeFilter === "given") rows = rows.filter((t) => t.amount > 0);
  else if (activeFilter === "spent") rows = rows.filter((t) => t.amount < 0);
  if (user) rows = rows.filter((t) => t.user_id === user);
  const userName = user ? (rows[0]?.player_name ?? "player") : null;

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PER));
  const cur = Math.min(Math.max(parseInt(page ?? "1", 10) || 1, 1), pages);
  const start = (cur - 1) * PER;
  const slice = rows.slice(start, start + PER);

  const qp = (over: { page?: number; filter?: string }) => {
    const p = new URLSearchParams();
    const f = over.filter ?? activeFilter;
    if (f !== "all") p.set("filter", f);
    if (user) p.set("user", user);
    if (over.page && over.page !== 1) p.set("page", String(over.page));
    const s = p.toString();
    return s ? `/pixels?${s}` : "/pixels";
  };

  const filters = [
    { key: "all", label: "All" },
    { key: "given", label: "Given out" },
    { key: "spent", label: "Spent / removed" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-1">Pixels log</h1>
      <p className="text-sm text-muted-foreground mb-5">
        Every pixel movement , who it went to, how many, why, and who granted it. 1 pixel = $
        {config.economy.pixelValueUsd.toFixed(2)} · whole pixels only.
      </p>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="font-medium text-destructive">{error}</AlertDescription>
        </Alert>
      )}
      {adjusted && (
        <Alert className="mb-4">
          <AlertDescription className="font-medium text-hc-green">
            Balance adjusted , it&apos;s in the ledger below.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Link href={qp({ filter: "given" })} className="block">
          <Card className="p-4 gap-0 h-full transition-[box-shadow] hover:ring-hc-green/50">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Given out</div>
            <div className="text-2xl font-bold mt-1 tabular-nums text-hc-green">{fmt(issued)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">≈ ${(issued * config.economy.pixelValueUsd).toFixed(2)}</div>
          </Card>
        </Link>
        <Link href={qp({ filter: "spent" })} className="block">
          <Card className="p-4 gap-0 h-full transition-[box-shadow] hover:ring-brand/50">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Spent / removed</div>
            <div className="text-2xl font-bold mt-1 tabular-nums text-brand">{fmt(-spent)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">≈ ${(-spent * config.economy.pixelValueUsd).toFixed(2)}</div>
          </Card>
        </Link>
        <Link href={qp({ filter: "all" })} className="block">
          <Card className="p-4 gap-0 h-full transition-[box-shadow] hover:ring-foreground/25">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Net in wallets</div>
            <div className="text-2xl font-bold mt-1 tabular-nums">{fmt(net)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">≈ ${(net * config.economy.pixelValueUsd).toFixed(2)}</div>
          </Card>
        </Link>
      </div>

      {access.isSuper && <PixelAdjustForm />}

      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="inline-flex items-center rounded-lg border border-border p-0.5 bg-card">
          {filters.map((f) => (
            <Button
              key={f.key}
              asChild
              variant="ghost"
              size="sm"
              className={activeFilter === f.key ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : ""}
            >
              <Link href={qp({ filter: f.key })}>{f.label}</Link>
            </Button>
          ))}
        </div>
        {user && (
          <Badge asChild variant="destructive">
            <Link href={activeFilter !== "all" ? `/pixels?filter=${activeFilter}` : "/pixels"}>
              {userName} ✕
            </Link>
          </Badge>
        )}
      </div>

      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="p-3 font-medium">Player</TableHead>
              <TableHead className="p-3 font-medium">Amount</TableHead>
              <TableHead className="p-3 font-medium">Reason</TableHead>
              <TableHead className="p-3 font-medium">Project</TableHead>
              <TableHead className="p-3 font-medium">By</TableHead>
              <TableHead className="p-3 font-medium">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slice.map((t) => {
              const { actor, note } = splitBy(t.reason, t.created_by);
              return (
              <TableRow key={t.id}>
                <TableCell className="p-3">
                  <Link href={`/pixels?user=${t.user_id}`} className="font-medium hover:text-brand">
                    {t.player_name}
                  </Link>
                </TableCell>
                <TableCell
                  className={`p-3 tabular-nums font-semibold ${
                    t.amount >= 0 ? "text-hc-green" : "text-brand"
                  }`}
                >
                  {t.amount >= 0 ? "+" : "−"}
                  {fmt(Math.abs(t.amount))}
                </TableCell>
                <TableCell className="p-3">
                  {note ? (
                    <>
                      <div className="text-foreground font-medium">{note}</div>
                      <div className="text-xs text-muted-foreground">{REASON_LABEL[t.reason] ?? t.reason}</div>
                    </>
                  ) : (
                    <span className="text-foreground/70">{REASON_LABEL[t.reason] ?? (t.reason || ",")}</span>
                  )}
                </TableCell>
                <TableCell className="p-3">
                  {t.project_id != null ? (
                    <Link href={`/projects/${t.project_id}`} className="hover:text-brand">
                      {t.project_name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="p-3 text-muted-foreground">{actor || ","}</TableCell>
                <TableCell className="p-3 text-muted-foreground">{new Date(t.created_at).toLocaleString()}</TableCell>
              </TableRow>
              );
            })}
            {slice.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="p-5 text-muted-foreground">
                  No pixel activity matches.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {total > 0 && (
        <div className="flex items-center justify-between gap-3 mt-4 text-sm">
          <span className="text-muted-foreground">
            Showing {start + 1}–{Math.min(start + PER, total)} of {total}
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
      )}
    </div>
  );
}
