"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { config } from "../_generated/config";
import { BoltIcon, LockIcon } from "./BlackoutIcons";
import { useLocale } from "./LocaleProvider";
import { useBlackoutStatus } from "./useBlackoutStatus";

function useCountdown(targetIso: string | undefined, onDone: () => void) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!targetIso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  const left = targetIso ? Math.max(0, new Date(targetIso).getTime() - now) : 0;
  const done = !!targetIso && left === 0;
  useEffect(() => {
    if (done) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);
  const s = Math.floor(left / 1000);
  return { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 };
}

const CARD = "relative w-full max-w-2xl bg-[#fffaf7] border-2 border-black px-5 py-9 sm:px-12 sm:py-12";
const SHADOW = { boxShadow: "8px 8px 0px #000" };

function Stamp({ children }: { children: string }) {
  return (
    <div
      className="absolute -top-5 -right-2 sm:-right-6 border-4 border-[#ec3750] text-[#ec3750] font-pixel uppercase text-xs sm:text-base px-2.5 py-1 sm:px-4 sm:py-1.5 select-none bg-[#fffaf7]"
      style={{ rotate: "-9deg" }}
    >
      {children}
    </div>
  );
}

export function BlackoutBriefing() {
  const { dict, lang } = useLocale();
  const t = dict.operationBriefing;
  const { loaded, operation: op, briefing, refresh } = useBlackoutStatus(lang);
  const unlocked = !!op?.briefingUnlocked && !!briefing;
  const countdown = useCountdown(!unlocked && op?.status === "upcoming" ? op.startsAt : undefined, refresh);

  const fmtDate = (iso?: string) =>
    iso ? new Date(iso).toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" }) : "";
  const fill = (text: string) =>
    text
      .replaceAll("{start}", fmtDate(op?.startsAt))
      .replaceAll("{end}", fmtDate(op?.endsAt))
      .replaceAll("{rate}", String(op?.rateUsd ?? ""))
      .replaceAll("{grace}", String(op?.gracePeriodHours ?? ""));

  const statusNote =
    op?.status === "paused" ? t.statusPaused : op?.status === "ended" ? t.statusEnded : op?.status === "active" ? t.statusActive : "";

  return (
    <main className="min-h-screen bg-[#F5EED2] text-black font-pixel overflow-x-clip px-4 py-8 md:py-14 flex flex-col items-center gap-8">
      <Link href={`/${lang}`} className="self-start md:self-center text-sm font-sans font-bold uppercase tracking-widest text-black/60 hover:text-[#ec3750] transition-colors">
        {t.back}
      </Link>

      <p className="text-sm font-bold uppercase tracking-widest text-black/50 font-sans">{t.eyebrow}</p>

      <section className={CARD} style={SHADOW} aria-labelledby="blackout-title">
        <Stamp>{unlocked ? t.stampOpen : t.stampLocked}</Stamp>

        <div className="flex flex-col items-center text-center gap-5">
          {unlocked ? <BoltIcon /> : <LockIcon />}
          <span className="font-pixel text-xs sm:text-sm px-3 py-1 border-2 border-black bg-black text-[#F5EED2]">{t.tag}</span>
          <h1 id="blackout-title" className="font-pixel text-3xl sm:text-5xl leading-tight break-words">
            {t.title}
          </h1>

          {!loaded && <p className="font-sans text-black/50 text-sm">…</p>}

          {loaded && !unlocked && (
            <>
              <div className="flex flex-col gap-2 w-full max-w-[14rem]">
                <div className="h-4 sm:h-5 bg-black w-full" />
                <div className="h-4 sm:h-5 bg-black w-2/3 mx-auto" />
              </div>
              <p className="font-pixel text-lg sm:text-2xl">{t.lockedTitle}</p>
              <p className="font-sans text-black/70 text-sm sm:text-base max-w-sm leading-relaxed">{t.lockedBody}</p>
              {op?.status === "upcoming" ? (
                <div className="flex flex-col items-center gap-2" role="timer" aria-label={t.countdownLabel}>
                  <span className="font-pixel text-[10px] sm:text-xs uppercase tracking-widest text-black/40">{t.countdownLabel}</span>
                  <div className="flex gap-2 sm:gap-3 font-pixel text-2xl sm:text-4xl tabular-nums">
                    {[
                      [countdown.days, t.days],
                      [countdown.hours, t.hours],
                      [countdown.minutes, t.minutes],
                      [countdown.seconds, t.seconds],
                    ].map(([n, unit]) => (
                      <span key={String(unit)} className="border-2 border-black bg-white px-2 py-1 min-w-[3.2rem] sm:min-w-[4.2rem]">
                        {String(n).padStart(2, "0")}
                        <span className="text-xs sm:text-sm text-black/50 ml-0.5">{unit}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="font-pixel text-[10px] sm:text-xs uppercase tracking-widest text-black/40">{t.signalLost}</p>
              )}
            </>
          )}

          {unlocked && op && briefing && (
            <div className="flex flex-col gap-6 w-full text-left">
              {statusNote && (
                <p className="font-pixel text-xs sm:text-sm uppercase tracking-wide text-center border-2 border-black bg-white px-3 py-2">
                  {statusNote}
                </p>
              )}
              <p className="font-sans text-black/75 text-sm sm:text-base leading-relaxed">{briefing.intro}</p>

              <ol className="flex flex-col gap-4">
                {briefing.rules.map((r, i) => (
                  <li key={r.title} className="flex gap-3 sm:gap-4">
                    <span className="shrink-0 w-7 h-7 sm:w-8 sm:h-8 bg-black text-[#F5EED2] font-pixel text-sm sm:text-base grid place-items-center">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <h2 className="font-pixel text-base sm:text-xl leading-tight">{r.title}</h2>
                      <p className="font-sans text-black/70 text-sm sm:text-base leading-relaxed mt-1 break-words">{fill(r.body)}</p>
                    </div>
                  </li>
                ))}
              </ol>

              {op.power && (
                <div className="border-2 border-black bg-white p-4 flex flex-col items-center gap-1 text-center">
                  <span className="font-pixel text-[10px] sm:text-xs uppercase tracking-widest text-black/50">{t.powerLabel}</span>
                  <span className="font-pixel text-3xl sm:text-5xl tabular-nums">{Math.round(op.power.powerUnits)}</span>
                  <span className="font-sans text-xs text-black/60">
                    {Math.round(op.power.approvedHours)} {t.powerHours} · {op.power.participants} {t.powerBuilders}
                  </span>
                </div>
              )}

              {op.status === "active" && (
                <a
                  href={config.urls.play}
                  className="self-center font-pixel text-base sm:text-lg border-2 border-black bg-[#ec3750] text-white px-5 py-2.5 hover:bg-black transition-colors"
                  style={{ boxShadow: "4px 4px 0px #000" }}
                >
                  {t.cta}
                </a>
              )}
            </div>
          )}

          <p className="font-pixel text-[10px] sm:text-xs uppercase tracking-widest text-black/40 mt-2">{t.footer}</p>
        </div>
      </section>
    </main>
  );
}
