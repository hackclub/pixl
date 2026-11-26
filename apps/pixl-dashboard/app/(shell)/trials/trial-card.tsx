import { bbstrip } from "@/components/markdown";
import { Badge, panel } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

export interface TrialQuest {
  id: number | string;
  name: string;
  npc?: string | null;
  npc_name?: string | null;
  region?: string | null;
  min_hours?: number | null;
  brief?: string | null;
  description?: string | null;
  reward?: string | null;
  unlocked?: boolean;
  completed?: boolean;
}

// Grid for a page of TrialCards.
export const trialsGrid = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,440px),1fr))] gap-[20px]";

// A Trial as a plain panel, readable in both themes (the old raffle-ticket
// art had no dark variant).
export function TrialCard({ q, className }: { q: TrialQuest; className?: string }) {
  const giver = (q.npc_name || q.npc || "").trim();
  const letter = giver.charAt(0).toUpperCase() || "?";
  // The brief is Godot BBCode authored for the game; shown as plain text.
  const brief = q.unlocked
    ? bbstrip(q.brief || q.description || "No brief written for this trial yet.")
    : "Find the right villager in the world to unlock this trial's story.";

  return (
    <div className={cn(panel, "flex animate-toast-in flex-col gap-[16px] p-[22px]", className)}>
      <div className="flex items-center gap-[16px]">
        <div
          className={cn(
            "flex size-[72px] shrink-0 items-center justify-center border-2 border-stroke bg-panel-2",
            "font-pixel text-[36px] text-ink",
            !q.unlocked && "opacity-50",
          )}
        >
          {letter}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-pixel text-[22px] leading-[1.2] break-words text-ink">{q.name}</div>
          <div className="mt-[4px] text-[13.5px] text-faint">from {giver || "an unknown villager"}</div>
        </div>
        <Badge tone={q.completed ? "green" : q.unlocked ? "gold" : "default"} className="shrink-0">
          {q.completed ? "DONE" : q.unlocked ? "UNLOCKED" : "LOCKED"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-[10px]">
        <Stat label="REGION" value={q.region || "-"} />
        <Stat label="MIN HOURS" value={q.min_hours ? `${q.min_hours}h` : "-"} />
      </div>

      <div
        className={cn(
          "max-h-[220px] overflow-y-auto border-2 border-stroke bg-panel-deep px-[14px] py-[12px]",
          "text-[14.5px] leading-[1.6] [overflow-wrap:anywhere] whitespace-pre-line text-dim",
          !q.unlocked && "italic",
        )}
      >
        {brief}
      </div>

      <div className="mt-auto border-t-2 border-stroke pt-[14px]">
        <div className="text-[11px] tracking-[1px] text-faint">REWARD ON COMPLETION</div>
        <div className="mt-[4px] font-pixel text-[18px] break-words text-gold">{q.reward || "No reward listed"}</div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-2 border-stroke bg-panel-2 px-[12px] py-[8px]">
      <div className="text-[11px] tracking-[1px] text-faint">{label}</div>
      <div className="mt-[2px] truncate font-pixel text-[17px] text-ink">{value}</div>
    </div>
  );
}
