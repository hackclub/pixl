"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { BoltIcon, LockIcon } from "./BlackoutIcons";
import { useLocale } from "./LocaleProvider";
import { useBlackoutStatus } from "./useBlackoutStatus";

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
};

// A dying-bulb flicker: mostly steady, with a couple of stutters near the
// end of each cycle, then a pause before it repeats. Values/times arrays
// must stay the same length and times must stay monotonic 0->1.
const FLICKER_OPACITY = [1, 1, 0.15, 1, 1, 0.2, 0.6, 1, 1, 1, 0.1, 1];
const FLICKER_TIMES = [0, 0.4, 0.42, 0.45, 0.6, 0.62, 0.65, 0.68, 0.8, 0.85, 0.87, 1];

export function OperationTeaser() {
  const { dict, lang } = useLocale();
  const t = dict.operationTeaser;
  const reduceMotion = useReducedMotion();
  const { operation } = useBlackoutStatus(lang);
  const ended = operation?.status === "ended";
  const live = !ended && operation?.briefingUnlocked === true;
  const sealed = !ended && !live;
  const stamp = ended ? t.stampEnded : live ? t.stampLive : t.stamp;
  const title = ended ? t.titleEnded : t.title;
  const body = ended ? t.bodyEnded : live ? t.bodyLive : t.body;
  const footer = ended ? t.footerEnded : t.footer;

  return (
    <section
      className="my-10 md:my-20 px-4 md:px-8 flex flex-col items-center gap-6"
      id="operation-teaser"
    >
      <motion.p
        className="text-sm font-bold uppercase tracking-widest text-black/50 font-sans"
        {...fadeUp}
        transition={{ duration: 0.5 }}
      >
        {t.eyebrow}
      </motion.p>

      <motion.div
        className="relative w-full max-w-lg bg-[#fffaf7] border-2 border-black px-6 py-10 sm:px-12 sm:py-14"
        style={{ boxShadow: "8px 8px 0px #000" }}
        {...fadeUp}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <div
          className={`absolute -top-5 -right-3 sm:-right-6 border-4 ${ended ? "border-black/50 text-black/50" : "border-[#ec3750] text-[#ec3750]"} font-pixel uppercase text-xs sm:text-base px-2.5 py-1 sm:px-4 sm:py-1.5 select-none bg-[#fffaf7]`}
          style={{ rotate: "-9deg" }}
        >
          {stamp}
        </div>

        <div className="flex flex-col items-center text-center gap-5">
          {sealed ? <LockIcon /> : <BoltIcon />}

          <span className="font-pixel text-xs sm:text-sm px-3 py-1 border-2 border-black bg-black text-[#F5EED2]">
            {t.tag}
          </span>

          <motion.h2
            className="font-pixel text-3xl sm:text-5xl text-black leading-tight"
            animate={reduceMotion || ended ? {} : { opacity: FLICKER_OPACITY }}
            transition={{
              duration: 3.2,
              times: FLICKER_TIMES,
              repeat: Infinity,
              repeatDelay: 2.5,
              ease: "linear",
            }}
          >
            {title}
          </motion.h2>

          {sealed && (
            <div className="flex flex-col gap-2 w-full max-w-[14rem]">
              <div className="h-4 sm:h-5 bg-black w-full" />
              <div className="h-4 sm:h-5 bg-black w-2/3 mx-auto" />
            </div>
          )}

          <p className="font-sans text-black/70 text-sm sm:text-base max-w-sm leading-relaxed">
            {body}
          </p>

          <p className="font-pixel text-[10px] sm:text-xs uppercase tracking-widest text-black/40 mt-2">
            {footer}
          </p>

          {!sealed && (
            <Link
              href={`/${lang}/operations/blackout`}
              className={`font-pixel text-sm sm:text-base border-2 border-black px-5 py-2.5 transition-colors ${
                ended ? "bg-white text-black hover:bg-black hover:text-[#F5EED2]" : "bg-[#ec3750] text-white hover:bg-black"
              }`}
              style={{ boxShadow: "4px 4px 0px #000" }}
            >
              {ended ? t.ctaEnded : t.ctaLive}
            </Link>
          )}
        </div>
      </motion.div>
    </section>
  );
}
