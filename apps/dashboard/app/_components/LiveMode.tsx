"use client";

import { createContext, useContext } from "react";
import { reviewerName } from "@/lib/liveMode";

// Lets client components (the review queue table, ...) see live mode without
// every page threading a prop through. Mounted once in the root layout; the
// flags themselves are read from cookies on the server (see
// lib/liveModeServer.ts).
const LiveModeContext = createContext({ live: false, hideReviewers: false, viewer: "" });

export function LiveModeProvider({
  live,
  hideReviewers,
  viewer,
  children,
}: {
  live: boolean;
  hideReviewers: boolean;
  viewer: string;
  children: React.ReactNode;
}) {
  return (
    <LiveModeContext.Provider value={{ live, hideReviewers, viewer }}>{children}</LiveModeContext.Provider>
  );
}

export function useLiveMode(): boolean {
  return useContext(LiveModeContext).live;
}

/** reviewerName (lib/liveMode.ts) bound to the current viewer and whether
 * other reviewers' names are hidden right now. */
export function useReviewerName(): (label: string | null | undefined, fallback?: string) => string {
  const { hideReviewers, viewer } = useContext(LiveModeContext);
  return (label, fallback) => reviewerName(label, viewer, hideReviewers, fallback);
}
