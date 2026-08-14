"use client";
import { useLayoutEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useLocale } from "./LocaleProvider";
import { Crew } from "./Crew";

const PLAY_URL = "https://pixl.hackclub.com/play";

export function Hero() {
  const { dict } = useLocale();
  const t = dict.hero;
  const videoRef = useRef<HTMLVideoElement>(null);

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.defaultMuted = true;
    video.muted = true;

    function tryPlay() {
      video?.play().catch(() => {});
    }

    tryPlay();
    video.addEventListener("canplay", tryPlay);

    const events = ["pointerdown", "touchstart", "keydown", "scroll"];
    function onInteract() {
      tryPlay();
      if (video && !video.paused) {
        events.forEach((e) => window.removeEventListener(e, onInteract));
      }
    }
    events.forEach((e) => window.addEventListener(e, onInteract, { passive: true }));

    return () => {
      video.removeEventListener("canplay", tryPlay);
      events.forEach((e) => window.removeEventListener(e, onInteract));
    };
  }, []);

  return (
    <div className="relative h-screen">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        autoPlay
        muted
        loop
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        preload="auto"
        poster="/hero-bg1.png"
      >
        <source src="https://cdn.hackclub.com/019eee3a-c90e-79da-a7cc-9251883cfb5a/hero-bg.mp4" type="video/mp4" />
      </video>
      <motion.div
        className="absolute inset-0 bg-black"
        initial={{ opacity: 0.6 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 1.2, ease: "easeOut" }}
      />
      <div className="relative z-10 flex h-screen w-full items-center justify-center flex-col">
        <div className="flex flex-col items-center px-4">
          <motion.div
            className="bg-[#fffaf7] border-2 border-black px-4 py-2 sm:px-5 sm:py-3 mb-4 sm:mb-6 max-w-[15rem] sm:max-w-sm mx-4 translate-y-4 sm:translate-y-6"
            style={{ boxShadow: "4px 4px 0px #000", rotate: "-1.5deg" }}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.45 }}
          >
            <p className="font-sans font-bold text-xs sm:text-sm leading-snug text-center text-black">
              <span className="text-[#ff8c37]">{t.youShip}</span> {t.projectsInside}{" "}
              <span className="text-[#ec3750]">{t.weShip}</span> {t.realPrizes}
            </p>
          </motion.div>
          <motion.p
            className="font-pixel text-[#ec3750] text-[6rem] sm:text-[9rem] md:text-[13rem] lg:text-[16rem] select-none leading-none"
            style={{ textShadow: "var(--pixl-shadow)" }}
            initial={{ opacity: 0, y: -80, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
          >
            Pixl
          </motion.p>
          <motion.div
            className="flex flex-col items-center w-full"
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.7 }}
          >
            <motion.a
              href={PLAY_URL}
              className="text-center font-pixel px-8 py-3 sm:px-12 sm:py-4 text-2xl sm:text-4xl md:text-5xl bg-[#F5EED2] cursor-pointer text-black border-black border-r-8 border-t-2 border-l-2 border-b-8 hover:border-b-12 hover:-translate-y-1 hover:-translate-x-1 transition-all"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              enter the YSWS
            </motion.a>
            <Crew />
          </motion.div>
        </div>
        <motion.div
          className="absolute bottom-5 sm:bottom-8 flex flex-col items-center gap-2 select-none pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 1.4 }}
        >
          <p
            className="font-pixel text-white text-sm sm:text-lg md:text-xl uppercase tracking-widest"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,0.7)" }}
          >
            {t.scrollHint}
          </p>
          <motion.svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="sm:w-9 sm:h-9"
            style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))" }}
            animate={{ y: [0, 7, 0] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          >
            <path d="M6 9l6 6 6-6" />
          </motion.svg>
        </motion.div>
      </div>
    </div>
  );
}
