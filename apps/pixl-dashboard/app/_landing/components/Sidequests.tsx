"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { useLocale } from "./LocaleProvider";
import { Marquee } from "./Marquee";
import { EndedLine } from "./StatsBand";

// green / orange / red, indexed by difficulty. Read it off the card's own
// difficulty, never off its position in the row: the colour used to be
// LEVEL_COLORS[i % 3], which painted the seventh card (Expert) green and the
// sixth (Beginner) red.
const LEVEL_COLORS = ["#4ade80", "#ff8c37", "#ec3750"] as const;

// Positional metadata for dictionary levels, which carry the copy but no
// difficulty of their own. One array so tags and difficulty cannot drift apart:
// adding a level here means adding its row in every dictionary too.
const LEVEL_META = [
  { difficulty: 0, tags: ["htmlCss", "web"] },
  { difficulty: 1, tags: ["reactNative", "mobile"] },
  { difficulty: 2, tags: ["networking", "security", "backend"] },
  { difficulty: 0, tags: ["roblox", "lua", "gameDev"] },
  { difficulty: 1, tags: ["pixelArt", "design", "gameDev", "code"] },
  { difficulty: 0, tags: ["pixelArt", "design", "code"] },
  { difficulty: 2, tags: ["robotics", "firmware", "hardware", "code"] },
];

function SidequestCard({
  l,
  tags,
  t,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  l: any;
  tags: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="flex flex-col border-2 border-black bg-[#fffaf7] w-80 shrink-0 group relative overflow-hidden cursor-pointer"
      style={{ boxShadow: `6px 6px 0px ${l.color}` }}
      onClick={() => setOpen((o) => !o)}
    >
      <div className="flex items-center justify-between px-5 py-4 border-b-2 border-black">
        <span
          className="font-pixel text-sm px-3 py-1 border-2 border-black"
          style={{ background: l.color, color: "#fff" }}
        >
          {l.level}
        </span>
        <p className="text-black/40 text-xs font-sans">{l.hours}</p>
      </div>

      <div className="px-5 py-5 flex flex-col gap-2 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-black/40 font-sans">
          {t.sidequestLabel}
        </p>
        <p className="font-pixel text-lg leading-snug">{l.quest.title}</p>
        <p className="text-black/60 text-sm leading-relaxed font-sans">
          {l.quest.description}
        </p>
        <div className="flex gap-2 flex-wrap mt-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] border border-black/30 px-2 py-0.5 text-black/50 font-sans"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div
        className={`absolute inset-0 bg-[#fffaf7] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] flex flex-col justify-center px-5 py-5 gap-3 group-hover:translate-y-0 ${open ? "translate-y-0" : "translate-y-full"}`}
      >
        <p className="text-[10px] font-bold uppercase tracking-widest text-black/40 font-sans">
          {t.prizeLabel}
        </p>
        <p className="font-pixel text-2xl leading-snug">{l.prize.title}</p>
        <p className="text-black/60 text-sm leading-relaxed font-sans">
          {l.prize.description}
        </p>
      </div>
    </div>
  );
}

export function Sidequests() {
  const { dict } = useLocale();
  const t = dict.sidequests;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // Resolved here rather than at render, so a card keeps its own colour and
  // tags when the marquee duplicates the list.
  const levels = (t.levels as any[]).map((l: any, i: number) => {
    const meta = LEVEL_META[i % LEVEL_META.length];
    return {
      ...l,
      color: LEVEL_COLORS[meta.difficulty],
      tags: meta.tags.map((k) => (t.tags as Record<string, string>)[k]),
    };
  });

  return (
    <section
      className="my-10 md:my-20 px-4 md:px-8 flex flex-col items-center gap-16"
      id="sidequests"
    >
      <div className="text-center">
        <motion.p
          className="text-sm font-bold uppercase tracking-widest text-black/50 mb-2"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          {t.badge}
        </motion.p>
        <motion.h2
          className="text-5xl md:text-6xl font-black"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          {t.title}
        </motion.h2>
        <motion.p
          className="mt-3 text-black/60 text-base md:text-lg max-w-xl mx-auto font-sans"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          {t.description}
        </motion.p>
        <EndedLine line="questLine" />
      </div>

      <motion.div
        className="max-w-2xl w-full border-2 border-black bg-[#fffaf7] px-6 py-5 text-center font-sans"
        style={{ boxShadow: "4px 4px 0px #000" }}
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
      >
        <p className="font-pixel text-lg mb-2">{t.howRewardsWork}</p>
        <p className="text-black/60 text-sm leading-relaxed">
          {t.howRewardsWorkDesc}
        </p>
      </motion.div>

      <Marquee duration={24} className="gap-5" swallowClickAfterDrag>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {[...levels, ...levels].map((l: any, i: number) => (
          <SidequestCard key={i} l={l} tags={l.tags} t={t} />
        ))}
      </Marquee>
    </section>
  );
}
