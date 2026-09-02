"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "./LocaleProvider";
import { FlowDiagram } from "./Flow";
import { launchDate } from "../_generated/config";

// Was new Date("2026-08-18T00:00:00") - no timezone, so the countdown hit zero
// at midnight *local to each visitor*, i.e. a different moment per timezone.
// The config date carries its Z, so everyone counts down to the same instant.
const LAUNCH_DATE = launchDate.getTime();

function useCountdown(target: number) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (now === null) return null;
  const diff = Math.max(target - now, 0);
  return {
    days: Math.floor(diff / 86400000),
    hours: Math.floor((diff % 86400000) / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
    done: diff <= 0,
    msSinceLaunch: Math.max(now - target, 0),
  };
}

// How long the "WE'RE LAUNCHED!!!" celebration stays up before the card
// removes itself , nothing left to count down to after that.
const CELEBRATION_MS = 5 * 3600000;

// A one-shot pixel-art particle burst, fired once when the countdown flips
// to done. Positions are randomized on mount only (client-side, this branch
// never renders during SSR since `now` starts null there), not re-rolled per
// tick.
function ExplosionBurst() {
  const particles = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => {
        const angle = (i / 28) * Math.PI * 2 + Math.random() * 0.4;
        const distance = 90 + Math.random() * 140;
        const colors = ["#ec3750", "#f5c344", "#33d6a6", "#338eda", "#f5eed2"];
        return {
          id: i,
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance,
          color: colors[i % colors.length],
          size: 6 + Math.random() * 10,
          delay: Math.random() * 0.15,
        };
      }),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-visible z-10">
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="absolute"
          style={{ width: p.size, height: p.size, background: p.color, imageRendering: "pixelated" }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.3, rotate: 180 }}
          transition={{ duration: 1.1, delay: p.delay, ease: [0.16, 1, 0.3, 1] }}
        />
      ))}
    </div>
  );
}

function CountdownUnit({ value, label }: { value: number | null; label: string }) {
  return (
    <div className="flex flex-col items-center bg-black text-[#F5EED2] border-2 border-black px-3 py-2 sm:px-5 sm:py-3 min-w-16 sm:min-w-20 overflow-hidden">
      <span className="relative font-sans font-bold text-2xl sm:text-4xl leading-none h-[1em] w-full flex items-center justify-center">
        <AnimatePresence mode="popLayout">
          <motion.span
            key={value}
            initial={{ y: "-100%", opacity: 0 }}
            animate={{ y: "0%", opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="absolute"
          >
            {value === null ? "--" : String(value).padStart(2, "0")}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="text-[10px] sm:text-xs font-sans uppercase tracking-widest text-[#F5EED2]/60 mt-1">
        {label}
      </span>
    </div>
  );
}

function Colon() {
  return (
    <span className="font-sans font-bold text-2xl sm:text-4xl text-black/25 leading-none self-start mt-2 sm:mt-3 animate-pulse">
      :
    </span>
  );
}

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
};

export function Story() {
  const { dict } = useLocale();
  const t = dict.story;
  const countdown = useCountdown(LAUNCH_DATE);

  // Fire the burst exactly once, the instant the countdown flips to done ,
  // not on every render while `done` stays true.
  const [showBurst, setShowBurst] = useState(false);
  const burstFired = useRef(false);
  useEffect(() => {
    if (countdown?.done && !burstFired.current) {
      burstFired.current = true;
      setShowBurst(true);
      const id = setTimeout(() => setShowBurst(false), 1400);
      return () => clearTimeout(id);
    }
  }, [countdown?.done]);

  // After the celebration window, the card has nothing left to show , no
  // countdown target, no reason to keep celebrating , so it removes itself.
  const selfDestruct = !!countdown?.done && countdown.msSinceLaunch > CELEBRATION_MS;

  return (
    <section className="my-10 md:my-20 px-4 md:px-8 flex flex-col items-center gap-14" id="story">
      <div className="text-center">
        <motion.p
          className="text-sm font-bold uppercase tracking-widest text-black/50 mb-2 font-sans"
          {...fadeUp}
          transition={{ duration: 0.5 }}
        >
          {t.badge}
        </motion.p>
        <motion.h2
          className="text-5xl md:text-6xl font-black"
          {...fadeUp}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          {t.title}
        </motion.h2>
        <motion.p
          className="mt-3 text-black/60 text-base md:text-lg max-w-xl mx-auto font-sans"
          {...fadeUp}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          {t.subtitle}
        </motion.p>
      </div>

      <FlowDiagram />

      <AnimatePresence>
        {!selfDestruct && (
          <motion.div
            className="relative max-w-2xl w-full bg-[#fffaf7] border-2 border-black px-6 py-8 text-center flex flex-col items-center gap-5 hover:-translate-y-1 hover:-translate-x-1 transition-transform"
            style={{ boxShadow: "6px 6px 0px #ec3750" }}
            whileHover={{ boxShadow: "10px 10px 0px #ec3750" } as any}
            {...fadeUp}
            exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.6, ease: [0.36, 0, 0.66, -0.56] } }}
            transition={{ duration: 0.5 }}
          >
            {showBurst && <ExplosionBurst />}
            <motion.img
              src="/pixel_currency_gold-removebg-preview.png"
              alt=""
              aria-hidden
              className="absolute -top-6 -left-5 sm:-top-14 sm:-left-12 w-14 sm:w-24 select-none pointer-events-none"
              style={{ imageRendering: "pixelated", rotate: "-15deg" }}
              animate={{ y: [0, -6, 0], rotate: ["-15deg", "-8deg", "-15deg"] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.img
              src="/pixel_currency_red-removebg-preview.png"
              alt=""
              aria-hidden
              className="absolute -bottom-5 -right-4 sm:-bottom-12 sm:-right-10 w-12 sm:w-20 select-none pointer-events-none"
              style={{ imageRendering: "pixelated", rotate: "16deg" }}
              animate={{ y: [0, 6, 0], rotate: ["16deg", "24deg", "16deg"] }}
              transition={{ duration: 3.5, delay: 0.6, repeat: Infinity, ease: "easeInOut" }}
            />
            <p className="font-pixel text-xl">{t.ctaTitle}</p>
            <p className="font-sans text-sm text-black/60 -mt-2">
              {t.ctaText}
            </p>
            {countdown?.done ? (
              <motion.p
                className="font-pixel text-2xl text-[#ec3750]"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: [0.5, 1.15, 1, 1.08, 1], opacity: 1 }}
                transition={{ duration: 1.2, ease: "easeOut" }}
              >
                {t.liveNow}
              </motion.p>
            ) : (
              <div className="flex items-start gap-1.5 sm:gap-2">
                <CountdownUnit value={countdown?.days ?? null} label={t.days} />
                <Colon />
                <CountdownUnit value={countdown?.hours ?? null} label={t.hours} />
                <Colon />
                <CountdownUnit value={countdown?.minutes ?? null} label={t.min} />
                <Colon />
                <CountdownUnit value={countdown?.seconds ?? null} label={t.sec} />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

    </section>
  );
}
