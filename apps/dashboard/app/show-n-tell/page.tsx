import { requirePagePerm } from "@/lib/guard";
import { listShowNTellRounds, listShowNTellEntries, searchShippableProjects } from "@/lib/db";
import {
  createShowNTellRound,
  openShowNTellRound,
  closeShowNTellRound,
  addShowNTellEntry,
  addCustomShowNTellEntry,
  removeShowNTellEntry,
} from "@/app/actions";
import { PendingButton } from "@/app/_components/PendingButton";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

function dateLabel(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default async function ShowNTellPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; round?: string }>;
}) {
  await requirePagePerm(["show_n_tell"]);
  const { q, round: roundParam } = await searchParams;

  const rounds = await listShowNTellRounds();
  const openRound = rounds.find((r) => r.is_open) ?? null;
  const selectedRoundId = Number(roundParam) || openRound?.id || rounds[0]?.id || 0;
  const selectedRound = rounds.find((r) => r.id === selectedRoundId) ?? null;

  const [entries, searchResults] = await Promise.all([
    selectedRound ? listShowNTellEntries(selectedRound.id) : Promise.resolve([]),
    q ? searchShippableProjects(q) : Promise.resolve([]),
  ]);
  const existingProjectIds = new Set(entries.map((e) => e.project_id));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Show &amp; Tell</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          One vote per player per project, players sign in for real so it's not a
          stuffable form. Open a round when a Show &amp; Tell is happening, add the
          projects being shown, close it when it wraps up.
        </p>
      </div>

      <Card className="p-5 md:p-6 gap-0">
        <div className="text-base font-semibold mb-4">New round</div>
        <form action={createShowNTellRound} className="flex gap-3 items-end flex-wrap">
          <Label className="block font-normal flex-1 min-w-48">
            <span className="block text-sm font-medium mb-1.5">Title</span>
            <Input name="title" required maxLength={120} placeholder="e.g. September Show & Tell" className="w-full text-sm" />
          </Label>
          <PendingButton className="bg-brand text-white border-transparent" pendingText="Creating…">
            Create round
          </PendingButton>
        </form>
      </Card>

      <div>
        <div className="text-sm font-medium text-muted-foreground mb-3">Rounds</div>
        <Card className="overflow-hidden py-0 divide-y divide-border">
          {rounds.map((r) => (
            <div key={r.id} className="p-3.5 flex items-center gap-3 flex-wrap">
              <a href={`/show-n-tell?round=${r.id}`} className={`font-medium hover:text-brand ${r.id === selectedRoundId ? "text-brand" : ""}`}>
                {r.title}
              </a>
              {r.is_open ? (
                <Badge variant="success">Open</Badge>
              ) : (
                <Badge variant="secondary">Closed</Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {r.is_open ? `opened ${dateLabel(r.opened_at)}` : r.closed_at ? `closed ${dateLabel(r.closed_at)}` : `created ${dateLabel(r.created_at)}`}
              </span>
              <div className="ml-auto flex gap-2">
                {r.is_open ? (
                  <form action={closeShowNTellRound}>
                    <input type="hidden" name="id" value={r.id} />
                    <PendingButton variant="outline" size="sm" pendingText="Closing…">
                      Close
                    </PendingButton>
                  </form>
                ) : (
                  <form action={openShowNTellRound}>
                    <input type="hidden" name="id" value={r.id} />
                    <PendingButton size="sm" pendingText="Opening…" className="bg-mint text-ink border-transparent hover:bg-mint/90">
                      Open
                    </PendingButton>
                  </form>
                )}
              </div>
            </div>
          ))}
          {rounds.length === 0 && (
            <div className="p-5 text-muted-foreground text-sm">No rounds yet, create one above.</div>
          )}
        </Card>
      </div>

      {selectedRound && (
        <div>
          <div className="text-sm font-medium text-muted-foreground mb-3">
            Entries in &ldquo;{selectedRound.title}&rdquo;
          </div>

          <Card className="p-5 md:p-6 gap-0 mb-4">
            <div className="text-sm font-medium mb-3">Add a project</div>
            <form className="flex gap-2 mb-3">
              <input type="hidden" name="round" value={selectedRound.id} />
              <Input name="q" defaultValue={q ?? ""} placeholder="Search projects by name (shipped or still in progress)…" className="text-sm flex-1" />
              <PendingButton type="submit">Search</PendingButton>
            </form>
            {q && (
              <div className="space-y-2">
                {searchResults.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 text-sm p-2 rounded-md border border-border">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground text-xs">{p.owner}</span>
                    {existingProjectIds.has(p.id) ? (
                      <Badge variant="secondary" className="ml-auto">Already added</Badge>
                    ) : (
                      <form action={addShowNTellEntry} className="ml-auto">
                        <input type="hidden" name="roundId" value={selectedRound.id} />
                        <input type="hidden" name="projectId" value={p.id} />
                        <PendingButton size="sm" pendingText="Adding…">Add</PendingButton>
                      </form>
                    )}
                  </div>
                ))}
                {searchResults.length === 0 && (
                  <div className="text-sm text-muted-foreground">No projects match that search.</div>
                )}
              </div>
            )}
            <div className="mt-4 pt-4 border-t border-border">
              <div className="text-xs font-medium text-muted-foreground mb-2">
                Not in Pixl? Add it by name instead (no project record needed)
              </div>
              <form action={addCustomShowNTellEntry} className="flex gap-2">
                <input type="hidden" name="roundId" value={selectedRound.id} />
                <Input name="customName" required maxLength={120} placeholder="e.g. a live demo shown at the event" className="text-sm flex-1" />
                <PendingButton type="submit" pendingText="Adding…">Add</PendingButton>
              </form>
            </div>
          </Card>

          <Card className="overflow-hidden py-0 divide-y divide-border">
            {entries
              .slice()
              .sort((a, b) => b.vote_count - a.vote_count)
              .map((e) => (
                <div key={e.id} className="p-3.5 flex items-center gap-3 flex-wrap">
                  <span className="font-medium">{e.project_name}</span>
                  <span className="text-xs text-muted-foreground">{e.project_owner}</span>
                  <Badge variant="secondary">{e.vote_count} vote{e.vote_count === 1 ? "" : "s"}</Badge>
                  <span className="text-xs text-muted-foreground ml-auto">added by {e.added_by}</span>
                  <form action={removeShowNTellEntry}>
                    <input type="hidden" name="id" value={e.id} />
                    <PendingButton
                      variant="ghost"
                      size="sm"
                      pendingText="Removing…"
                      className="text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                    >
                      Remove
                    </PendingButton>
                  </form>
                  {e.voters.length > 0 && (
                    <details className="w-full mt-1">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none">
                        {e.voters.length} voter{e.voters.length === 1 ? "" : "s"}
                      </summary>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {e.voters.map((v) => (
                          <Badge key={v.id} variant="outline" className="text-xs font-normal">
                            {v.name || v.id.slice(0, 8)}
                            <span className="text-muted-foreground ml-1">
                              {new Date(v.voted_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                            </span>
                          </Badge>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            {entries.length === 0 && (
              <div className="p-5 text-muted-foreground text-sm">No entries yet, search above to add one.</div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
