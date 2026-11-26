import { Suspense } from "react";
import { requirePage } from "@/lib/guard";
import { listPlayers } from "@/lib/db";
import { slackHandles } from "@/lib/slack";
import { massPlayerAction, syncSlackAvatars } from "@/app/actions";
import { SelectAllBox, RowSelect } from "@/app/_components/MassSelect";
import {
  ActionButton,
  Badge,
  Card,
  CardHeader,
  EmptyRow,
  FilterBar,
  Field,
  Flash,
  Input,
  Mono,
  Muted,
  NativeSelect,
  PageHeader,
  Pagination,
  Table,
  TextLink,
  formatDate,
} from "@/app/_ui/ui";

export const dynamic = "force-dynamic";

const PER = 25;

type Player = Awaited<ReturnType<typeof listPlayers>>[number];

function playerName(p: Player, handle?: string | null): string {
  return p.real_name || handle || p.display_name || "Unknown";
}

// Slack handles stream in after the table renders, so a slow Slack never
// holds the page.
async function PlayerName({ p, handles }: { p: Player; handles: Promise<Map<string, string>> }) {
  const map = await handles;
  return <>{playerName(p, p.slack_id ? map.get(p.slack_id) : null)}</>;
}

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; done?: string; error?: string }>;
}) {
  const access = await requirePage("owner");
  const { q, page, done, error } = await searchParams;
  const all = await listPlayers(q);

  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / PER));
  const cur = Math.min(Math.max(parseInt(page ?? "1", 10) || 1, 1), pages);
  const start = (cur - 1) * PER;
  const players = all.slice(start, start + PER);
  const handles = slackHandles(players.map((p) => p.slack_id));
  const qp = (n: number) => `/players?page=${n}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  const canWarn = access.isOwner;
  const canNotify = access.isOwner;
  const canBan = access.isOwner;
  const defaultAction = canWarn ? "warn" : canNotify ? "notify" : "ban";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageHeader
          title="Players"
          count={total}
          actions={
            access.isOwner && (
              <form action={syncSlackAvatars}>
                <ActionButton variant="outline" size="sm" icon="slack-fill" pendingLabel="Syncing...">
                  Sync Slack photos
                </ActionButton>
              </form>
            )
          }
        />
        <Flash error={error} ok={done} />
        <FilterBar q={q} placeholder="Search display names" />
      </div>

      <form action={massPlayerAction} className="flex flex-col gap-6">
        <input type="hidden" name="back" value={qp(cur)} />

        <Card>
          <CardHeader title="Mass action" icon="people-3" />
          <p className="hc-caption mb-4 text-sm">Tick players below, then apply the action to all of them at once.</p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Action">
              <NativeSelect name="massAction" defaultValue={defaultAction}>
                {canWarn && <option value="warn">Warn</option>}
                {canNotify && <option value="notify">Notify</option>}
                {canBan && <option value="ban">Ban</option>}
                {canBan && <option value="unban">Lift bans</option>}
              </NativeSelect>
            </Field>
            <Field label="Message / reason" hint="Required for ban and notify" className="min-w-56 flex-1">
              <Input name="message" maxLength={1000} placeholder="Sent to every selected player" />
            </Field>
            <Field label="Title" hint="Notify only" className="w-44">
              <Input name="title" maxLength={100} placeholder="Message from the Pixl team" />
            </Field>
            <Field label="Ban hours" hint="Blank = permanent" className="w-36">
              <Input name="hours" type="number" min={0} placeholder="Permanent" />
            </Field>
            <ActionButton
              variant="danger"
              pendingLabel="Applying..."
              confirm="Apply this action to every selected player?"
            >
              Apply to selected
            </ActionButton>
          </div>
        </Card>

        <div>
          <Card padding="flush">
            <Table headers={[<SelectAllBox key="all" />, "Player", "Projects", "Violations", "Status", "Joined"]}>
              {players.map((p) => (
                <tr key={p.id}>
                  <td className="w-8">
                    <RowSelect id={p.id} label={`Select ${p.real_name || p.display_name || p.id}`} />
                  </td>
                  <td>
                    <TextLink href={`/players/${p.id}`} className="font-bold">
                      <Suspense fallback={playerName(p)}>
                        <PlayerName p={p} handles={handles} />
                      </Suspense>
                    </TextLink>
                    <div className="text-xs hc-muted">
                      <Mono>{p.slack_id ?? "no Slack id"}</Mono> · {p.oauth_provider}
                    </div>
                  </td>
                  <td className="tabular-nums">{p.projectCount}</td>
                  <td className="tabular-nums">
                    {p.violationCount > 0 ? <Badge tone="warning">{p.violationCount}</Badge> : <Muted>0</Muted>}
                  </td>
                  <td>{p.activeBan ? <Badge tone="danger">Banned</Badge> : <Badge tone="success">OK</Badge>}</td>
                  <td>
                    <Muted>
                      <Mono>{formatDate(p.created_at)}</Mono>
                    </Muted>
                  </td>
                </tr>
              ))}
              {players.length === 0 && (
                <EmptyRow colSpan={6} title="No players found" icon="search">
                  Try a different name.
                </EmptyRow>
              )}
            </Table>
          </Card>
          {total > 0 && (
            <p className="hc-caption mt-3 text-sm">
              Showing {start + 1} to {Math.min(start + PER, total)} of {total}
            </p>
          )}
        </div>
      </form>

      <Pagination page={cur} totalPages={pages} hrefFor={qp} />
    </div>
  );
}
