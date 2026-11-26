"use client";

// The fixed bar along the top of the dashboard and the docs: the player's
// currency chips (only when signed in) and the font/theme controls. Starts
// right of the sidebar, whose width both pages set as --sidebar.
import { ReIcon } from "@/components/pixel-icon";
import { DisplayControls } from "@/components/display-controls";
import { cn } from "@/lib/cn";

export interface RailStats {
  pixels: number;
  re: number;
  communityRe: number;
}

const chip = cn(
  "flex cursor-default items-center gap-[8px] border-2 border-stroke bg-panel py-[5px] pr-[11px] pl-[6px]",
  "text-[13px] tabular-nums",
);
const chipSlot = "flex size-[24px] shrink-0 items-center justify-center border-2 border-stroke";
const chipValue = "font-sans text-[16px] font-bold tracking-[.2px] text-ink tabular-nums";
const chipLabel = "text-[11px] tracking-[.5px] text-dim";

export function TopRail({ stats, className }: { stats?: RailStats | null; className?: string }) {
  return (
    <div
      data-top-rail
      className={cn(
        "fixed top-0 right-0 left-(--sidebar) z-[39] flex h-[54px] items-center justify-end gap-[10px] px-[20px]",
        "border-b-4 border-stroke bg-panel-deep max-[900px]:left-0",
        className,
      )}
    >
      {stats ? (
        <>
          <div
            className={cn(chip, "max-[560px]:hidden")}
            title="Core Integrity: total Restoration Energy earned by the whole community"
          >
            <span className={cn(chipSlot, "bg-teal [&_svg]:size-[15px]")}>
              <ReIcon />
            </span>
            <span className={chipValue}>{stats.communityRe.toLocaleString()}</span>
            <span className={chipLabel}>CORE</span>
          </div>
          <div className={chip} title="Your Restoration Energy">
            <span className={cn(chipSlot, "bg-accent text-btn-ink [&_svg]:size-[15px]")}>
              <ReIcon />
            </span>
            <span className={chipValue}>{stats.re.toLocaleString()}</span>
            <span className={cn(chipLabel, "max-[560px]:hidden")}>RE</span>
          </div>
          <div className={chip} title="Your pixels">
            <span className={cn(chipSlot, "bg-gold")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="size-[16px]" src="/img/pixel.png" alt="px" />
            </span>
            <span className={chipValue}>{stats.pixels.toLocaleString()}</span>
          </div>
        </>
      ) : null}
      <DisplayControls />
    </div>
  );
}
