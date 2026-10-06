"use client";

import { useEffect, useState } from "react";

// Text-size cycler, rendered in the fixed top bar (app/layout.tsx) next to
// the live mode toggle so it's pinned on every page. The
// saved step is applied before paint by the inline script in app/layout.tsx
// (so there's no flash of the wrong size); this only syncs its label to it
// and handles the clicks. globals.css scales the root font-size by
// --font-scale.
const SCALES = [1, 1.15, 1.3];
const LABELS = ["A", "A+", "A++"];

export function FontSizeSwitcher() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      const saved = parseInt(localStorage.getItem("fontStep") || "0", 10);
      if (saved >= 0 && saved < SCALES.length) setStep(saved);
    } catch {}
  }, []);

  function cycle() {
    const next = (step + 1) % SCALES.length;
    setStep(next);
    document.documentElement.style.setProperty("--font-scale", String(SCALES[next]));
    try {
      localStorage.setItem("fontStep", String(next));
    } catch {}
  }

  return (
    <button
      type="button"
      onClick={cycle}
      title="Text size"
      aria-label={`Text size: ${LABELS[step]}`}
      className="grid place-items-center h-8 min-w-8 px-2 rounded-md border border-border bg-secondary text-xs font-semibold text-secondary-foreground hover:bg-accent"
    >
      {LABELS[step]}
    </button>
  );
}
