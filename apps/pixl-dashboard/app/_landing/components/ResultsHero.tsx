"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocale } from "./LocaleProvider";
import { cn } from "@/lib/cn";

interface Results {
  users: number;
  projectsCreated: number;
  projectsShipped: number;
  hoursShipped: number;
  rewardsUsd: number;
}

const REFRESH_MS = 60_000;

// What the landing hero turns into once the submission deadline has passed
// (see DeadlineSwitch). The five totals are read through this app's own
// /api/results route and refreshed every minute, so late reviews keep moving
// them.
export function ResultsHero() {
  const { dict, lang } = useLocale();
  const t = dict.results;
  const [data, setData] = useState<Results | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/results");
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as Results & { ok: boolean };
        if (!cancelled && json.ok) {
          setData(json);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const num = new Intl.NumberFormat(lang);
  const usd = new Intl.NumberFormat(lang, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  const stats: { key: string; label: string; value: string | null }[] = [
    { key: "users", label: t.users, value: data ? num.format(data.users) : null },
    { key: "created", label: t.projectsCreated, value: data ? num.format(data.projectsCreated) : null },
    { key: "shipped", label: t.projectsShipped, value: data ? num.format(data.projectsShipped) : null },
    { key: "hours", label: t.hoursShipped, value: data ? num.format(data.hoursShipped) : null },
    { key: "rewards", label: t.rewards, value: data ? usd.format(data.rewardsUsd) : null },
  ];

  return (
    <div className="relative min-h-screen">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/hero-bg-poster.webp)" }}
      />
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative z-10 flex min-h-screen w-full flex-col items-center justify-center px-4 py-16">
        <motion.p
          className="font-sans text-xs font-bold uppercase tracking-widest text-[#ff8c37] sm:text-sm"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          {t.eyebrow}
        </motion.p>
        <motion.h1
          className={cn(
            "mt-2 text-center font-pixel text-5xl leading-none text-[#ec3750] sm:text-7xl md:text-8xl",
            "[text-shadow:2px_0_0_#16161e,-2px_0_0_#16161e,0_2px_0_#16161e,0_-2px_0_#16161e,2px_2px_0_#16161e,-2px_2px_0_#16161e,2px_-2px_0_#16161e,-2px_-2px_0_#16161e,5px_5px_0_#16161e]",
          )}
          initial={{ opacity: 0, y: -40, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
        >
          {t.title}
        </motion.h1>
        <motion.p
          className="mt-4 max-w-xl text-center font-sans text-sm text-white sm:text-base"
          style={{ textShadow: "0 2px 6px rgba(0,0,0,0.7)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.4 }}
        >
          {t.subtitle}
        </motion.p>

        <div className="mt-10 grid w-full max-w-5xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stats.map((s, i) => (
            <motion.div
              key={s.key}
              className="border-2 border-black bg-[#fffaf7] px-5 py-4 text-center"
              style={{ boxShadow: "4px 4px 0px #000" }}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.5 + i * 0.1 }}
            >
              <p className="font-pixel text-4xl leading-none text-black sm:text-5xl">
                {s.value ?? (failed ? "-" : "...")}
              </p>
              <p className="mt-2 font-sans text-xs font-bold uppercase tracking-wide text-black/60 sm:text-sm">
                {s.label}
              </p>
            </motion.div>
          ))}
        </div>

        {failed && !data && (
          <p className="mt-6 text-center font-sans text-sm text-white">{t.unavailable}</p>
        )}
      </div>
    </div>
  );
}
