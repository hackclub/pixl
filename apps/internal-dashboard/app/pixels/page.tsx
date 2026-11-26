import { requirePage } from "@/lib/guard";
import { listPixelTransactions, totalWalletPixels } from "@/lib/db";
import { config } from "@/app/_generated/config";
import { PixelAdjustForm } from "@/app/_components/PixelAdjustForm";
import {
  ButtonLink,
  Card,
  EmptyRow,
  Flash,
  LinkTabs,
  Mono,
  Muted,
  PageHeader,
  Pagination,
  Stat,
  StatGrid,
  Table,
  TextLink,
  formatDateTime,
} from "@/app/_ui/ui";

export const dynamic = "force-dynamic";

const PER = 25;

const REASON_LABEL: Record<string, string> = {
  project_approved: "Project approved",
  review_reverted: "Verdict reverted",
  operation_blackout: "Operation Blackout",
  operation_blackout_reverted: "Blackout reverted",
  manual_deduction: "Manual deduction",
  manual_grant: "Manual grant",
};

const MANUAL_REASONS = new Set(["manual_grant", "manual_deduction"]);

// Manual grants/deductions pack their justification into created_by as
// "actor , note" (adjustPixels in app/actions.ts). Older rows used an em dash
// as the separator, so both are split. The note names the transaction and the
// By column shows just who did it.
const BY_SEPARATORS = [" , ", ` ${String.fromCharCode(0x2014)} `];

function splitBy(reason: string, createdBy: string): { actor: string; note: string } {
  if (MANUAL_REASONS.has(reason)) {
    for (const sep of BY_SEPARATORS) {
      const i = createdBy.indexOf(sep);
      if (i !== -1) return { actor: createdBy.slice(0, i), note: createdBy.slice(i + sep.length) };
    }
  }
  return { actor: createdBy, note: "" };
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function usd(px: number): string {
  return `About $${(px * config.economy.pixelValueUsd).toFixed(2)}`;
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
  const access = await requirePage("owner");
  const { page, filter, user, error, adjusted } = await searchParams;
  const [all, net] = await Promise.all([listPixelTransactions(1000), totalWalletPixels()]);

  // amount is bigint in Postgres, which the driver hands back as a string.
  // Summing it with plain `+` would silently concatenate strings.
  const issued = all.filter((t) => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const spent = all.filter((t) => Number(t.amount) < 0).reduce((s, t) => s + Number(t.amount), 0);

  const activeFilter = filter === "given" || filter === "spent" ? filter : "all";
  let rows = all;
  if (activeFilter === "given") rows = rows.filter((t) => Number(t.amount) > 0);
  else if (activeFilter === "spent") rows = rows.filter((t) => Number(t.amount) < 0);
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
    <div className="flex flex-col gap-6">
      <div>
        <PageHeader
          title="Pixels log"
          description={`Every pixel movement: who it went to, how many, why, and who granted it. 1 pixel = $${config.economy.pixelValueUsd.toFixed(2)}, whole pixels only.`}
        />
        <Flash error={error} ok={adjusted ? "Balance adjusted. It's in the ledger below." : null} />
      </div>

      <StatGrid>
        <Stat label="Given out" value={fmt(issued)} tone="success" icon="up-caret" href={qp({ filter: "given" })} hint={usd(issued)} />
        <Stat label="Spent / removed" value={fmt(-spent)} tone="danger" icon="down-caret" href={qp({ filter: "spent" })} hint={usd(-spent)} />
        <Stat label="Net in wallets" value={fmt(net)} icon="purse-fill" href={qp({ filter: "all" })} hint={usd(net)} />
      </StatGrid>

      {access.isOwner && <PixelAdjustForm />}

      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <LinkTabs active={activeFilter} tabs={filters.map((f) => ({ key: f.key, label: f.label, href: qp({ filter: f.key }) }))} />
          {user && (
            <ButtonLink
              href={activeFilter !== "all" ? `/pixels?filter=${activeFilter}` : "/pixels"}
              variant="outline"
              size="sm"
              icon="view-close-small"
            >
              {userName}
            </ButtonLink>
          )}
        </div>

        <Card padding="flush">
          <Table headers={["Player", "Amount", "Reason", "Project", "By", "When"]}>
            {slice.map((t) => {
              const { actor, note } = splitBy(t.reason, t.created_by);
              const amount = Number(t.amount);
              return (
                <tr key={t.id}>
                  <td>
                    <TextLink href={`/pixels?user=${t.user_id}`} className="font-bold">
                      {t.player_name}
                    </TextLink>
                  </td>
                  <td>
                    <span
                      className="font-bold tabular-nums"
                      style={{ color: amount >= 0 ? "var(--hc-green)" : "var(--hc-red)" }}
                    >
                      {amount >= 0 ? "+" : "-"}
                      {fmt(Math.abs(amount))}
                    </span>
                  </td>
                  <td>
                    {note ? (
                      <>
                        <div className="font-bold">{note}</div>
                        <div className="text-xs hc-muted">{REASON_LABEL[t.reason] ?? t.reason}</div>
                      </>
                    ) : (
                      REASON_LABEL[t.reason] ?? (t.reason || <Muted>-</Muted>)
                    )}
                  </td>
                  <td>
                    {t.project_id != null ? (
                      <TextLink href={`/projects/${t.project_id}`}>{t.project_name}</TextLink>
                    ) : (
                      <Muted>-</Muted>
                    )}
                  </td>
                  <td>
                    <Muted>{actor || "-"}</Muted>
                  </td>
                  <td>
                    <Muted className="text-xs">
                      <Mono>{formatDateTime(t.created_at)}</Mono>
                    </Muted>
                  </td>
                </tr>
              );
            })}
            {slice.length === 0 && <EmptyRow colSpan={6} title="No pixel activity matches" icon="search" />}
          </Table>
        </Card>

        {total > 0 && (
          <p className="hc-caption mt-3 text-sm">
            Showing {start + 1} to {Math.min(start + PER, total)} of {total}
          </p>
        )}
        <Pagination page={cur} totalPages={pages} hrefFor={(n) => qp({ page: n })} />
      </div>
    </div>
  );
}
