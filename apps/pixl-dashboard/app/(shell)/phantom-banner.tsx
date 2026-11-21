"use client";

import { useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

// A cross-promo for Phantom, Hack Club's escape-room hackathon in Philadelphia.
// It lives in the shell so every signed-in page gets it, but it is one slim
// strip and remembers a dismissal, so it never becomes furniture.
const DISMISS_KEY = "pixl_phantom_banner_dismissed_v1";
const PHANTOM_URL =
  "https://phantom.hackclub.com/?utm_source=pixl&utm_medium=dashboard_banner&utm_campaign=phantom";

export function PhantomBanner() {
  const [dismissed, setDismissed] = useState(false);
  const reduceMotion = useReducedMotion() ?? false;
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === "1") setDismissed(true);
    } catch {
      // Private mode / blocked storage: keep the banner instead of crashing.
    }
  }, []);

  // Only decode the loop while the strip is actually on screen, and never
  // autoplay it for visitors who asked for less motion (the poster stays).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (reduceMotion) {
      video.pause();
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.2 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [reduceMotion, dismissed]);

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // The banner still closes for this page view.
    }
  }

  if (dismissed) return null;

  return (
    <section
      aria-label="Phantom, an escape room hackathon by Hack Club"
      className="relative mx-auto mt-3 max-w-[1120px] overflow-hidden border-2 border-stroke bg-[#0b0b0c] text-[#efeee9] shadow-[4px_4px_0_var(--stroke)]"
    >
      <video
        ref={videoRef}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover brightness-[1.8] contrast-[1.12]"
        poster="/phantom/background-poster.jpg"
        muted
        loop
        playsInline
        preload="none"
        disablePictureInPicture
        disableRemotePlayback
        aria-hidden="true"
        tabIndex={-1}
      >
        <source src="/phantom/background.mp4" type="video/mp4" />
      </video>

      {/* Keeps the copy readable over the grain while letting the texture show. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(11,11,12,.82)_0%,rgba(11,11,12,.56)_42%,rgba(11,11,12,.16)_76%,rgba(11,11,12,.3)_100%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_130%,rgba(255,255,255,.07),transparent_58%)]"
      />

      <div className="relative z-10 flex flex-col gap-3 p-4 pr-11 sm:px-5 sm:py-6 sm:pr-12 min-[1200px]:flex-row min-[1200px]:items-center min-[1200px]:gap-5">
        <div className="flex min-w-0 shrink-0 items-center gap-3">
          {/* The flag is part of Phantom's lockup, desaturated to match it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/phantom/hack-club-flag.png"
            alt=""
            aria-hidden="true"
            className="phantom-flag w-[76px] shrink-0 brightness-[1.6] contrast-[1.05] grayscale opacity-85 sm:w-[96px]"
          />
          <p className="phantom-wordmark text-[40px] leading-[.8] sm:text-[52px]">
            PHANTOM
          </p>
        </div>

        <div className="min-w-0 flex-1 [text-shadow:0_1px_3px_rgba(0,0,0,.6)] min-[1200px]:border-l min-[1200px]:border-[#efeee9]/20 min-[1200px]:pl-5">
          <p className="text-[15px] font-semibold leading-[1.25] sm:text-[17px]">
            An escape room hackathon in Philadelphia.
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase leading-[1.45] tracking-[.11em] text-[#efeee9]/70">
            Feb 12&ndash;14, 2027 &middot; build 50 hours &middot; earn your invite
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 min-[1200px]:pl-1">
          <a
            href={PHANTOM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-2 border-2 border-[#efeee9] bg-[#efeee9] px-4 py-[9px] font-mono text-[10.5px] font-semibold uppercase tracking-[.14em] text-[#0b0b0c] transition-colors hover:bg-transparent hover:text-[#efeee9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#efeee9]"
          >
            Enter the void
            <span
              aria-hidden="true"
              className="text-[13px] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            >
              &#8599;
            </span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss the Phantom banner"
        title="Dismiss"
        className="absolute top-2 right-2 z-20 flex size-7 items-center justify-center border border-[#efeee9]/25 font-mono text-[16px] leading-none text-[#efeee9]/55 transition-colors hover:border-[#efeee9]/60 hover:text-[#efeee9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#efeee9]"
      >
        &times;
      </button>
    </section>
  );
}
