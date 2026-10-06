"use client";

import { useSyncExternalStore } from "react";
import { useLocale } from "./LocaleProvider";

// Toggles the whole page between its normal fonts and Phantom Sans, Hack
// Club's typeface. Pinned to the bottom-right corner as the mirror of the
// LanguageSwitcher on the left. The choice is stored in localStorage and
// applied as <html data-font="phantom"> by the inline script in
// app/[lang]/layout.tsx before first paint; globals.css does the font swap.
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function isPhantom(): boolean {
  return document.documentElement.dataset.font === "phantom";
}

export function FontSwitcher() {
  const { dict } = useLocale();
  const phantom = useSyncExternalStore(subscribe, isPhantom, () => false);

  function toggle() {
    const next = !phantom;
    if (next) document.documentElement.dataset.font = "phantom";
    else delete document.documentElement.dataset.font;
    try {
      if (next) localStorage.setItem("font", "phantom");
      else localStorage.removeItem("font");
    } catch {}
    listeners.forEach((l) => l());
  }

  return (
    <div className="fixed bottom-0 right-3 z-1000 sm:right-5">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={phantom}
        title={dict.menu.font}
        className={`flex cursor-pointer items-center border-black border-b-4 border-l-2 border-r-4 border-t-2 px-3 py-1.5 font-pixel text-base transition-all hover:border-b-6 sm:px-6 sm:py-2 sm:text-lg lg:text-xl ${
          phantom ? "bg-black text-[#F5EED2]" : "bg-[#F5EED2] text-black"
        }`}
      >
        Phantom Sans
      </button>
    </div>
  );
}
