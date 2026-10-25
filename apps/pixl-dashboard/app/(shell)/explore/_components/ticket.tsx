// The raffle-ticket player card from the old profile view. Every number is
// what apps/server returned (level, RE, approved hours, pixels); the XP fill
// bar from the old page is left out because it needed the level-band
// formula client side.
import { cn } from "@/lib/cn";
import { classForLevel, joinedYear } from "../lib";
import type { PlayerProfile } from "../types";
import { Avatar } from "./avatar";

const fmt = (n: unknown) => Math.round(Number(n) || 0).toLocaleString("en-US");

export function Ticket({ p, projectCount }: { p: PlayerProfile["player"]; projectCount: number }) {
  const year = joinedYear(p.created_at);
  return (
    <div className="relative my-[13px] h-[599px] w-[460px] bg-[url(/img/ticket_frame_trials.png)] bg-[length:460px_599px] bg-no-repeat max-[520px]:[zoom:.68]">
      <div className="absolute top-[57.6px] left-7 flex h-[77.4px] w-[278px] items-center overflow-hidden">
        <span
          className={cn(
            "truncate font-pixel text-[25px] tracking-[.5px] text-white",
            "[text-shadow:1.5px_0_var(--stroke),-1.5px_0_var(--stroke),0_1.5px_var(--stroke),0_-1.5px_var(--stroke)]",
          )}
        >{p.display_name}</span>
      </div>
      <div className="absolute top-[177px] left-[49.5px] h-[150px] w-[148.5px] overflow-hidden">
        <Avatar name={p.display_name} url={p.avatar_url} className="size-full border-0 text-[60px]" />
      </div>
      <Stat cls="top-[177.2px] left-[232.3px] h-[69.2px] w-[83.9px]" label="LEVEL" value={String(p.level ?? 1)} />
      <Stat cls="top-[178px] left-[334.6px] h-[68.4px] w-[84.6px]" label="HOURS" value={`${Number(p.xp_hours || 0).toFixed(0)}h`} />
      <Stat cls="top-[263.3px] left-[232.3px] h-[69.2px] w-[83.9px]" label="PROJECTS" value={String(projectCount)} />
      <Stat cls="top-[263.3px] left-[334.6px] h-[69.2px] w-[84.6px]" label="JOINED" value={year} />
      <div className="absolute top-[434px] left-[39.3px] flex w-[381.5px] flex-col gap-1.5">
        <div className={currencyRow}>× {fmt(p.re)} RE</div>
        <div className={currencyRow}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/img/pixel_currency.png" alt="" className="size-6 shrink-0 [image-rendering:pixelated]" />
          {fmt(p.pixels)}
        </div>
      </div>
      <div className="absolute top-[508.3px] left-[39.3px] box-border flex h-[46.8px] w-96 flex-col justify-center gap-[5px] pl-3.5">
        <div className="font-pixel text-[19px] leading-none text-ink">CLASS: {classForLevel(p.level)}</div>
        <div className="text-xs leading-none tracking-[.3px] text-faint">PIXELIAN · MEMBER SINCE {year}</div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={cn(sticker, "right-[42px] bottom-3.5 z-[2] w-[46px] -rotate-16")} src="/img/sticker_currency_red.png" alt="" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={cn(sticker, "right-1 -bottom-3 z-[3] w-[54px] rotate-12")} src="/img/sticker_currency_gold.png" alt="" />
    </div>
  );
}

const currencyRow = "flex items-center gap-[7px] font-pixel text-base text-ink";
const sticker = "pointer-events-none absolute select-none [image-rendering:pixelated]";

function Stat({ cls, label, value }: { cls: string; label: string; value: string }) {
  return (
    <div className={cn("absolute flex flex-col items-center justify-center gap-[3px] overflow-hidden text-center", cls)}>
      <span className="text-[9px] tracking-[.5px] text-dim">{label}</span>
      <span className="font-pixel text-[19px] text-ink">{value}</span>
    </div>
  );
}
