import type { Metadata } from "next";
import { pageSub, pageTitle } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { serverApi } from "@/lib/server-api";
import { CalcForm, ProjectPicker, type CalcInputs, type ProjectOption } from "./calc-form";
import { TIERS, clampHours, clampTier, combinedStats, economy, parseRows, payoutStats, type PayoutStats } from "./economy";

export const metadata: Metadata = { title: "Payout calculator" };

interface Project {
  id: string | number;
  name: string;
  status?: string;
  level?: number | null;
  approved_hours?: number | null;
  rejected_at?: string | null;
}

type Search = { rows?: string; hours?: string; tier?: string; base?: string; project?: string };

const out = "border-2 border-stroke bg-panel-2 px-[18px] py-4";
const outK = "font-pixel text-[11px] uppercase tracking-[1px] text-faint";
const outV = "mt-1.5 overflow-hidden font-sans text-2xl font-bold leading-[1.1] tabular-nums text-ink";

function Stats({ s }: { s: PayoutStats }) {
  return (
    <div className="mt-[22px] grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3.5">
      <div className={out}>
        <div className={outK}>Pixels</div>
        <div className={cn(outV, "text-gold")}>{s.px.toLocaleString("en-US")}</div>
      </div>
      <div className={out}>
        <div className={outK}>RE Earned</div>
        <div className={cn(outV, "text-teal")}>{s.re.toLocaleString("en-US")} RE</div>
      </div>
      <div className={out}>
        <div className={outK}>Avg $/hr</div>
        <div className={outV}>{s.avgUsdPerHour === null ? "-" : `$${s.avgUsdPerHour.toFixed(2)}`}</div>
      </div>
    </div>
  );
}

const calcCard = "relative mt-[22px] border-2 border-stroke bg-panel p-5";
const cardH = "mb-3.5 text-base tracking-[1px] text-gold";
const note = "mt-[18px] text-[12.5px] leading-[1.55] text-faint [&_b]:text-ink";
const miniNote = "mt-2.5 text-[11.5px] leading-normal text-faint opacity-80";
const sticker = "pointer-events-none absolute select-none [image-rendering:pixelated]";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CalcPage({ searchParams }: { searchParams: Promise<Record<keyof Search, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const projectId = /^\d{1,18}$/.test(one(sp.project) ?? "") ? one(sp.project)! : "";

  const [wallet, list, tracked] = await Promise.all([
    serverApi<{ re?: number }>("/api/profile/wallet"),
    serverApi<{ projects?: Project[] }>("/api/projects"),
    projectId ? serverApi<{ trackedSeconds?: number }>(`/api/projects/${projectId}/hours`) : Promise.resolve(null),
  ]);
  const baseRe = wallet ? Number(wallet.re) || 0 : 0;

  // Already-shipped (approved) projects stay in the list: re-shipping one is an
  // update that only pays the hours added since the last approval.
  const mine = list?.projects ?? [];
  const isShipped = (p: Project) => p.status === "approved" && !p.rejected_at;
  const picked = mine.find((p) => String(p.id) === projectId) ?? null;
  const options: ProjectOption[] = mine.map((p) => ({
    id: String(p.id),
    label: `${p.name} · ${TIERS[clampTier(p.level ?? 1) - 1]}${isShipped(p) ? " · shipped, new hours only" : ""}`,
  }));

  // A picked project with hours loaded seeds the inputs from its own tracked
  // hours and tier unless the URL already overrides them.
  const priorHours = picked && isShipped(picked) ? Math.max(Number(picked.approved_hours) || 0, 0) : 0;
  const pickedHours =
    picked && tracked && typeof tracked.trackedSeconds === "number"
      ? Math.max(Math.round((tracked.trackedSeconds / 3600 - priorHours) * 100) / 100, 0)
      : null;
  const pickedTier = picked ? clampTier(picked.level ?? 1) : null;

  // ?rows=h:t,h:t is the combined list; plain ?hours=&tier= (old links) is one row.
  const hoursRaw = one(sp.hours);
  const tierRaw = one(sp.tier);
  let rows = parseRows(one(sp.rows));
  if (!rows.length) {
    rows = [
      {
        hours: hoursRaw !== undefined ? clampHours(hoursRaw) : (pickedHours ?? 10),
        tier: tierRaw !== undefined ? clampTier(tierRaw) : (pickedTier ?? 1),
      },
    ];
  }
  const inputs: CalcInputs = {
    rows,
    base: one(sp.base) === "1" && !!wallet,
    project: picked ? String(picked.id) : "",
  };
  const reBefore = inputs.base ? baseRe : 0;
  const combined = combinedStats(rows, reBefore);
  const stats: PayoutStats = combined;
  const rowSummaries = combined.rows.map((r) => `${r.px.toLocaleString("en-US")} px · ${r.re.toLocaleString("en-US")} RE`);
  const mineStats = picked && pickedHours !== null && pickedTier !== null ? payoutStats(pickedHours, pickedTier, baseRe) : null;

  return (
    <div className="mx-auto max-w-[720px]">
      <section className="relative mt-2 border-2 border-stroke bg-panel px-[26px] py-6 shadow-drop">
        <h1 className={pageTitle}>PAYOUT CALCULATOR</h1>
        <div className={pageSub}>SEE WHAT A SHIP IS WORTH BEFORE YOU SHIP IT.</div>
        {/* eslint-disable @next/next/no-img-element */}
        <img className={cn(sticker, "top-11 right-[90px] z-[1] w-[26px] rotate-24")} src="/img/sticker_currency_gold.png" alt="" />
        <img className={cn(sticker, "-top-5 right-[58px] z-[2] w-[52px] rotate-12")} src="/img/sticker_currency_gold.png" alt="" />
        <img className={cn(sticker, "top-1.5 right-5 z-[3] w-9 -rotate-20")} src="/img/sticker_currency_red.png" alt="" />
        <img className={cn(sticker, "-bottom-[22px] left-[34px] z-[2] w-16 -rotate-10")} src="/img/sticker_blahaj.png" alt="" draggable={false} />
        {/* eslint-enable @next/next/no-img-element */}
      </section>

      {options.length ? (
        <div className={calcCard}>
          <div className={cardH}>PREDICT ONE OF YOUR PROJECTS</div>
          <div className="mt-3.5">
            <div className="mb-1.5 block text-[13px] text-faint">Pick a project</div>
            <ProjectPicker value={inputs.project} options={options} inputs={inputs} />
          </div>
          {picked && !mineStats ? <div className={cn(miniNote, "text-bad opacity-100")}>Couldn&apos;t load that project&apos;s tracked hours.</div> : null}
          {picked && priorHours > 0 && pickedHours !== null ? (
            <div className={miniNote}>
              Already shipped with {priorHours.toLocaleString("en-US")}h approved. Only the {pickedHours.toLocaleString("en-US")}h
              added since then count.
            </div>
          ) : null}
          {mineStats ? <Stats s={mineStats} /> : null}
          <div className={miniNote}>
            This is NOT your final payout. It&apos;s a live prediction off your currently tracked hours, and your hours may
            get deflated on review, which would lower the actual payout.
          </div>
        </div>
      ) : null}

      <div className={calcCard}>
        <div className={cardH}>{rows.length > 1 ? `${rows.length} PROJECTS COMBINED` : "A NEW PROJECT"}</div>
        <div className={cn(note, "mt-0 mb-3.5")}>
          Rate ramps linearly from <b>${economy.basePayoutUsd.toFixed(2)}/hr</b> to{" "}
          <b>${economy.maxPayoutUsd.toFixed(2)}/hr</b>, every {economy.payoutSlopeRe.toLocaleString("en-US")} RE
          earned adds $1/hr.
        </div>
        <CalcForm
          key={`${inputs.project}:${pickedHours ?? ""}`}
          rowSummaries={rowSummaries}
          initial={inputs}
          tiers={TIERS}
          canUseBase={!!wallet}
          baseLabel={wallet ? `${Math.round(baseRe).toLocaleString("en-US")} RE available` : "couldn't load your RE"}
        />
        <Stats s={stats} />
        <div className={note}>
          Computed straight from the same payout formula the server credits with, starting from{" "}
          {reBefore > 0 ? `your ${Math.round(reBefore).toLocaleString("en-US")} RE` : "0 RE"}.
          {rows.length > 1 ? " Projects are paid in the order listed, and each one's RE lifts the rate for the next." : ""} The actual amount still
          depends on the tier and hours a reviewer confirms when your project ships.
        </div>
      </div>
    </div>
  );
}
