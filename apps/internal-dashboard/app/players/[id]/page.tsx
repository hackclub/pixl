import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/guard";
import { banIsActive, getPlayer, listReportsAgainst, playerLabel } from "@/lib/db";
import { slackDmLink, slackHandle } from "@/lib/slack";
import { isSafeUrl } from "@/lib/safeUrl";
import {
  BanForm,
  DeleteAccountForm,
  EditInfoForm,
  LiftBanForm,
  NotifyForm,
  ResetPositionForm,
  WarnForm,
} from "@/app/_components/Moderate";
import {
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  Details,
  EmptyRow,
  EmptyState,
  Flash,
  Mono,
  Muted,
  PageHeader,
  Stat,
  StatGrid,
  StatusBadge,
  Table,
  TextLink,
  formatDate,
  formatDateTime,
} from "@/app/_ui/ui";
import { PixelAdjustForm } from "@/app/_components/PixelAdjustForm";
import { PixelTransferForm } from "@/app/_components/PixelTransferForm";

export const dynamic = "force-dynamic";

const ROW = "border-b border-[var(--border)] px-4 py-3 last:border-b-0";

function fmt(n: number): string {
  return Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1);
}

// Streams in after the page renders, so a slow Slack never holds it.
async function SlackHandle({ id }: { id: string | null | undefined }) {
  const handle = await slackHandle(id);
  return handle ? <>{handle}, </> : null;
}

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; adjusted?: string; transferred?: string }>;
}) {
  const access = await requirePage("owner");
  // Every player action (warn, ban, notify, edit, delete) is owner-only.
  const owner = access.isOwner;
  const { id } = await params;
  const { error, adjusted, transferred } = await searchParams;
  const data = await getPlayer(id);
  if (!data) notFound();
  const { user, states, projects, violations, bans, actions } = data;
  const activeBan = bans.find(banIsActive) ?? null;
  const reports = owner ? await listReportsAgainst(id) : [];
  const openReports = reports.filter((r) => r.status === "open").length;
  const label = playerLabel(user, user.id);

  const pixels = Math.round((Number(user.pixels) || 0) * 100) / 100;
  const approvedHours =
    Math.round(
      projects.filter((p) => p.status === "approved").reduce((s, p) => s + (Number(p.approved_hours) || 0), 0) * 10,
    ) / 10;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <ButtonLink href="/players" variant="ghost" size="sm" icon="view-back">
          Players
        </ButtonLink>
      </div>

      <PageHeader
        title={
          <>
            <span className="break-words">{label}</span>
            {activeBan && (
              <Badge tone="danger" icon="private">
                Banned {activeBan.expires_at ? `until ${formatDate(activeBan.expires_at)}` : "forever"}
              </Badge>
            )}
          </>
        }
        description={
          <>
            {user.real_name && user.display_name && user.real_name !== user.display_name && (
              <>In-game: {user.display_name}. </>
            )}
            <Suspense fallback={null}>
              <SlackHandle id={user.slack_id} />
            </Suspense>
            {user.slack_id ? <Mono>{user.slack_id}</Mono> : <span>no Slack id, can&apos;t DM</span>}, joined{" "}
            {formatDate(user.created_at)}
          </>
        }
        actions={
          user.slack_id ? (
            <ButtonLink href={slackDmLink(user.slack_id)} external variant="outline" size="sm" icon="slack-fill">
              Message on Slack
            </ButtonLink>
          ) : undefined
        }
      />

      <Flash error={error} ok={adjusted ? "Balance adjusted. It's in the pixel log." : transferred} />

      <StatGrid>
        <Stat label="Pixels" value={fmt(pixels)} icon="purse-fill" tone="warning" href={`/pixels?user=${user.id}`} />
        <Stat label="Approved hours" value={`${fmt(approvedHours)}h`} icon="clock" />
        <Stat label="Projects" value={projects.length} icon="rep" />
        <Stat label="Violations" value={violations.length} icon="important" tone={violations.length > 0 ? "warning" : undefined} />
        {owner && (
          <Stat
            label="Reports"
            value={reports.length}
            icon="flag-fill"
            tone={openReports > 0 ? "danger" : undefined}
            href="/reports"
            hint={openReports > 0 ? `${openReports} open` : undefined}
          />
        )}
      </StatGrid>

      {owner && (
        <Card>
          <CardHeader
            title="Pixels"
            icon="purse-fill"
            action={
              <ButtonLink href={`/pixels?user=${user.id}`} variant="ghost" size="sm" icon="history">
                Pixel log
              </ButtonLink>
            }
          />
          <p className="hc-caption mb-4 text-sm">
            {label} has <strong>{fmt(pixels)} pixels</strong>. Adjustments and player-to-player transfers are written
            to the pixel log with a reason, and both sides are notified.
          </p>
          <div className="flex flex-col gap-3">
            <PixelAdjustForm player={{ id: user.id, name: label }} back={`/players/${user.id}`} />
            <PixelTransferForm player={{ id: user.id, name: label }} balance={pixels} back={`/players/${user.id}`} />
          </div>
        </Card>
      )}

      {owner && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Moderate" icon="admin-badge" />
            <div className="flex flex-col gap-3">
              <WarnForm userId={user.id} />
              <BanForm userId={user.id} isBanned={!!activeBan} />
              {activeBan && <LiftBanForm userId={user.id} />}
              <NotifyForm userId={user.id} />
              <div>
                <ResetPositionForm userId={user.id} />
              </div>
            </div>
          </Card>

          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader title="Player info" icon="person-card" />
              <EditInfoForm
                userId={user.id}
                displayName={user.display_name}
                realName={user.real_name}
                email={user.email ?? ""}
              />
            </Card>
            <Card>
              <CardHeader title="Danger zone" icon="delete" />
              <p className="hc-caption mb-3 text-sm">
                For data removal requests: erases the account and everything we hold about them, including chat,
                tickets, Pixo&apos;s memory and their Airtable records. This can&apos;t be undone.
              </p>
              <DeleteAccountForm userId={user.id} />
            </Card>
          </div>
        </div>
      )}

      <Card padding="flush">
        <CardHeader title="Projects" icon="rep" count={projects.length} />
        {projects.length === 0 ? (
          <EmptyState title="No projects yet" icon="rep" />
        ) : (
          <ul>
            {projects.map((p) => (
              <li key={p.id} className={ROW}>
                <div className="flex flex-wrap items-center gap-2">
                  <TextLink href={`/projects/${p.id}`} className="font-bold">
                    {p.name}
                  </TextLink>
                  <StatusBadge status={p.status} />
                  {p.status === "approved" && p.approved_hours != null && (
                    <Badge tone="warning">{fmt(Number(p.approved_hours))}h credited</Badge>
                  )}
                </div>
                {p.description && <div className="mt-1 break-words text-sm hc-muted">{p.description}</div>}
                <div className="mt-1 flex flex-wrap gap-3 text-xs hc-muted">
                  {isSafeUrl(p.repo_url) && (
                    <TextLink href={p.repo_url} external>
                      Repo
                    </TextLink>
                  )}
                  {isSafeUrl(p.demo_url) && (
                    <TextLink href={p.demo_url} external>
                      Demo
                    </TextLink>
                  )}
                  {p.hackatime_projects.length > 0 && <span>Hackatime: {p.hackatime_projects.join(", ")}</span>}
                  <span>Created {formatDate(p.created_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {owner && (
        <Card padding="flush">
          <CardHeader title="Reports" icon="flag-fill" count={reports.length} />
          {reports.length === 0 ? (
            <EmptyState title="No reports filed against this player" icon="checkmark-all" />
          ) : (
            <ul>
              {reports.map((r) => (
                <li key={r.id} className={ROW}>
                  <div className="flex flex-wrap items-baseline gap-3">
                    <Badge tone={r.status === "open" ? "warning" : "neutral"}>{r.status}</Badge>
                    <span className="min-w-0 flex-1 break-words text-sm">
                      {r.reason || <Muted>No reason given</Muted>}
                    </span>
                    <Muted className="shrink-0 text-xs">
                      by {r.reporter_name}, <Mono>{formatDateTime(r.created_at)}</Mono>
                    </Muted>
                  </div>
                  {r.context.length > 0 && (
                    <div className="mt-2">
                      <Details summary={`Chat context (${r.context.length})`}>
                        <div className="flex flex-col gap-1 text-sm">
                          {r.context.map((c, i) => (
                            <div key={i} className="break-words">
                              <span
                                className="font-bold"
                                style={{ color: c.name === r.target_name ? "var(--primary)" : undefined }}
                              >
                                {c.name}
                              </span>
                              <Muted>: </Muted>
                              {c.text}
                            </div>
                          ))}
                        </div>
                      </Details>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card padding="flush">
          <CardHeader title="Violations" icon="important" count={violations.length} />
          {violations.length === 0 ? (
            <EmptyState title="Clean record" icon="checkmark-all" />
          ) : (
            <ul>
              {violations.map((v) => (
                <li key={v.id} className={`${ROW} flex items-baseline gap-3`}>
                  <Badge tone="warning">{v.kind}</Badge>
                  <span className="flex-1 break-words text-sm">{v.content}</span>
                  <Muted className="shrink-0 text-xs">
                    <Mono>{formatDateTime(v.created_at)}</Mono>
                  </Muted>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card padding="flush">
          <CardHeader title="Bans" icon="private" count={bans.length} />
          {bans.length === 0 ? (
            <EmptyState title="Never banned" icon="checkmark-all" />
          ) : (
            <ul>
              {bans.map((b) => (
                <li key={b.id} className={`${ROW} flex flex-wrap items-baseline gap-3 text-sm`}>
                  {banIsActive(b) ? (
                    <Badge tone="danger">Active</Badge>
                  ) : (
                    <Badge>{b.lifted_at ? "Lifted" : "Expired"}</Badge>
                  )}
                  <span className="flex-1">
                    {b.reason || "(no reason)"}, by {b.banned_by || "?"}
                  </span>
                  <Muted className="text-xs">
                    <Mono>
                      {formatDateTime(b.created_at)} to {b.expires_at ? formatDateTime(b.expires_at) : "forever"}
                    </Mono>
                  </Muted>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card padding="flush">
        <CardHeader title="Last known positions" icon="map-pin" />
        <Table headers={["Scene", "X", "Y", "Facing", "Updated"]}>
          {states.map((s) => (
            <tr key={s.scene}>
              <td>
                <Mono>{s.scene}</Mono>
              </td>
              <td className="tabular-nums">{Math.round(s.pos_x)}</td>
              <td className="tabular-nums">{Math.round(s.pos_y)}</td>
              <td>{s.direction}</td>
              <td>
                <Muted>
                  <Mono>{formatDateTime(s.updated_at)}</Mono>
                </Muted>
              </td>
            </tr>
          ))}
          {states.length === 0 && <EmptyRow colSpan={5} title="Never entered the world" icon="map-pin" />}
        </Table>
      </Card>

      <Card padding="flush">
        <CardHeader title="Moderation log" icon="history" count={actions.length} />
        {actions.length === 0 ? (
          <EmptyState title="No moderation actions yet" icon="history" />
        ) : (
          <ul>
            {actions.map((a) => (
              <li key={a.id} className={`${ROW} flex flex-wrap items-baseline gap-3 text-sm`}>
                <Badge>{a.action}</Badge>
                <span className="flex-1 break-words">{a.detail}</span>
                <Muted className="text-xs">
                  {a.actor}, <Mono>{formatDateTime(a.created_at)}</Mono>
                </Muted>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
