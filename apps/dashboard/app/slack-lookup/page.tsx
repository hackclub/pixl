import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePagePerm } from "@/lib/guard";
import { getLiveMode } from "@/lib/liveModeServer";
import { LiveBlocked } from "@/app/_components/LiveBlocked";
import { getPlayerBySlackId, playerLabel, searchPlayerHandles } from "@/lib/db";
import { getSlackUserProfile } from "@/lib/slack";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm mt-0.5 break-words">{value}</div>
    </div>
  );
}

export default async function SlackLookupPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; name?: string }>;
}) {
  const access = await requirePagePerm(["lookup"]);
  if (await getLiveMode()) return <LiveBlocked what="Slack lookup" />;
  const { q, name } = await searchParams;
  const query = q?.trim() ?? "";
  const nameQuery = name?.trim() ?? "";

  const [profile, matches] = await Promise.all([
    query ? getSlackUserProfile(query) : null,
    nameQuery ? searchPlayerHandles(nameQuery) : Promise.resolve([]),
  ]);
  const player = profile && !profile.deleted ? await getPlayerBySlackId(profile.id) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Slack lookup</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Paste a Slack user ID (the <code>U0…</code> id, not an @handle) to pull everything Slack
          will hand back about that account.
        </p>
      </div>

      <Card className="p-5 md:p-6 gap-4">
        <form className="flex gap-2 flex-wrap">
          <Input
            name="q"
            defaultValue={query}
            placeholder="Slack user ID (U0…)"
            className="flex-1 min-w-64 font-mono text-sm"
          />
          <Button type="submit">Look up</Button>
        </form>

        {query && !profile && (
          <Alert variant="destructive">
            <AlertDescription>
              Couldn&apos;t find a Slack user for <code>{query}</code>. Double-check the ID , this
              needs the exact <code>U0…</code> id, not a display name.
            </AlertDescription>
          </Alert>
        )}
      </Card>

      <Card className="p-5 md:p-6 gap-3">
        <div className="text-sm font-semibold">Or find a player by name</div>
        <form className="flex gap-2 flex-wrap">
          <Input
            name="name"
            defaultValue={nameQuery}
            placeholder="Search Pixl display or real name…"
            className="flex-1 min-w-64 text-sm"
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>

        {nameQuery && matches.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No Pixl players with a linked Slack account match &quot;{nameQuery}&quot;.
          </p>
        )}

        {matches.length > 0 && (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border overflow-hidden">
            {matches.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/slack-lookup?q=${encodeURIComponent(m.slack_id ?? "")}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                >
                  <span className="truncate">{playerLabel(m)}</span>
                  <span className="font-mono text-xs text-muted-foreground shrink-0">
                    {m.slack_id}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {profile && (
        <Card className="p-5 md:p-6 gap-5">
          <div className="flex items-start gap-4 flex-wrap">
            {profile.image512 && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.image512}
                alt=""
                className="w-20 h-20 rounded-xl border border-border shrink-0"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-lg font-semibold">
                  {profile.displayName || profile.realName || profile.name}
                </div>
                {profile.deleted && <Badge variant="destructive">Deactivated</Badge>}
                {profile.isPrimaryOwner && <Badge variant="warning">Primary owner</Badge>}
                {!profile.isPrimaryOwner && profile.isOwner && <Badge variant="warning">Owner</Badge>}
                {profile.isAdmin && !profile.isOwner && <Badge variant="info">Admin</Badge>}
                {profile.isBot && <Badge variant="secondary">Bot</Badge>}
                {profile.isUltraRestricted && <Badge variant="outline">Single-channel guest</Badge>}
                {!profile.isUltraRestricted && profile.isRestricted && (
                  <Badge variant="outline">Multi-channel guest</Badge>
                )}
              </div>
              {profile.realName && profile.realName !== profile.displayName && (
                <div className="text-sm text-muted-foreground">{profile.realName}</div>
              )}
              {(profile.statusEmoji || profile.statusText) && (
                <div className="text-sm mt-1">
                  {profile.statusEmoji ? `${profile.statusEmoji} ` : ""}
                  {profile.statusText}
                </div>
              )}
              <a
                href={`https://hackclub.slack.com/team/${profile.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-brand underline inline-block mt-2"
              >
                Open in Slack
              </a>
              {player && (
                <Link
                  href={`/players/${player.id}`}
                  className="text-xs text-brand underline inline-block mt-2 ml-3"
                >
                  View Pixl profile: {playerLabel(player)}
                </Link>
              )}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2 border-t border-border">
            <Field label="Slack ID" value={<span className="font-mono">{profile.id}</span>} />
            <Field label="Username" value={profile.name ? `@${profile.name}` : null} />
            <Field label="Team ID" value={<span className="font-mono">{profile.teamId}</span>} />
            <Field label="Email" value={profile.email} />
            <Field label="Phone" value={profile.phone} />
            <Field label="Title" value={profile.title} />
            <Field label="Skype" value={profile.skype} />
            <Field
              label="Timezone"
              value={
                profile.timezone
                  ? `${profile.timezoneLabel ? profile.timezoneLabel + " · " : ""}${profile.timezone}`
                  : null
              }
            />
            <Field
              label="Profile last updated"
              value={profile.updated ? new Date(profile.updated * 1000).toLocaleString() : null}
            />
          </div>

          {!process.env.SLACK_BOT_TOKEN?.length && (
            <Alert>
              <AlertDescription>SLACK_BOT_TOKEN is not set.</AlertDescription>
            </Alert>
          )}
          {!profile.email && (
            <p className="text-xs text-muted-foreground">
              No email shown , the dashboard&apos;s Slack app doesn&apos;t have the{" "}
              <code>users:read.email</code> scope.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
