"use client";

import { useEffect } from "react";

// Review page keyboard shortcuts: ←/→ (or j/k) for the previous/next
// submission, r for the repo, d for the demo. They click the real links
// (QueueNav's [data-shortcut], the owner card's [data-review-link]) so
// navigation and ReviewForm's repo/demo open tracking behave exactly like a
// mouse click. Ignored while typing or with a modifier held.
const KEYS: Record<string, string> = {
  ArrowLeft: '[data-shortcut="prev"]',
  k: '[data-shortcut="prev"]',
  ArrowRight: '[data-shortcut="next"]',
  j: '[data-shortcut="next"]',
  r: '[data-review-link="repo"] a',
  d: '[data-review-link="demo"] a',
};

function isTyping(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return el.matches("input, textarea, select");
}

export function ReviewShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isTyping(document.activeElement)) return;
      const selector = KEYS[e.key];
      if (!selector) return;
      const target = document.querySelector<HTMLElement>(selector);
      if (!target) return;
      e.preventDefault();
      target.click();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
