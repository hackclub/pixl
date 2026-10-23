"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon, buttonClass } from "@/app/_ui/ui";

// Human "2m ago" style, coarse enough that the first client tick a few seconds
// after hydration doesn't rewrite the text while someone is reading it.
function elapsedLabel(ms: number): string {
  if (ms < 60_000) return "active just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `active ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `active ${hrs}h ${mins % 60}m ago`;
}

function remainingLabel(ms: number): string {
  if (ms <= 0) return "claim is free";
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return `${mins}m left`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m left`;
}

// The live part of the claim banner: how long the other reviewer has been on
// the page, how long their claim has left, and a way to retry without a full
// browser reload. `serverNow` seeds the first render so SSR and hydration
// agree; the effect then keeps it fresh.
export function ClaimActivityLine({
  claimedAt,
  expiresAt,
  serverNow,
}: {
  claimedAt: string;
  expiresAt: string;
  serverNow: number;
}) {
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const claimed = new Date(claimedAt).getTime();
  const expires = new Date(expiresAt).getTime();
  const free = Number.isFinite(expires) && expires <= now;

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="inline-flex items-center gap-1.5">
        <Icon glyph="clock" size={15} className="hc-muted" />
        {Number.isFinite(claimed) ? elapsedLabel(Math.max(0, now - claimed)) : "claim is live"}
      </span>
      <span aria-hidden className="hc-muted">
        ·
      </span>
      <span className={free ? "hc-claim-free" : ""}>
        {Number.isFinite(expires) ? remainingLabel(expires - now) : "refreshes while they're here"}
      </span>
    </span>
  );
}

export function ClaimRefreshButton({ label = "Check again" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className={buttonClass("outline", "sm")}
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <Icon glyph="view-reload" size={16} />
      {pending ? "Checking..." : label}
    </button>
  );
}
