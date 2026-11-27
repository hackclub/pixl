"use client";

import { useEffect, useRef, useState } from "react";

// Fulfillers want the email on their clipboard (to paste into a vendor's
// checkout) far more often than they want to open their mail client, so the
// email in Shipping info copies instead of linking to mailto:.
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back for plain http/local.
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  }
}

export function CopyEmail({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function onClick() {
    if (!(await copyText(email))) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        title="Copy email address"
        className="hc-link cursor-pointer bg-transparent p-0 text-left font-[inherit]"
      >
        {email}
      </button>
      {copied && (
        <span className="hc-caption text-xs" role="status">
          Copied
        </span>
      )}
    </span>
  );
}
