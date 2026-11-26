import type { ReactNode } from "react";
import { serverApi } from "@/lib/server-api";
import { economy } from "../calc/economy";
import { loadTrials } from "./data";
import { HackatimeReturnNotice } from "./_components/hackatime-notice";
import { activeTrial, type TourTrial } from "./_tour/steps";
import { TourProvider } from "./_tour/tour-provider";

// Wraps every /projects page so the guided tours survive client-side hops
// between the list, /projects/new and a project editor.
export default async function ProjectsLayout({ children }: { children: ReactNode }) {
  const [ob, trials] = await Promise.all([
    serverApi<{ ok?: boolean; done?: boolean }>("/api/profile/onboarding"),
    loadTrials(),
  ]);
  const t = activeTrial(trials as Array<(typeof trials)[number] & { unlocked_at?: string | null }>);
  // Only the fields the tour copy shows leave the server.
  const trial: TourTrial | null = t
    ? {
        id: Number(t.id),
        name: String(t.name ?? "").slice(0, 120),
        description: String(t.description ?? "").slice(0, 600),
        region: t.region ? String(t.region).slice(0, 60) : null,
        reward: t.reward ? String(t.reward).slice(0, 200) : null,
      }
    : null;

  return (
    <TourProvider
      onboarding={ob?.ok ? { done: ob.done === true } : null}
      trial={trial}
      basePxPerHour={Math.round(economy.basePayoutUsd / economy.pixelValueUsd)}
    >
      <HackatimeReturnNotice />
      {children}
    </TourProvider>
  );
}
