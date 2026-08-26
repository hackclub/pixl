import { redirect } from "next/navigation";
import { requirePagePerm } from "@/lib/guard";
import { listVaultLevels, type VaultLevelRow } from "@/lib/db";
import {
  addVaultLevel,
  updateVaultLevel,
  toggleVaultLevel,
  deleteVaultLevel,
} from "@/app/actions";
import { PendingButton } from "@/app/_components/PendingButton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const dynamic = "force-dynamic";

function rewardsText(level: VaultLevelRow): string {
  return (level.rewards ?? []).map((r) => `${r.icon ?? "🎁"} ${r.label ?? ""}`.trim()).join("\n");
}

const REWARDS_HINT = "One per line, emoji first , e.g. 🦊 Pixel fox pet";

export default async function CommunityGoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const access = await requirePagePerm(["goals"]);
  const { error, saved } = await searchParams;
  const levels = await listVaultLevels();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Community Goals</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          The Core Vault levels. The whole community&apos;s Restoration Energy (approved hours)
          unlocks each level for everyone once it crosses that energy threshold. Rewards are
          shown in-game as the equipment the Core recovers.
        </p>
      </div>

      {saved && (
        <Alert>
          <AlertDescription className="font-medium text-emerald-600 dark:text-emerald-400">
            Saved.
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="font-medium text-destructive">{error}</AlertDescription>
        </Alert>
      )}

      <Card className="p-5 md:p-6 gap-0">
        <div className="text-base font-semibold mb-4">Add a vault level</div>
        <form action={addVaultLevel} className="space-y-4">
          <div className="grid sm:grid-cols-4 gap-4">
            <Label className="block font-normal">
              <span className="block text-sm font-medium mb-1.5">Level #</span>
              <Input name="level" type="number" min={1} required placeholder="6" className="w-full text-sm" />
            </Label>
            <Label className="block font-normal">
              <span className="block text-sm font-medium mb-1.5">Energy required</span>
              <Input name="energy_required" type="number" min={0} required placeholder="8000" className="w-full text-sm" />
            </Label>
            <Label className="block font-normal sm:col-span-2">
              <span className="block text-sm font-medium mb-1.5">Title</span>
              <Input name="title" required maxLength={80} placeholder="The Deep Archive" className="w-full text-sm" />
            </Label>
          </div>
          <Label className="block font-normal">
            <span className="block text-sm font-medium mb-1.5">Blurb (shown in-game)</span>
            <Input name="blurb" maxLength={400} placeholder="A sealed vault of pre-Crash secrets reopens." className="w-full text-sm" />
          </Label>
          <div className="grid sm:grid-cols-[1fr_auto] gap-4 items-start">
            <Label className="block font-normal">
              <span className="block text-sm font-medium mb-1.5">Rewards</span>
              <Textarea name="rewards" rows={3} placeholder={REWARDS_HINT} className="w-full text-sm" />
              <span className="block text-xs text-muted-foreground mt-1">{REWARDS_HINT}</span>
            </Label>
            <Label className="block font-normal">
              <span className="block text-sm font-medium mb-1.5">Sort position</span>
              <Input name="position" type="number" placeholder="6" className="w-full text-sm sm:w-28" />
            </Label>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <Label className="block font-normal">
              <span className="block text-sm font-medium mb-1.5">Top 1 chapter RE bonus</span>
              <Input name="top1_re" type="number" min={0} placeholder="200" className="w-full text-sm" />
            </Label>
            <Label className="block font-normal">
              <span className="block text-sm font-medium mb-1.5">Top 2 chapter RE bonus</span>
              <Input name="top2_re" type="number" min={0} placeholder="100" className="w-full text-sm" />
            </Label>
            <Label className="block font-normal">
              <span className="block text-sm font-medium mb-1.5">Top 3 chapter RE bonus</span>
              <Input name="top3_re" type="number" min={0} placeholder="50" className="w-full text-sm" />
            </Label>
          </div>
          <span className="block text-xs text-muted-foreground -mt-2">
            Paid once, automatically, to whoever contributed the most RE this chapter when this level unlocks. Leave at 0 for no leaderboard prize.
          </span>
          <PendingButton className="bg-brand text-white border-transparent" pendingText="Adding…">
            Add level
          </PendingButton>
        </form>
      </Card>

      <div className="space-y-4">
        {levels.map((l) => (
          <Card key={l.id} className={`p-4 md:p-5 gap-0 ${l.active ? "" : "opacity-60"}`}>
            <form action={updateVaultLevel} className="space-y-3">
              <input type="hidden" name="id" value={l.id} />
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <Badge variant="secondary">LV {l.level}</Badge>
                <span className="font-bold">{l.title}</span>
                <Badge variant="warning">⚡ {l.energy_required.toLocaleString()}</Badge>
                {!l.active && <Badge variant="secondary">hidden</Badge>}
                <div className="ml-auto flex items-center gap-2">
                  <PendingButton variant="outline" size="sm" pendingText="Saving…">
                    Save
                  </PendingButton>
                </div>
              </div>
              <div className="grid sm:grid-cols-4 gap-3">
                <Label className="block font-normal">
                  <span className="block text-xs font-medium mb-1 text-muted-foreground">Level #</span>
                  <Input name="level" type="number" defaultValue={l.level} className="w-full text-sm" />
                </Label>
                <Label className="block font-normal">
                  <span className="block text-xs font-medium mb-1 text-muted-foreground">Energy</span>
                  <Input name="energy_required" type="number" defaultValue={l.energy_required} className="w-full text-sm" />
                </Label>
                <Label className="block font-normal sm:col-span-2">
                  <span className="block text-xs font-medium mb-1 text-muted-foreground">Title</span>
                  <Input name="title" defaultValue={l.title} maxLength={80} className="w-full text-sm" />
                </Label>
              </div>
              <Label className="block font-normal">
                <span className="block text-xs font-medium mb-1 text-muted-foreground">Blurb</span>
                <Input name="blurb" defaultValue={l.blurb} maxLength={400} className="w-full text-sm" />
              </Label>
              <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-start">
                <Label className="block font-normal">
                  <span className="block text-xs font-medium mb-1 text-muted-foreground">Rewards</span>
                  <Textarea name="rewards" rows={3} defaultValue={rewardsText(l)} className="w-full text-sm" />
                </Label>
                <Label className="block font-normal">
                  <span className="block text-xs font-medium mb-1 text-muted-foreground">Position</span>
                  <Input name="position" type="number" defaultValue={l.position} className="w-full text-sm sm:w-24" />
                </Label>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <Label className="block font-normal">
                  <span className="block text-xs font-medium mb-1 text-muted-foreground">Top 1 chapter RE bonus</span>
                  <Input name="top1_re" type="number" min={0} defaultValue={l.top1_re ?? 0} className="w-full text-sm" />
                </Label>
                <Label className="block font-normal">
                  <span className="block text-xs font-medium mb-1 text-muted-foreground">Top 2 chapter RE bonus</span>
                  <Input name="top2_re" type="number" min={0} defaultValue={l.top2_re ?? 0} className="w-full text-sm" />
                </Label>
                <Label className="block font-normal">
                  <span className="block text-xs font-medium mb-1 text-muted-foreground">Top 3 chapter RE bonus</span>
                  <Input name="top3_re" type="number" min={0} defaultValue={l.top3_re ?? 0} className="w-full text-sm" />
                </Label>
              </div>
              {l.unlocked_at && (
                <div className="text-xs text-muted-foreground">
                  Chapter closed {new Date(l.unlocked_at).toLocaleDateString()} , its leaderboard prize is already settled and won&apos;t change if you edit the numbers above.
                </div>
              )}
            </form>
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
              <form action={toggleVaultLevel}>
                <input type="hidden" name="id" value={l.id} />
                <input type="hidden" name="active" value={l.active ? "0" : "1"} />
                <PendingButton
                  variant="outline"
                  size="sm"
                  pendingText={l.active ? "Hiding…" : "Showing…"}
                >
                  {l.active ? "Hide" : "Show"}
                </PendingButton>
              </form>
              <form action={deleteVaultLevel}>
                <input type="hidden" name="id" value={l.id} />
                <PendingButton
                  variant="outline"
                  size="sm"
                  pendingText="Deleting…"
                  confirm={`Delete level ${l.level} "${l.title}"? This can't be undone.`}
                  className="text-rose-600 border-rose-200 dark:border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-600"
                >
                  Delete
                </PendingButton>
              </form>
            </div>
          </Card>
        ))}
        {levels.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground text-sm">
            No vault levels yet. Add the first community goal above.
          </Card>
        )}
      </div>
    </div>
  );
}
