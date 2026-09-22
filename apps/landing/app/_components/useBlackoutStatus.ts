"use client";

import { useCallback, useEffect, useState } from "react";

export interface BlackoutOperation {
  slug: string;
  name: string;
  status: "upcoming" | "active" | "paused" | "ended";
  startsAt: string;
  briefingUnlocked: boolean;
  endsAt?: string;
  rateUsd?: number;
  gracePeriodHours?: number;
  power?: {
    approvedHours: number;
    approvedProjects: number;
    participants: number;
    powerUnits: number;
  };
}

export interface BlackoutBriefingCopy {
  intro: string;
  rules: { title: string; body: string }[];
}

export interface BlackoutState {
  loaded: boolean;
  operation: BlackoutOperation | null;
  briefing: BlackoutBriefingCopy | null;
  refresh: () => void;
}

export function useBlackoutStatus(lang: string): BlackoutState {
  const [state, setState] = useState<Omit<BlackoutState, "refresh">>({
    loaded: false,
    operation: null,
    briefing: null,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/blackout?lang=${encodeURIComponent(lang)}`)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<{
          operation: BlackoutOperation | null;
          briefing?: BlackoutBriefingCopy;
        }>;
      })
      .then((data) => {
        if (!cancelled)
          setState({ loaded: true, operation: data.operation, briefing: data.briefing ?? null });
      })
      .catch(() => {
        if (!cancelled) setState({ loaded: true, operation: null, briefing: null });
      });
    return () => {
      cancelled = true;
    };
  }, [lang, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, refresh };
}
