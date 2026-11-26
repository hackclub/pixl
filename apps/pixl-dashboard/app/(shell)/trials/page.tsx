import type { Metadata } from "next";
import { EmptyNote, Notice, PageHeader, panelDeep } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { serverGet } from "@/lib/server-api";
import { TrialCard, trialsGrid, type TrialQuest } from "./trial-card";

export const metadata: Metadata = { title: "Trials" };

// Read-only, like the old page: Trials unlock by talking to villagers in the
// game; this page shows every Trial's story and reward.
export default async function TrialsPage() {
  const res = await serverGet<{ quests?: TrialQuest[] }>("/api/sidequests");
  const quests = res.ok ? (res.data.quests ?? []) : [];
  const unlocked = quests.filter((q) => q.unlocked).length;
  const pct = quests.length ? (unlocked / quests.length) * 100 : 0;
  const sorted = [...quests].sort((a, b) => Number(!!b.unlocked) - Number(!!a.unlocked));

  return (
    <>
      <PageHeader title="TRIALS" sub="EVERY TRIAL FROM THE VILLAGERS, STORY AND REWARD ON THE CARD.">
        <div className="text-right">
          <div className="mb-[7px] text-[13px] tracking-[1px] text-dim">
            {unlocked} / {quests.length} UNLOCKED
          </div>
          <div className="h-[18px] w-[240px] max-w-[60vw] overflow-hidden border-2 border-stroke bg-panel-deep">
            <div className="h-full bg-gold transition-[width] duration-500 ease-[ease]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </PageHeader>

      {!res.ok ? (
        <Notice tone="bad">
          Couldn&apos;t load trials.
        </Notice>
      ) : sorted.length === 0 ? (
        <EmptyNote>
          NO TRIALS POSTED RIGHT NOW.
          <br />
          THE VILLAGERS ARE THINKING...
        </EmptyNote>
      ) : (
        <>
          <div className={trialsGrid}>
            {sorted.map((q) => (
              <TrialCard key={String(q.id)} q={q} />
            ))}
          </div>
          {sorted.every((q) => q.unlocked) ? null : (
            <div className={cn(panelDeep, "mt-[30px] px-[20px] py-[16px] text-[14px] leading-[1.7] text-dim")}>
              Locked trials are unlocked by talking to the right NPC in the game: wander the village, chat with
              everyone, and their trials open up here.
            </div>
          )}
        </>
      )}
    </>
  );
}
