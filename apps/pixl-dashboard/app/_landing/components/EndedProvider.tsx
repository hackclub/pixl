"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { submissionDeadline } from "@/app/_generated/config";

export interface Results {
  users: number;
  projectsCreated: number;
  projectsShipped: number;
  hoursShipped: number;
  rewardsUsd: number;
}

interface EndedState {
  /** True once the submission deadline in packages/config/pixl.json has passed. */
  ended: boolean;
  /** The five program totals, null until fetched (or if the fetch failed). */
  results: Results | null;
}

const EndedContext = createContext<EndedState>({ ended: false, results: null });

const REFRESH_MS = 60_000;

// The landing page is statically generated, so the "Pixl has ended" state is
// decided in the browser: it starts as not ended (matching the static HTML, so
// hydration is clean) and flips as soon as the clock passes the deadline, also
// for visitors who open the page afterwards. Once ended, the five totals are
// read through this app's own /api/results route and refreshed every minute,
// so late reviews keep moving them. `forceEnded` is for previews only.
export function EndedProvider({ children, forceEnded = false }: { children: ReactNode; forceEnded?: boolean }) {
  const [ended, setEnded] = useState(false);
  const [results, setResults] = useState<Results | null>(null);

  useEffect(() => {
    if (forceEnded) {
      setEnded(true);
      return;
    }
    const deadline = submissionDeadline.getTime();
    if (Date.now() >= deadline) {
      setEnded(true);
      return;
    }
    const id = setInterval(() => {
      if (Date.now() >= deadline) {
        setEnded(true);
        clearInterval(id);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [forceEnded]);

  useEffect(() => {
    if (!ended) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/results");
        if (!res.ok) return;
        const json = (await res.json()) as Results & { ok: boolean };
        if (!cancelled && json.ok) setResults(json);
      } catch {
        // Keep whatever we last had; the stats just stay as they were.
      }
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ended]);

  return <EndedContext.Provider value={{ ended, results }}>{children}</EndedContext.Provider>;
}

export function useEnded(): EndedState {
  return useContext(EndedContext);
}
