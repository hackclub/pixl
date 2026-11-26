"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass, Muted } from "@/app/_ui/ui";

const ROW_SELECTOR = "input[data-grant-select]";

// The row checkboxes live in the table, outside the download form (nested
// forms would break each row's Mark sent / Unclaim forms), so they join it with
// the HTML `form` attribute. This toolbar keeps the count, select-all state and
// the disabled button in sync without shipping buyer data to the client.
export function GrantSelectionToolbar() {
  const [selected, setSelected] = useState(0);
  const allRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>(ROW_SELECTOR));
    const update = () => {
      const all = boxes();
      const count = all.filter((box) => box.checked).length;
      setSelected(count);
      if (allRef.current) {
        allRef.current.checked = count > 0 && count === all.length;
        allRef.current.indeterminate = count > 0 && count < all.length;
      }
    };
    const onChange = (event: Event) => {
      const target = event.target as HTMLInputElement | null;
      if (target?.id === "grant-select-all") {
        const checked = target.checked;
        for (const box of boxes()) box.checked = checked;
        update();
        return;
      }
      if (target?.matches(ROW_SELECTOR)) update();
    };
    document.addEventListener("change", onChange);
    const rows = document.getElementById("grant-rows");
    const observer = rows ? new MutationObserver(update) : null;
    observer?.observe(rows!, { childList: true, subtree: true });
    update();
    return () => {
      document.removeEventListener("change", onChange);
      observer?.disconnect();
    };
  }, []);

  return (
    <>
      <label className="hc-check">
        <input ref={allRef} id="grant-select-all" type="checkbox" aria-label="Select every grant row" />
        <span>Select all</span>
      </label>
      <button type="submit" className={buttonClass("primary")} disabled={selected === 0}>
        Download selected ({selected})
      </button>
      <Muted className="text-xs">Only checked rows go into the file.</Muted>
    </>
  );
}
