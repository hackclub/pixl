import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePerm, isReportViewer } from "@/lib/guard";
import { getLiveMode } from "@/lib/liveModeServer";
import { banIsActive, getPlayer, listReportsAgainst } from "@/lib/db";
import { slackHandle } from "@/lib/slack";
import {
  BanForm,
  DeleteAccountForm,
  EditInfoForm,
  LiftBanForm,
  NotifyForm,
  ResetPositionForm,
  WarnForm,
} from "@/app/_components/Moderate";
import { StatusBadge } from "@/app/_components/ProjectBadges";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
        {title}
        {count !== undefined && <Badge variant="secondary">{count}</Badge>}
      </h2>
      {children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card className="p-4 gap-0">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${tone ?? "text-foreground"}`}>{value}</div>
    </Card>
  );
}

function fmt(n: number): string {
  return Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1);
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const access = await requirePagePerm(["warn", "ban"]);
  const live = await getLiveMode();
  const can = (p: string) => access.isSuper || access.perms.has(p);
  const { id } = await params;
  const data = await getPlayer(id);
  if (!data) notFound();
  const { user, states, projects, violations, bans, actions } = data;
  const activeBan = bans.find(banIsActive) ?? null;
  const handle = await slackHandle(user.slack_id);
  const canSeeReports = await isReportViewer();
  const reports = canSeeReports ? await listReportsAgainst(id) : [];
  const openReports = reports.filter((r) => r.status === "open").length;

  const pixels = Math.round((Number(user.pixels) || 0) * 100) / 100;
  const approvedHours =
    Math.round(
      projects
        .filter((p) => p.status === "approved")
        .reduce((s, p) => s + (Number(p.approved_hours) || 0), 0) * 10,
    ) / 10;
  const initials =
    (live ? user.display_name || "?" : user.real_name || user.display_name || "?")
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <div>
      <Link href="/players" className="text-sm text-brand font-medium hover:underline">
        ← All players
      </Link>

      <div className="flex items-start gap-4 flex-wrap mt-3 mb-5">
        <span className="grid place-items-center w-14 h-14 rounded-full bg-primary/15 text-primary text-lg font-bold shrink-0">
          {initials}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold text-foreground tracking-tight break-words">
              {live ? user.display_name : user.real_name || user.display_name}
            </h1>
            {!live && user.real_name && user.display_name && user.real_name !== user.display_name && (
              <span className="text-sm text-muted-foreground">
                in-game: {user.display_name}
              </span>
            )}
            {activeBan && (
              <Badge className="bg-rose-600 text-white">
                Banned{" "}
                {activeBan.expires_at
                  ? `until ${new Date(activeBan.expires_at).toLocaleDateString()}`
                  : "forever"}
              </Badge>
            )}
          </div>
          <div className="text-sm text-muted-foreground mt-1 break-words">
            {handle ? `${handle} · ` : ""}
            {user.slack_id ? (
              <span className="font-mono">{user.slack_id}</span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">no Slack id , can&apos;t DM</span>
            )}{" "}
            · joined {new Date(user.created_at).toLocaleDateString()}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
        <Link href={`/pixels?user=${user.id}`} className="contents">
          <Stat label="Pixels" value={fmt(pixels)} tone="text-amber-600 dark:text-amber-400" />
        </Link>
        <Stat label="Approved hrs" value={`${fmt(approvedHours)}h`} />
        <Stat label="Projects" value={String(projects.length)} />
        <Stat label="Violations" value={String(violations.length)} />
        {canSeeReports && (
          <Link href={`/reports`} className="contents">
            <Stat
              label="Reports"
              value={openReports > 0 ? `${reports.length} · ${openReports} open` : String(reports.length)}
              tone={openReports > 0 ? "text-brand" : undefined}
            />
          </Link>
        )}
      </div>

      {access.isSuper && !live && (
        <Card className="p-5 mb-8 gap-0">
          <div className="text-base font-semibold mb-3">Player info</div>
          <EditInfoForm
            userId={user.id}
            displayName={user.display_name}
            realName={user.real_name}
            email={user.email ?? ""}
          />
        </Card>
      )}

      <Card className="p-5 mb-8 gap-0">
        <div className="text-base font-semibold mb-3">Moderate</div>
        <div className="flex flex-col gap-3">
          {can("warn") && <WarnForm userId={user.id} />}
          {can("ban") && <BanForm userId={user.id} isBanned={!!activeBan} />}
          {can("ban") && activeBan && <LiftBanForm userId={user.id} />}
          {can("notify") && <NotifyForm userId={user.id} />}
          {can("ban") && <ResetPositionForm userId={user.id} />}
          {!can("warn") && !can("ban") && !can("notify") && (
            <div className="text-sm text-muted-foreground">
              You don&apos;t have any moderation permissions.
            </div>
          )}
        </div>
      </Card>

      {access.isSuper && (
        <Card className="p-5 mb-8 gap-0 border-rose-200 dark:border-rose-500/30">
          <div className="text-base font-semibold mb-3 text-rose-600 dark:text-rose-400">
            Danger zone
          </div>
          <DeleteAccountForm userId={user.id} />
        </Card>
      )}

      <Section title="Projects" count={projects.length}>
        <Card className="divide-y divide-border py-0">
          {projects.length === 0 && (
            <div className="p-4 text-muted-foreground text-sm">No projects yet.</div>
          )}
          {projects.map((p) => (
            <div key={p.id} className="p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Link href={`/projects/${p.id}`} className="font-semibold hover:text-brand">
                  {p.name}
                </Link>
                <StatusBadge status={p.status} />
                {p.status === "approved" && p.approved_hours != null && (
                  <Badge variant="warning">
                    {fmt(Number(p.approved_hours))} px
                  </Badge>
                )}
              </div>
              {p.description && (
                <div className="text-sm text-foreground/70 mt-1 break-words">{p.description}</div>
              )}
              <div className="text-xs text-muted-foreground mt-1 flex gap-3 flex-wrap">
                {p.repo_url && (
                  <a className="underline text-brand" href={p.repo_url} target="_blank" rel="noreferrer">
                    repo
                  </a>
                )}
                {p.demo_url && (
                  <a className="underline text-brand" href={p.demo_url} target="_blank" rel="noreferrer">
                    demo
                  </a>
                )}
                {p.hackatime_projects.length > 0 && (
                  <span>hackatime: {p.hackatime_projects.join(", ")}</span>
                )}
                <span>created {new Date(p.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </Card>
      </Section>

      {canSeeReports && (
      <Section title="Reports" count={reports.length}>
        <Card className="divide-y divide-border py-0">
          {reports.length === 0 && (
            <div className="p-4 text-muted-foreground text-sm">No reports filed against this player.</div>
          )}
          {reports.map((r) => (
            <div key={r.id} className="p-3">
              <div className="flex gap-3 items-baseline flex-wrap">
                <Badge variant={r.status === "open" ? "warning" : "outline"} className="capitalize">
                  {r.status}
                </Badge>
                <span className="text-sm flex-1 break-words min-w-0">
                  {r.reason || <span className="text-muted-foreground">no reason given</span>}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  by {r.reporter_name} · {new Date(r.created_at).toLocaleString()}
                </span>
              </div>
              {r.context.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none">
                    Chat context ({r.context.length})
                  </summary>
                  <div className="mt-2 rounded-lg border border-border bg-background/60 divide-y divide-border">
                    {r.context.map((c, i) => (
                      <div key={i} className="px-3 py-1.5 text-sm break-words">
                        <span
                          className={`font-medium ${
                            c.name === r.target_name ? "text-brand" : "text-foreground/70"
                          }`}
                        >
                          {c.name}
                        </span>
                        <span className="text-muted-foreground">: </span>
                        {c.text}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))}
        </Card>
      </Section>
      )}

      <Section title="Violations" count={violations.length}>
        <Card className="divide-y divide-border py-0">
          {violations.length === 0 && (
            <div className="p-4 text-muted-foreground text-sm">Clean record.</div>
          )}
          {violations.map((v) => (
            <div key={v.id} className="p-3 flex gap-3 items-baseline">
              <Badge variant="warning">{v.kind}</Badge>
              <span className="text-sm flex-1 break-words">{v.content}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {new Date(v.created_at).toLocaleString()}
              </span>
            </div>
          ))}
        </Card>
      </Section>

      <Section title="Bans" count={bans.length}>
        <Card className="divide-y divide-border py-0">
          {bans.length === 0 && <div className="p-4 text-muted-foreground text-sm">Never banned.</div>}
          {bans.map((b) => (
            <div key={b.id} className="p-3 text-sm flex gap-3 items-baseline flex-wrap">
              {banIsActive(b) ? (
                <Badge className="bg-rose-600 text-white">active</Badge>
              ) : (
                <Badge variant="secondary">{b.lifted_at ? "lifted" : "expired"}</Badge>
              )}
              <span className="flex-1">
                {b.reason || "(no reason)"} , by {b.banned_by || "?"}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(b.created_at).toLocaleString()}
                {b.expires_at ? ` → ${new Date(b.expires_at).toLocaleString()}` : " → forever"}
              </span>
            </div>
          ))}
        </Card>
      </Section>

      <Section title="Last known positions">
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="p-2 font-medium">Scene</TableHead>
                <TableHead className="p-2 font-medium">X</TableHead>
                <TableHead className="p-2 font-medium">Y</TableHead>
                <TableHead className="p-2 font-medium">Facing</TableHead>
                <TableHead className="p-2 font-medium">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {states.map((s) => (
                <TableRow key={s.scene} className="hover:bg-transparent">
                  <TableCell className="p-2 font-mono">{s.scene}</TableCell>
                  <TableCell className="p-2 tabular-nums">{Math.round(s.pos_x)}</TableCell>
                  <TableCell className="p-2 tabular-nums">{Math.round(s.pos_y)}</TableCell>
                  <TableCell className="p-2">{s.direction}</TableCell>
                  <TableCell className="p-2 text-muted-foreground">{new Date(s.updated_at).toLocaleString()}</TableCell>
                </TableRow>
              ))}
              {states.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="p-3 text-muted-foreground">
                    Never entered the world.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </Section>

      <Section title="Moderation log">
        <Card className="divide-y divide-border py-0">
          {actions.length === 0 && (
            <div className="p-4 text-muted-foreground text-sm">No moderation actions yet.</div>
          )}
          {actions.map((a) => (
            <div key={a.id} className="p-3 text-sm flex gap-3 items-baseline flex-wrap">
              <Badge variant="secondary">{a.action}</Badge>
              <span className="flex-1 break-words">{a.detail}</span>
              <span className="text-xs text-muted-foreground">
                {a.actor} · {new Date(a.created_at).toLocaleString()}
              </span>
            </div>
          ))}
        </Card>
      </Section>
    </div>
  );
}
