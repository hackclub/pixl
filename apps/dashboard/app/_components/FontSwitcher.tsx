"use client";

import { useSyncExternalStore } from "react";

// Toggles the whole dashboard between its normal font and Phantom Sans, Hack
// Club's typeface. Rendered in the fixed top bar (app/layout.tsx) next to the
// live mode toggle. The choice is stored in localStorage and applied as
// <html data-font="phantom"> by the inline script in app/layout.tsx before
// first paint; globals.css does the actual font swap.
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
    <button
      type="button"
      onClick={toggle}
      aria-pressed={phantom}
      title={phantom ? "Switch back to the default font" : "Switch to Phantom Sans"}
      className={`h-8 px-2.5 rounded-md border text-xs font-semibold ${
        phantom
          ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
          : "border-border bg-secondary text-secondary-foreground hover:bg-accent"
      }`}
    >
      Phantom Sans
    </button>
  );
}
