"use client";

import type { ReactNode } from "react";

// Native checkboxes for the players table's mass action form. RowSelect
// submits as userIds; SelectAllBox ticks every row on the current page.

export function SelectAllBox({ children }: { children?: ReactNode }) {
  return (
    <label className="hc-check">
      <input
        type="checkbox"
        aria-label="Select all on this page"
        onChange={(e) => {
          for (const el of document.querySelectorAll<HTMLInputElement>("input[data-row-select]")) {
            el.checked = e.currentTarget.checked;
          }
        }}
      />
      {children}
    </label>
  );
}

export function RowSelect({ id, label, name = "userIds" }: { id: string; label: string; name?: string }) {
  return (
    <label className="hc-check">
      <input type="checkbox" name={name} value={id} aria-label={label} data-row-select />
    </label>
  );
}
