import { requirePage } from "@/lib/guard";
import { listViolations } from "@/lib/db";
import { BanForm, WarnForm } from "@/app/_components/Moderate";
import SlackName from "@/app/_ui/SlackName";
import {
  Badge,
  Card,
  EmptyRow,
  FilterBar,
  LinkTabs,
  Muted,
  PageHeader,
  Pagination,
  Quote,
  Table,
  TextLink,
  formatDateTime,
} from "@/app/_ui/ui";

export const dynamic = "force-dynamic";

const PER = 20;

export default async function ViolationsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; q?: string; page?: string }>;
}) {
  await requirePage("owner");
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
        (v.users?.real_name || v.users?.display_name || "").toLowerCase().includes(query) ||
        (v.content ?? "").toLowerCase().includes(query),
    );

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PER));
  const cur = Math.min(Math.max(parseInt(page ?? "1", 10) || 1, 1), pages);
  const start = (cur - 1) * PER;
  const slice = rows.slice(start, start + PER);

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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Violations"
        count={all.length}
        description="Every censored chat message and rejected display name, newest first."
      />

      <div>
        <FilterBar q={q} placeholder="Search player or text">
          {activeKind !== "all" && <input type="hidden" name="kind" value={activeKind} />}
        </FilterBar>

        <Card padding="flush">
          <LinkTabs
            active={activeKind}
            tabs={[
              { key: "all", href: withParams({ kind: "all" }), label: "All", count: all.length },
              { key: "chat", href: withParams({ kind: "chat" }), label: "Chat", count: chatCount },
              { key: "name", href: withParams({ kind: "name" }), label: "Display names", count: nameCount },
            ]}
          />
          <Table headers={["Player", "Content", "Kind", "When", "Moderate"]}>
            {slice.map((v) => {
              const name = v.users?.real_name || v.users?.display_name || v.user_id;
              return (
                <tr key={v.id}>
                  <td>
                    <TextLink href={`/players/${v.user_id}`} className="font-bold">
                      {name}
                    </TextLink>
                    <div className="text-xs">
                      <Muted>
                        {v.users?.slack_id ? <SlackName id={v.users.slack_id} fallback="" /> : "No Slack, can't DM"}
                      </Muted>
                    </div>
                  </td>
                  <td className="max-w-md break-words">
                    <Quote>{v.content}</Quote>
                  </td>
                  <td>
                    <Badge tone={v.kind === "chat" ? "warning" : "danger"}>{v.kind}</Badge>
                  </td>
                  <td className="whitespace-nowrap">
                    <Muted>{formatDateTime(v.created_at)}</Muted>
                  </td>
                  <td>
                    <div className="flex flex-wrap items-center gap-2">
                      <WarnForm userId={v.user_id} compact />
                      <BanForm userId={v.user_id} compact />
                    </div>
                  </td>
                </tr>
              );
            })}
            {slice.length === 0 && (
              <EmptyRow colSpan={5} title="No violations match" icon="search">
                Try a different filter or search.
              </EmptyRow>
            )}
          </Table>
        </Card>

        <Pagination page={cur} totalPages={pages} hrefFor={(p) => withParams({ page: String(p) })} />
      </div>
    </div>
  );
}
