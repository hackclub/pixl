"use client";

import type { ReactNode } from "react";

// TEMPORARY, delete with app/results-preview. Patches fetch for /api/results
// so the results hero can be previewed before the server endpoint is
// deployed. The numbers are a prod snapshot from 2026-11-20.
let patched = false;
function patchFetch() {
  if (patched || typeof window === "undefined") return;
  patched = true;
  const real = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/results")) {
      return Promise.resolve(
        Response.json({
          ok: true,
          users: 3644,
          projectsCreated: 1847,
          projectsShipped: 266,
          hoursShipped: 3135,
          rewardsUsd: 11661,
        }),
      );
    }
    return real(input, init);
  }) as typeof fetch;
}

export function MockResults({ children }: { children: ReactNode }) {
  // Runs during render, before the child's effect fires its first fetch.
  patchFetch();
  return <>{children}</>;
}
