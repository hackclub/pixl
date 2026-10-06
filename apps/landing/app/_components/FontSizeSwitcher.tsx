"use client";

import { useSyncExternalStore } from "react";
import { useLocale } from "./LocaleProvider";

// Text-size cycler, pinned to the bottom-right corner as the mirror of the
// LanguageSwitcher on the left. The saved step is applied before paint by the
// inline script in app/[lang]/layout.tsx (so there's no flash of the wrong
// size); this only syncs its label to it and handles the clicks. globals.css
// scales the root font-size by --font-scale, which carries every rem-based
// Tailwind size along with it.
const SCALES = [1, 1.15, 1.3];
const LABELS = ["A", "A+", "A++"];

// The saved step lives in localStorage; useSyncExternalStore reads it on the
// client (the server and the first hydration pass use step 0, then React
// re-renders with the real value), and cycle() notifies subscribers.
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function readStep(): number {
  try {
    const saved = parseInt(localStorage.getItem("fontStep") || "0", 10);
    return saved >= 0 && saved < SCALES.length ? saved : 0;
  } catch {
    return 0;
  }
}

export function FontSizeSwitcher() {
  const { dict } = useLocale();
  const step = useSyncExternalStore(subscribe, readStep, () => 0);

  function cycle() {
    const next = (step + 1) % SCALES.length;
    document.documentElement.style.setProperty("--font-scale", String(SCALES[next]));
    try {
      localStorage.setItem("fontStep", String(next));
    } catch {}
    listeners.forEach((l) => l());
  }

  return (
    <div className="fixed bottom-0 right-3 z-1000 sm:right-5">
      <button
        type="button"
        onClick={cycle}
        title={dict.menu.textSize}
        aria-label={`${dict.menu.textSize}: ${LABELS[step]}`}
        className="flex cursor-pointer items-center border-black border-b-4 border-l-2 border-r-4 border-t-2 bg-[#F5EED2] px-3 py-1.5 font-pixel text-base text-black transition-all hover:border-b-6 sm:px-6 sm:py-2 sm:text-lg lg:text-xl"
      >
        {LABELS[step]}
      </button>
    </div>
  );
}
