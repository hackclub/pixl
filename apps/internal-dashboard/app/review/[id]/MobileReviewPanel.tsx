"use client";

import { useEffect } from "react";
import { Icon } from "@/app/_ui/ui";

const PANEL_ID = "review-panel";
const OPEN_ATTR = "data-mobile-open";

function panel(): HTMLElement | null {
  return document.getElementById(PANEL_ID);
}

function openPanel() {
  const el = panel();
  if (!el) return;
  el.setAttribute(OPEN_ATTR, "");
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "review-panel-title");
  document.body.classList.add("hc-sheet-open");
  el.scrollTop = 0;
  const close = el.querySelector<HTMLButtonElement>("[data-close-review]");
  close?.focus({ preventScroll: true });
}

function closePanel() {
  const el = panel();
  if (!el) return;
  el.removeAttribute(OPEN_ATTR);
  el.removeAttribute("role");
  el.removeAttribute("aria-modal");
  el.removeAttribute("aria-labelledby");
  document.body.classList.remove("hc-sheet-open");
  document.querySelector<HTMLButtonElement>("[data-mobile-review-trigger]")?.focus({ preventScroll: true });
}

export function MobileReviewButton({
  index,
  total,
  label = "Review",
}: {
  index: number;
  total: number;
  label?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = panel();
      if (el?.hasAttribute(OPEN_ATTR)) closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("hc-sheet-open");
    };
  }, []);

  return (
    <button
      type="button"
      className="hc-btn hc-btn-success hc-mobile-review-trigger"
      onClick={openPanel}
      data-mobile-review-trigger
      aria-controls={PANEL_ID}
      aria-haspopup="dialog"
    >
      <Icon glyph="checkmark" size={18} />
      <span>{label}</span>
      {index >= 0 && (
        <span className="hc-mono hc-mobile-review-count">
          {index + 1}/{total}
        </span>
      )}
    </button>
  );
}

export function MobileReviewSheetHeader({ title }: { title: string }) {
  return (
    <div className="hc-mobile-sheet-head">
      <button
        type="button"
        className="hc-btn hc-btn-ghost hc-btn-sm hc-btn-icon"
        onClick={closePanel}
        data-close-review
        aria-label="Close review panel"
      >
        <Icon glyph="view-back" size={20} />
      </button>
      <span id="review-panel-title" className="hc-heading truncate text-sm">
        {title}
      </span>
      <button type="button" className="hc-btn hc-btn-outline hc-btn-sm ml-auto" onClick={closePanel}>
        Done
      </button>
    </div>
  );
}
