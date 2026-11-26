"use client";

import { useEffect, useState } from "react";
import { timeLeft } from "./projects/countdown";

// Big countdown shown on every signed-in page, so nobody misses that
// submissions are about to close. `deadline` is an ISO string so it can cross
// the server/client boundary.
export function DeadlineBanner({ deadline, label }: { deadline: string; label: string }) {
  const end = new Date(deadline);
  // null until mounted: the server and first client render agree, then it ticks.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return <div aria-hidden className="h-[96px] max-[640px]:h-[132px]" />;

  const left = timeLeft(end, now);
  if (!left) {
    return (
      <div
        role="alert"
        className="mx-auto mt-[14px] max-w-[1120px] border-2 border-stroke bg-[color-mix(in_srgb,var(--bad)_18%,var(--panel))] px-[20px] py-[14px] text-[16px]"
      >
        <strong>Submissions closed.</strong> The deadline was {label}.
      </div>
    );
  }

  const p = (n: number) => String(n).padStart(2, "0");
  const parts: [string, string][] = [
    [String(left.days), "DAYS"],
    [p(left.hours), "HRS"],
    [p(left.minutes), "MIN"],
    [p(left.seconds), "SEC"],
  ];
  // Under 24h the colour turns urgent.
  const urgent = left.days === 0;

  return (
    <div
      role="status"
      className={
        "mx-auto mt-[14px] flex max-w-[1120px] flex-wrap items-center justify-between gap-x-6 gap-y-3 border-2 border-stroke px-[20px] py-[12px] " +
        (urgent ? "bg-[color-mix(in_srgb,var(--bad)_18%,var(--panel))]" : "bg-panel-2")
      }
    >
      <div>
        <p className="text-[18px] font-bold leading-tight">Submissions close {label}</p>
        <p className="text-[13px] opacity-80">Submit your projects before the timer hits zero.</p>
      </div>
      <div className="flex items-end gap-[10px] tabular-nums" aria-label="Time left to submit">
        {parts.map(([value, unit]) => (
          <div key={unit} className="min-w-[64px] border-2 border-stroke bg-panel px-[10px] py-[6px] text-center">
            <div className="text-[34px] font-bold leading-none">{value}</div>
            <div className="mt-[4px] text-[11px] tracking-wider opacity-70">{unit}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
