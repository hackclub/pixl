import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { config } from "@/app/_generated/config";
import { pageSub, pageTitle } from "@/components/ui/primitives";
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

interface ActiveEvent {
  id?: number | string;
  type: string;
  name: string;
  progress?: number;
  target?: number;
  bonus_pct?: number;
  reward?: number;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "DRAFT",
  shipped: "IN REVIEW",
  approved: "APPROVED",
  needs_changes: "NEEDS WORK",
  rejected: "REJECTED",
};

const TAG_TONE: Record<string, string> = {
  draft: "bg-transparent text-ink border-faint",
  approved: "bg-good text-[#16161e] border-stroke",
  shipped: "bg-gold text-[#16161e] border-stroke",
  needs_changes: "bg-bad text-[#16161e] border-stroke",
  rejected: "bg-bad text-[#16161e] border-stroke",
};

const hoursBig = "font-pixel text-[32px] leading-[1.05] tracking-[.4px] text-ink tabular-nums";
const hoursSub = "mt-1 text-sm leading-[1.4] text-dim";
const panel = "min-w-0 border-2 border-stroke bg-panel";
const panelHTitle = "font-pixel text-base tracking-[.5px] text-ink";
const quiet = "text-[13.5px] leading-[1.5] text-faint";
const rack = "min-w-0 border-2 border-[#4a453d] bg-[#211f1e] px-5 py-4 text-[#ece8e2]";
const rackRule = "border-[#4a453d]";
const rackLabel = "font-pixel text-[11px] uppercase tracking-[.3px] text-[#ece8e2]";
const rackValue = "mt-1 font-sans text-[22px] font-bold leading-[1.15] tabular-nums text-[#ece8e2]";
const rackSub = "mt-1 text-sm leading-[1.35] text-[#b3ada2]";

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
  const [wallet, projectsResp, notifsResp, htResp, questsResp, eventsResp] = await Promise.all([
    serverApi<Wallet>("/api/profile/wallet"),
    serverApi<{ projects: Project[] }>("/api/projects"),
    serverApi<{ notifications: Notification[] }>("/api/notifications"),
    serverApi<{ stats: HackatimeStats | null }>("/api/hackatime/stats"),
    serverApi<{ quests: Trial[] }>("/api/sidequests"),
    serverApi<{ events: ActiveEvent[] }>("/api/events/active"),
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
  const activeEvents = (eventsResp?.events ?? []).filter((event) => event && String(event.name || "").trim());

  return (
    <>
      <h1 className={pageTitle}>OVERVIEW</h1>
      <div className={pageSub}>Where you&apos;re at, and what to do next.</div>

      {activeEvents.length > 0 ? (
        <section
          aria-label="Active Pixl events"
          className="mt-4 flex min-w-0 flex-wrap items-start gap-3 border-2 border-stroke bg-gold px-3 py-2.5 text-ink"
        >
          <Image src="/img/pixl-ui/pixel_sparkle.png" alt="" aria-hidden width={16} height={16} className="mt-1 size-4 shrink-0 [image-rendering:pixelated]" />
          <span className="shrink-0 pt-0.5 font-pixel text-[11px] tracking-[.5px]">LIVE</span>
          <div className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1 text-sm leading-[1.45]">
            {activeEvents.map((event) => {
              let summary = "";
              if (event.type === "community_goal" && Number(event.target) > 0) {
                summary = `${Math.max(0, Math.round(Number(event.progress) || 0))}/${Math.round(Number(event.target))} ships`;
                if (Number.isFinite(Number(event.bonus_pct))) summary += ` · +${Math.max(0, Math.round(Number(event.bonus_pct)))}% RE`;
              } else if (event.type === "bounty" && Number(event.reward) > 0) {
                summary = `+${Math.round(Number(event.reward)).toLocaleString()} PX bounty`;
              }
              return (
                <span key={event.id ?? event.name} className="min-w-0 break-words">
                  <strong className="font-bold">{event.name}</strong>{summary ? ` · ${summary}` : ""}
                </span>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="mt-[22px] grid grid-cols-[minmax(0,1.65fr)_minmax(260px,.85fr)] items-stretch gap-4 max-[1000px]:grid-cols-1">
        <section className={cn(panel, "border-t-[3px] border-t-gold")} aria-label="Next step and tracked hours">
          <Link
            className="group block min-w-0 px-5 py-4 text-ink no-underline hover:bg-panel-2 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-accent"
            href={step.href}
          >
            <span className="flex min-w-0 items-start justify-between gap-4">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 font-pixel text-[11px] uppercase tracking-[.8px] text-ink">
                  <i aria-hidden className="size-2 shrink-0 border border-stroke bg-gold" />
                  Next up
                </span>
                <span className="mt-1 block break-words font-pixel text-[19px] leading-[1.25] tracking-[.2px] text-ink">{step.h}</span>
                <span className="mt-2 block break-words text-[15px] leading-[1.45] text-dim">{step.s}</span>
              </span>
              <span className="inline-flex shrink-0 border-2 border-stroke bg-gold px-4 py-[10px] font-pixel text-xs tracking-[.5px] text-ink uppercase group-hover:bg-gold-soft">
                {step.b}
              </span>
            </span>
          </Link>

          <div className="mx-5 mb-5 border-t-2 border-stroke pt-4">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="min-w-0">
                <div className={hoursBig}>{formatHours(secs)}</div>
                <div className={hoursSub}>{linked ? `tracked on ${linked.name}` : "tracked across shipped projects"}</div>
              </div>
              <div className="min-w-0 text-right">
                <div className="font-pixel text-2xl leading-[1.2] tracking-[.3px] text-ink">
                  {need ? `${need}H GOAL` : "SHIPPED"}
                </div>
                <div className={hoursSub}>
                  {need ? (hours >= need ? "goal reached" : `${Math.ceil(need - hours)}h remaining`) : "tracked hours"}
                </div>
              </div>
            </div>
            <div
              role="progressbar"
              aria-label={need ? "Trial hours progress" : "Tracked project hours"}
              aria-valuemin={0}
              aria-valuemax={need || Math.max(hours, 1)}
              aria-valuenow={need ? Math.min(hours, need) : hours}
              className="mt-3 h-[14px] overflow-hidden border border-stroke bg-panel-deep"
            >
              <div className="h-full bg-gold transition-[width] duration-500" style={{ width: `${need ? pct : 100}%` }} />
            </div>
            <div className="mt-2 flex justify-between gap-2 text-xs tabular-nums text-dim">
              <span>0h</span>
              <span>{need ? `${need}h goal` : `${formatHours(secs)} tracked`}</span>
            </div>
          </div>
        </section>

        <aside className={rack} aria-labelledby="player-status-heading">
          <h2 id="player-status-heading" className="mb-3 border-b border-[#4a453d] pb-3 font-pixel text-base tracking-[.6px]">
            PLAYER STATUS
          </h2>
          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            <div className={cn("min-w-0 border-b pb-3", rackRule)}>
              <div className={cn("flex min-w-0 items-center gap-2", rackLabel)}>
                <Image src="/img/pixel_currency.png" alt="" aria-hidden width={14} height={14} className="size-[14px] shrink-0 [image-rendering:pixelated]" />
                <span>Pixels</span>
              </div>
              <div className={cn(rackValue, "text-gold")}>{Math.round(wallet?.pixels ?? 0).toLocaleString()}</div>
              <div className={rackSub}>Spendable in the shop</div>
            </div>
            <div className={cn("min-w-0 border-b pb-3", rackRule)}>
              <div className={cn("flex min-w-0 items-center gap-2", rackLabel)}>
                <Image src="/img/pixl-ui/icon_beacon.png" alt="" aria-hidden width={14} height={14} className="size-[14px] shrink-0 [image-rendering:pixelated]" />
                <span className="break-words">Restoration Energy</span>
              </div>
              <div className={cn(rackValue, "text-[#5fc2cd]")}>{Math.round(re).toLocaleString()}</div>
              <div className={rackSub}>Lifetime, never spent</div>
            </div>
            <div className={cn("col-span-2 min-w-0 border-b pb-3", rackRule)}>
              <div className={cn("flex items-center gap-2", rackLabel)}>
                <Image src="/img/pixl-ui/icon_check.png" alt="" aria-hidden width={14} height={14} className="size-[14px] shrink-0 [image-rendering:pixelated]" />
                <span>Approved hours</span>
              </div>
              <div className={rackValue}>{Math.round(wallet?.approvedHours ?? 0).toLocaleString()}</div>
              <div className={rackSub}>Signed off by a reviewer</div>
            </div>
          </div>
          <div className="mt-3 border-t-2 border-[#4a453d] pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="font-pixel text-base tracking-[.2px]">LEVEL {level}</span>
              <span className="text-right text-sm tabular-nums text-[#b3ada2]">
                {level >= maxLevel ? "max level" : `${Math.max(0, Math.ceil(nextAt - re))} RE to level ${level + 1}`}
              </span>
            </div>
            <div className="mt-3 flex gap-1" aria-label={`Level ${level} progress`}>
              {cells.map((on, i) => (
                <i key={i} aria-hidden className={cn("h-2.5 min-w-0 flex-1 border", on ? "border-gold bg-gold" : "border-[#4a453d] bg-[#2a2724]")} />
              ))}
            </div>
          </div>
        </aside>
      </div>

      <div className="mt-4 grid grid-cols-2 items-stretch gap-4 max-[760px]:grid-cols-1">
        <section className={cn(panel, "px-5 py-4")} aria-labelledby="your-projects-heading">
          <div className="mb-3 flex items-center justify-between gap-2 border-b border-[color-mix(in_srgb,var(--stroke)_35%,transparent)] pb-2">
            <h2 id="your-projects-heading" className={panelHTitle}>YOUR PROJECTS</h2>
            <Link href="/projects" className="shrink-0 text-sm text-ink underline decoration-gold underline-offset-[3px] hover:decoration-accent">
              All projects
            </Link>
          </div>
          <div className="flex flex-col">
            {list.length === 0 ? (
              <div className={cn(quiet, "py-2")}>Nothing here yet. Your first project starts on the projects page.</div>
            ) : (
              list.slice(0, 5).map((p, i) => (
                  <Link
                    key={i}
                    className="group flex min-w-0 items-center justify-between gap-3 border-b border-[color-mix(in_srgb,var(--stroke)_35%,transparent)] px-1.5 py-2 no-underline first:border-t first:border-[color-mix(in_srgb,var(--stroke)_35%,transparent)] hover:bg-panel-2"
                    href="/projects"
                  >
                    <span className="min-w-0 flex-1 break-words text-sm text-ink">{p.name || "Untitled"}</span>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 border-2 px-2 py-1 font-pixel text-[10px] tracking-[.4px]",
                        TAG_TONE[p.status],
                      )}
                    >
                      <i aria-hidden className="size-1.5 bg-current" />
                      {STATUS_LABEL[p.status] ?? String(p.status ?? "").toUpperCase()}
                    </span>
                  </Link>
              ))
            )}
          </div>
        </section>
        <section className={cn(panel, "px-5 py-4")} aria-labelledby="recent-heading">
          <div className="mb-3 flex items-center justify-between gap-2 border-b border-[color-mix(in_srgb,var(--stroke)_35%,transparent)] pb-2">
            <h2 id="recent-heading" className={panelHTitle}>RECENT</h2>
          </div>
          <div className="flex flex-col gap-2.5">
            {recent.length === 0 ? (
              <div className={quiet}>Nothing yet. Approvals, invites and orders show up here.</div>
            ) : (
              recent.map((n, i) => (
                <div key={i} className="flex min-w-0 items-start justify-between gap-3 text-sm leading-[1.45] text-dim">
                  <span
                    className={cn(
                      "mt-[5px] inline-block size-1.5 shrink-0 border border-stroke",
                      n.read ? "bg-stroke" : "bg-gold",
                    )}
                  />
                  <span className="min-w-0 flex-1 break-words">{n.body || n.title || ""}</span>
                  <span className="shrink-0 whitespace-nowrap text-xs text-faint">{timeAgo(n.created_at)}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <nav aria-label="Dashboard guides" className="mt-4 grid grid-cols-4 border-y border-[color-mix(in_srgb,var(--stroke)_35%,transparent)] max-[760px]:grid-cols-2 max-[420px]:grid-cols-1">
        <Link href="/docs/first-project" className="border-l border-[color-mix(in_srgb,var(--stroke)_35%,transparent)] px-3 py-3 no-underline first:border-l-0 hover:bg-panel-2 max-[420px]:border-l-0 max-[420px]:border-t max-[420px]:first:border-t-0">
          <span className="block font-pixel text-[11px] tracking-[.4px] text-ink">FIRST PROJECT</span>
          <span className="mt-1 block text-sm leading-[1.45] text-dim">The whole loop, start to finish</span>
        </Link>
        <Link href="/docs/shipping" className="border-l border-[color-mix(in_srgb,var(--stroke)_35%,transparent)] px-3 py-3 no-underline hover:bg-panel-2 max-[420px]:border-l-0 max-[420px]:border-t">
          <span className="block font-pixel text-[11px] tracking-[.4px] text-ink">SHIP RULES</span>
          <span className="mt-1 block text-sm leading-[1.45] text-dim">What the submit button checks</span>
        </Link>
        <Link href="/docs/energy" className="border-l border-[color-mix(in_srgb,var(--stroke)_35%,transparent)] px-3 py-3 no-underline hover:bg-panel-2 max-[420px]:border-l-0 max-[420px]:border-t">
          <span className="block font-pixel text-[11px] tracking-[.4px] text-ink">RE &amp; LEVELS</span>
          <span className="mt-1 block text-sm leading-[1.45] text-dim">How your rate actually works</span>
        </Link>
        <Link href="/explore" className="border-l border-[color-mix(in_srgb,var(--stroke)_35%,transparent)] px-3 py-3 no-underline hover:bg-panel-2 max-[420px]:border-l-0 max-[420px]:border-t">
          <span className="block font-pixel text-[11px] tracking-[.4px] text-ink">EXPLORE</span>
          <span className="mt-1 block text-sm leading-[1.45] text-dim">See what others shipped</span>
        </Link>
      </nav>
    </>
  );
}
