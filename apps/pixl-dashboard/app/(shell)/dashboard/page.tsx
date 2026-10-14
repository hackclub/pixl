import type { Metadata } from "next";
import Link from "next/link";
import { config } from "@/app/_generated/config";
import { buttonVariants, card, pageSub, pageTitle, rbar, rbarFill } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { serverApi } from "@/lib/server-api";
import {
  barTrial,
  formatHours,
  levelBarCells,
  linkedSeconds,
  nextStep,
  shippedSeconds,
  type HackatimeStats,
  type Project,
  type Trial,
} from "./lib";

const TITLE = "Pixl · Dashboard";
const DESCRIPTION = "Your Pixl status at a glance: level, Pixels, Restoration Energy and what's next.";
const URL = `${config.urls.site}/dashboard`;
const IMAGE = `${config.urls.site}/dashboard/og.png`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: URL },
  openGraph: {
    type: "website",
    siteName: "Pixl",
    title: TITLE,
    description: DESCRIPTION,
    url: URL,
    images: [{ url: IMAGE, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [IMAGE],
  },
};

interface Wallet {
  pixels: number;
  re: number;
  approvedHours: number;
  level: number;
  reForNextLevel: number;
  maxLevel: number;
  /** Not sent by apps/server yet; when it is, the level bar measures within the current level. */
  reForCurrentLevel?: number;
}
interface Notification {
  body?: string;
  title?: string;
  read: boolean;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "DRAFT",
  shipped: "IN REVIEW",
  approved: "APPROVED",
  needs_changes: "NEEDS WORK",
  rejected: "REJECTED",
};

const TAG_TONE: Record<string, string> = {
  approved: "text-teal border-[color-mix(in_srgb,var(--teal)_45%,var(--stroke))]",
  shipped: "text-gold border-[color-mix(in_srgb,var(--gold)_45%,var(--stroke))]",
  needs_changes: "text-[#ff8b8b] border-[rgba(255,139,139,.4)]",
};

const hoursCard = cn(card, "mt-[22px] px-[22px] pt-5 pb-[15px]");
const hoursTop = "mb-[13px] flex flex-wrap items-start justify-between gap-[18px]";
const hoursBig = "font-pixel text-[42px] leading-none tracking-[1px] text-ink";
const hoursSub = "mt-[7px] font-sans text-[13px] tracking-normal text-faint";
const stat = cn(card, "px-[18px] py-4");
const statK = "font-pixel text-[11px] uppercase tracking-[1px] text-faint";
const statV = "mt-1.5 font-sans text-[26px] font-bold leading-[1.1] tabular-nums text-ink";
const statS = "mt-[5px] text-[12.5px] text-faint";
const box = cn(card, "px-5 py-[18px]");
const panelH = "mb-3 flex items-center justify-between gap-2.5";
const panelHTitle = "font-pixel text-sm tracking-[.5px] text-ink";
const quiet = "text-[13.5px] text-faint";
const linkTile = cn(
  "block border-2 border-stroke bg-panel px-[15px] py-[13px] no-underline",
  "transition-[border-color,background-color] duration-[130ms] hover:border-gold hover:bg-panel-2",
);
const linkK = "font-pixel text-[13px] tracking-[.4px] text-ink";
const linkS = "mt-1 text-xs leading-[1.45] text-faint";

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!isFinite(s)) return "";
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default async function DashboardPage() {
  const [wallet, projectsResp, notifsResp, htResp, questsResp] = await Promise.all([
    serverApi<Wallet>("/api/profile/wallet"),
    serverApi<{ projects: Project[] }>("/api/projects"),
    serverApi<{ notifications: Notification[] }>("/api/notifications"),
    serverApi<{ stats: HackatimeStats | null }>("/api/hackatime/stats"),
    serverApi<{ quests: Trial[] }>("/api/sidequests"),
  ]);

  const list = (projectsResp?.projects ?? []).filter((p) => p.is_owner !== false);
  const trials = (questsResp?.quests ?? []).filter((q) => q.unlocked && !q.completed);
  const htStats = htResp?.stats ?? null;
  const step = nextStep(list);
  const trial = barTrial(trials, list);
  const linked = trial ? list.find((p) => Number(p.sidequest_id) === Number(trial.id)) : null;
  const need = trial?.min_hours != null ? Number(trial.min_hours) : 0;
  const secs = linked ? linkedSeconds(linked, htStats) : shippedSeconds(list, htStats);
  const hours = secs / 3600;
  const pct = need ? Math.max(0, Math.min(100, (hours / need) * 100)) : 0;

  const level = wallet?.level ?? 0;
  const nextAt = wallet?.reForNextLevel ?? 0;
  const re = wallet?.re ?? 0;
  const maxLevel = wallet?.maxLevel ?? 100;
  const cells = levelBarCells(re, nextAt, wallet?.reForCurrentLevel ?? 0);

  const recent = (notifsResp?.notifications ?? []).slice(0, 5);

  return (
    <>
      <h1 className={pageTitle}>OVERVIEW</h1>
      <div className={pageSub}>Where you&apos;re at, and what to do next.</div>

      <Link
        className={cn(
          card,
          "mt-[22px] flex flex-wrap items-center justify-between gap-[18px] border-l-[3px] border-l-gold px-[22px] py-5",
        )}
        href={step.href}
      >
        <span className="flex min-w-[240px] flex-1 flex-col">
          <span className="mb-[5px] font-pixel text-xs uppercase tracking-[1px] text-gold">Next up</span>
          <span className="font-pixel text-[19px] tracking-[.3px] text-ink">{step.h}</span>
          <span className="mt-1.5 text-sm leading-[1.55] text-dim">{step.s}</span>
        </span>
        <span className={buttonVariants()}>{step.b}</span>
      </Link>

      {need ? (
        <div className={hoursCard}>
          <div className={hoursTop}>
            <div>
              <div className={hoursBig}>{formatHours(secs)}</div>
              <div className={hoursSub}>{linked ? `on ${linked.name}` : "no project on this Trial yet"}</div>
            </div>
            <div>
              <div className="text-right font-pixel text-[27px] leading-[1.15] tracking-[1px] text-gold">{need}H TO SHIP</div>
              <div className={hoursSub}>{trial!.name}</div>
            </div>
          </div>
          <div className={rbar}>
            <i className={rbarFill("gold")} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-[7px] flex justify-between font-pixel text-xs text-faint">
            <span>0</span>
            <span>{Math.round(need / 4)}</span>
            <span>{Math.round(need / 2)}</span>
            <span>{Math.round((need * 3) / 4)}</span>
            <span>{need}</span>
          </div>
        </div>
      ) : (
        <div className={hoursCard}>
          <div className={hoursTop}>
            <div>
              <div className={hoursBig}>{formatHours(secs)}</div>
              <div className={hoursSub}>
                shipped so far{trial ? ` · ${trial.name} has no minimum` : ""}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-[22px] grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3.5">
        <div className={stat}>
          <div className={statK}>Pixels</div>
          <div className={cn(statV, "text-gold")}>{Math.round(wallet?.pixels ?? 0).toLocaleString()}</div>
          <div className={statS}>to spend in the shop</div>
        </div>
        <div className={stat}>
          <div className={statK}>Restoration Energy</div>
          <div className={cn(statV, "text-teal")}>{Math.round(re).toLocaleString()}</div>
          <div className={statS}>lifetime, never spent</div>
        </div>
        <div className={stat}>
          <div className={statK}>Approved hours</div>
          <div className={statV}>{Math.round(wallet?.approvedHours ?? 0).toLocaleString()}</div>
          <div className={statS}>signed off by a reviewer</div>
        </div>
      </div>

      <div className={cn(card, "mt-[22px] px-5 py-[18px]")}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-pixel text-[17px] tracking-[.3px] text-ink">LEVEL {level}</span>
          <span className="text-[12.5px] tabular-nums text-faint">
            {level >= maxLevel ? "max level" : `${Math.max(0, Math.ceil(nextAt - re))} RE to level ${level + 1}`}
          </span>
        </div>
        <div className="mt-3 flex gap-[3px]">
          {cells.map((on, i) => (
            <i key={i} className={cn("h-2.5 flex-1 border-2", on ? "border-gold bg-gold" : "border-stroke bg-panel-2")} />
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 max-[760px]:grid-cols-1">
        <section className={box}>
          <div className={panelH}>
            <b className={panelHTitle}>YOUR PROJECTS</b>
            <Link href="/projects" className="text-[12.5px] text-gold no-underline hover:text-gold hover:underline">
              All projects
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            {list.length === 0 ? (
              <div className={quiet}>Nothing here yet. Your first project starts on the projects page.</div>
            ) : (
              list.slice(0, 5).map((p, i) => {
                return (
                  <Link
                    key={i}
                    className="flex items-center gap-2.5 border-2 border-stroke bg-panel-2 px-[11px] py-[9px] no-underline hover:border-gold"
                    href="/projects"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.name || "Untitled"}</span>
                    <span
                      className={cn(
                        "shrink-0 border-2 border-stroke px-[7px] py-[3px] font-pixel text-[10.5px] tracking-[.5px] text-faint",
                        TAG_TONE[p.status],
                      )}
                    >{STATUS_LABEL[p.status] ?? String(p.status ?? "").toUpperCase()}</span>
                  </Link>
                );
              })
            )}
          </div>
        </section>
        <section className={box}>
          <div className={panelH}>
            <b className={panelHTitle}>RECENT</b>
          </div>
          <div className="flex flex-col gap-2.5">
            {recent.length === 0 ? (
              <div className={quiet}>Nothing yet. Approvals, invites and orders show up here.</div>
            ) : (
              recent.map((n, i) => (
                <div key={i} className="flex gap-2.5 text-[13.5px] leading-normal text-dim">
                  <span
                    className={cn(
                      "mt-1.5 inline-block size-1.5 shrink-0 border border-stroke",
                      n.read ? "bg-stroke" : "bg-gold",
                    )}
                  />
                  <span>{n.body || n.title || ""}</span>
                  <span className="whitespace-nowrap text-xs text-faint">{timeAgo(n.created_at)}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
        <Link href="/docs/first-project" className={linkTile}>
          <span className={linkK}>FIRST PROJECT</span>
          <span className={linkS}>The whole loop, start to finish</span>
        </Link>
        <Link href="/docs/shipping" className={linkTile}>
          <span className={linkK}>SHIP RULES</span>
          <span className={linkS}>What the submit button checks</span>
        </Link>
        <Link href="/docs/energy" className={linkTile}>
          <span className={linkK}>RE &amp; LEVELS</span>
          <span className={linkS}>How your rate actually works</span>
        </Link>
        <Link href="/trials" className={linkTile}>
          <span className={linkK}>TRIALS</span>
          <span className={linkS}>What the villagers want built</span>
        </Link>
      </div>
    </>
  );
}
