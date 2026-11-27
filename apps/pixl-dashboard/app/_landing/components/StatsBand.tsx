"use client";

import { motion } from "framer-motion";
import { useEnded, type Results } from "./EndedProvider";
import { useLocale } from "./LocaleProvider";

type StatKey = keyof Results;

// Locale-aware number and dollar formatting for the five totals.
function useFormat() {
  const { lang } = useLocale();
  const num = new Intl.NumberFormat(lang);
  const usd = new Intl.NumberFormat(lang, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return (key: StatKey, results: Results) => (key === "rewardsUsd" ? usd.format(results[key]) : num.format(results[key]));
}

const ORDER: StatKey[] = ["users", "projectsCreated", "projectsShipped", "hoursShipped", "rewardsUsd"];

/**
 * "Pixl by the numbers": all five totals as cards. Renders nothing until the
 * program has ended and the numbers have loaded, so before the deadline the
 * landing page is exactly what it always was.
 */
export function StatsBand() {
  const { ended, results } = useEnded();
  const { dict } = useLocale();
  const format = useFormat();
  if (!ended || !results) return null;
  const t = dict.ended;

  return (
    <section className="my-16 px-4 md:px-8 flex flex-col items-center gap-8" id="numbers">
      <motion.h2
        className="text-5xl md:text-6xl text-center"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        {t.bandTitle}
      </motion.h2>
      <div className="grid w-full max-w-5xl grid-cols-2 gap-4 lg:grid-cols-5">
        {ORDER.map((key, i) => (
          <motion.div
            key={key}
            className="border-2 border-black bg-[#fffaf7] px-3 py-5 text-center"
            style={{ boxShadow: "4px 4px 0px #000" }}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: i * 0.08 }}
          >
            <p className="font-pixel text-3xl leading-none text-[#ec3750] sm:text-4xl">{format(key, results)}</p>
            <p className="mt-2 font-sans text-[11px] font-bold uppercase tracking-wide text-black/60 sm:text-xs">
              {t.labels[key]}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/**
 * A one-line callout for a specific section. `line` is a dictionary key under
 * `ended` whose text holds {users} {projectsCreated} {projectsShipped}
 * {hoursShipped} {rewardsUsd} placeholders. Renders nothing before the end.
 */
export function EndedLine({ line }: { line: "shopLine" | "questLine" }) {
  const { ended, results } = useEnded();
  const { dict } = useLocale();
  const format = useFormat();
  if (!ended || !results) return null;
  const text = (dict.ended[line] as string).replace(/\{(\w+)\}/g, (m, k: string) =>
    k in results ? format(k as StatKey, results) : m,
  );
  return (
    <motion.p
      className="mt-4 inline-block border-2 border-black bg-[#ff8c37] px-4 py-2 font-pixel text-sm text-white md:text-base"
      style={{ boxShadow: "4px 4px 0px #000" }}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
    >
      {text}
    </motion.p>
  );
}
