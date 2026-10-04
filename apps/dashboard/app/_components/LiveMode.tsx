"use client";

import { createContext, useContext } from "react";

// Lets client components under /review (the queue table) see live mode without
// every page threading a prop through. The flag itself is read from the cookie
// on the server (see getLiveMode in lib/liveModeServer.ts).
const LiveModeContext = createContext(false);

export function LiveModeProvider({ live, children }: { live: boolean; children: React.ReactNode }) {
  return <LiveModeContext.Provider value={live}>{children}</LiveModeContext.Provider>;
}

export function useLiveMode(): boolean {
  return useContext(LiveModeContext);
}
