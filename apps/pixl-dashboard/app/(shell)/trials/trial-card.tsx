import { bbstrip } from "@/components/markdown";
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

// The gold banner at the top of the Trials and Quest log pages.
export const trialsHero = cn(
  "mt-[8px] flex flex-wrap items-end gap-[20px] px-[28px] py-[26px]",
  "border-4 border-stroke bg-gold text-ink shadow-drop-lg",
);

// Positions of the four stat boxes baked into ticket_frame_trials.png.
const STAT_POS = {
  level: "left-[232.3px] top-[177.2px] h-[69.2px] w-[83.9px]",
  hours: "left-[334.6px] top-[178px] h-[68.4px] w-[84.6px]",
  proj: "left-[232.3px] top-[263.3px] h-[69.2px] w-[83.9px]",
  joined: "left-[334.6px] top-[263.3px] h-[69.2px] w-[84.6px]",
};

// Trial raffle-ticket frame. Explore keeps the original player-card frame.
export function TrialCard({ q }: { q: TrialQuest }) {
  const giver = (q.npc_name || q.npc || "").trim();
  const letter = giver.charAt(0).toUpperCase() || "?";
  const status = q.completed ? "DONE" : q.unlocked ? "UNLOCKED" : "LOCKED";
  // The brief is Godot BBCode authored for the game; shown as plain text.
  const brief = q.unlocked
    ? bbstrip(q.brief || q.description || "No brief written for this trial yet.")
    : "Find the right villager in the world to unlock this trial's story.";

  return (
    <div className="relative h-[599px] w-[460px] shrink-0 animate-toast-in bg-[url(/img/ticket_frame_trials.png)] bg-size-[460px_599px] bg-no-repeat">
      <div className="absolute top-[57.6px] left-[28px] flex h-[77.4px] w-[278px] items-center overflow-hidden">
        <div className="truncate font-pixel text-[23px] tracking-[.5px] text-white [text-shadow:1.5px_0_var(--stroke),-1.5px_0_var(--stroke),0_1.5px_var(--stroke),0_-1.5px_var(--stroke)]">
          {q.name}
        </div>
      </div>
      <div
        className={cn(
          "absolute top-[177px] left-[49.5px] flex h-[150px] w-[148.5px] items-center justify-center overflow-hidden",
          "font-pixel text-[56px] text-ink",
          !q.unlocked && "brightness-[.55] grayscale",
        )}
      >
        {letter}
      </div>
      <Stat pos={STAT_POS.level} label="REGION" value={q.region || "-"} />
      <Stat pos={STAT_POS.hours} label="MIN HRS" value={q.min_hours ? `${q.min_hours}h` : "-"} />
      <Stat pos={STAT_POS.proj} label="GIVEN BY" value={giver || "-"} />
      <Stat pos={STAT_POS.joined} label="STATUS" value={status} />
      {/* The baked art has "EXPERIENCE" + an empty XP-track box here (it's the
          player card's XP bar), nothing about a Trial belongs on top of that
          label, so patch it over with paper before laying the brief text down. */}
      <div className="absolute top-[348px] left-[34px] h-[152px] w-[392px] border-2 border-panel-2 bg-panel" />
      <div
        className={cn(
          "absolute top-[356px] left-[39.3px] h-[136px] w-[381.5px] overflow-x-hidden overflow-y-auto",
          "text-[12.5px] leading-[1.55] [overflow-wrap:anywhere] whitespace-pre-line text-ink",
          "[scrollbar-color:var(--muted)_transparent] [scrollbar-width:thin]",
          !q.unlocked && "text-muted italic",
        )}
      >
        {brief}
      </div>
      <div className="absolute top-[508.3px] left-[39.3px] flex h-[46.8px] w-[384px] flex-col justify-center gap-[4px] overflow-hidden pl-[14px]">
        <div className="truncate font-pixel text-[17px] leading-[1.15] text-ink">{q.reward || "No reward listed"}</div>
        <div className="text-[11px] leading-none tracking-[.3px] text-faint">REWARD ON COMPLETION</div>
      </div>
    </div>
  );
}

function Stat({ pos, label, value }: { pos: string; label: string; value: string }) {
  return (
    <div
      className={cn(
        "absolute flex flex-col items-center justify-center gap-[3px] overflow-hidden px-[4px] text-center",
        pos,
      )}
    >
      <span className="text-[9px] tracking-[.5px] text-dim">{label}</span>
      <span className="max-w-full truncate font-pixel text-[16px] text-ink">{value}</span>
    </div>
  );
}
