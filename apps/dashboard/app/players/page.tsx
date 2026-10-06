import Link from "next/link";
import { requirePagePerm } from "@/lib/guard";
import { getLiveMode } from "@/lib/liveModeServer";
import { liveName } from "@/lib/liveMode";
import { listPlayers } from "@/lib/db";
import { slackHandles } from "@/lib/slack";
import { massPlayerAction, syncSlackAvatars } from "@/app/actions";
import { SelectAllBox, RowSelect } from "@/app/_components/MassSelect";
import { PendingButton } from "@/app/_components/PendingButton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; done?: string; error?: string }>;
}) {
  const access = await requirePagePerm(["warn", "ban"]);
  const live = await getLiveMode();
  const { q, page, done, error } = await searchParams;
  const all = await listPlayers(q);

  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / PER));
  const cur = Math.min(Math.max(parseInt(page ?? "1", 10) || 1, 1), pages);
  const start = (cur - 1) * PER;
  const players = all.slice(start, start + PER);
  const handles = await slackHandles(players.map((p) => p.slack_id));
  const qp = (n: number) =>
    `/players?page=${n}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  const canWarn = access.perms.has("warn");
  const canNotify = access.perms.has("notify");
  const canBan = access.perms.has("ban");
  const defaultAction = canWarn ? "warn" : canNotify ? "notify" : "ban";

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-6">Players</h1>

      {done && (
        <Alert className="mb-4">
          <AlertDescription className="font-medium text-emerald-600 dark:text-emerald-400">{done}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="font-medium text-destructive">{error}</AlertDescription>
        </Alert>
      )}

      <div className="mb-5 flex gap-2 items-center flex-wrap">
        <form className="flex gap-2 flex-1 min-w-64">
          <Input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search display names…"
            className="flex-1 min-w-0 max-w-72"
          />
          <Button type="submit">Search</Button>
        </form>
        {access.isSuper && (
          <form action={syncSlackAvatars}>
            <PendingButton variant="outline" pendingText="Syncing…">
              Sync Slack photos
            </PendingButton>
          </form>
        )}
      </div>

      <form action={massPlayerAction}>
        <input type="hidden" name="back" value={qp(cur)} />

        <Card className="p-4 mb-4 gap-0">
          <div className="text-sm font-semibold mb-3">
            Mass action , tick players below, then apply to all of them at once
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="block">
              <Label className="block text-xs font-medium text-muted-foreground mb-1">Action</Label>
              <Select name="massAction" defaultValue={defaultAction}>
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {canWarn && <SelectItem value="warn">Warn</SelectItem>}
                  {canNotify && <SelectItem value="notify">Notify</SelectItem>}
                  {canBan && <SelectItem value="ban">Ban</SelectItem>}
                  {canBan && <SelectItem value="unban">Lift bans</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="block flex-1 min-w-56">
              <Label className="block text-xs font-medium text-muted-foreground mb-1">
                Message / reason (required for ban &amp; notify)
              </Label>
              <Input
                name="message"
                maxLength={1000}
                placeholder="Sent to every selected player"
                className="w-full text-sm"
              />
            </div>
            <div className="block w-44">
              <Label className="block text-xs font-medium text-muted-foreground mb-1">Title (notify only)</Label>
              <Input
                name="title"
                maxLength={100}
                placeholder="Message from the Pixl team"
                className="w-full text-sm"
              />
            </div>
            <div className="block w-32">
              <Label className="block text-xs font-medium text-muted-foreground mb-1">Ban hours (blank = permanent)</Label>
              <Input
                name="hours"
                type="number"
                min={0}
                placeholder="∞"
                className="w-full text-sm"
              />
            </div>
            <PendingButton
              className="bg-brand text-white border-transparent"
              pendingText="Applying…"
              confirm="Apply this action to every selected player?"
            >
              Apply to selected
            </PendingButton>
          </div>
        </Card>

        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="p-3 w-8">
                  <SelectAllBox />
                </TableHead>
                <TableHead className="p-3">Player</TableHead>
                <TableHead className="p-3">Projects</TableHead>
                <TableHead className="p-3">Violations</TableHead>
                <TableHead className="p-3">Status</TableHead>
                <TableHead className="p-3">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {players.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="p-3">
                    <RowSelect id={p.id} label={`Select ${liveName(live, p, p.real_name || p.display_name || p.id)}`} />
                  </TableCell>
                  <TableCell className="p-3">
                    <Link href={`/players/${p.id}`} className="font-bold hover:text-brand">
                      {liveName(live, p, p.real_name || (p.slack_id && handles.get(p.slack_id)) || p.display_name || "Unknown")}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {p.slack_id ?? "no slack id"} · {p.oauth_provider}
                    </div>
                  </TableCell>
                  <TableCell className="p-3">{p.projectCount}</TableCell>
                  <TableCell className={`p-3 ${p.violationCount > 0 ? "text-tang font-bold" : ""}`}>
                    {p.violationCount}
                  </TableCell>
                  <TableCell className="p-3">
                    {p.activeBan ? (
                      <Badge className="bg-brand text-white">banned</Badge>
                    ) : (
                      <Badge variant="success">ok</Badge>
                    )}
                  </TableCell>
                  <TableCell className="p-3 text-muted-foreground">
                    {new Date(p.created_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
              {players.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell className="p-5 text-muted-foreground" colSpan={6}>
                    No players found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </form>

      {total > 0 && (
        <div className="flex items-center justify-between gap-3 mt-4 text-sm">
          <span className="text-muted-foreground">
            Showing {start + 1}–{Math.min(start + PER, total)} of {total}
          </span>
          <Pagination className="mx-0 w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationLink
                  href={qp(cur - 1)}
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
                  href={qp(cur + 1)}
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
