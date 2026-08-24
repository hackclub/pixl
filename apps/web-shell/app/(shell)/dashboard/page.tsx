import type { Metadata } from "next";
import Link from "next/link";
import { config } from "@/app/_generated/config";
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
import "./dashboard.css";

const TITLE = "Pixl · Dashboard";
const DESCRIPTION = "Your Pixl status at a glance: level, Pixels, Restoration Energy and what's next.";
const URL = `${config.urls.site}/dashboard/`;
const IMAGE = `${URL}og.png`;

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
  const cells = levelBarCells(config.economy.levelBands, re, level, nextAt);

  const recent = (notifsResp?.notifications ?? []).slice(0, 5);

  return (
    <>
      <h1 className="page-title">OVERVIEW</h1>
      <div className="page-sub">Where you&apos;re at, and what to do next.</div>

      <Link className="next card panel" href={step.href}>
        <span className="next-txt">
          <span className="next-k">Next up</span>
          <span className="next-h">{step.h}</span>
          <span className="next-s">{step.s}</span>
        </span>
        <span className="btn">{step.b}</span>
      </Link>

      {need ? (
        <div className="hours card panel">
          <div className="hours-top">
            <div>
              <div className="hours-big">{formatHours(secs)}</div>
              <div className="hours-sub">{linked ? `on ${linked.name}` : "no project on this Trial yet"}</div>
            </div>
            <div>
              <div className="hours-goal">{need}H TO SHIP</div>
              <div className="hours-sub">{trial!.name}</div>
            </div>
          </div>
          <div className="rbar gold">
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="hours-ticks">
            <span>0</span>
            <span>{Math.round(need / 4)}</span>
            <span>{Math.round(need / 2)}</span>
            <span>{Math.round((need * 3) / 4)}</span>
            <span>{need}</span>
          </div>
        </div>
      ) : (
        <div className="hours card panel">
          <div className="hours-top">
            <div>
              <div className="hours-big">{formatHours(secs)}</div>
              <div className="hours-sub">
                shipped so far{trial ? ` · ${trial.name} has no minimum` : ""}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="stat-row">
        <div className="stat card panel">
          <div className="stat-k">Pixels</div>
          <div className="stat-v gold">{Math.round(wallet?.pixels ?? 0).toLocaleString()}</div>
          <div className="stat-s">to spend in the shop</div>
        </div>
        <div className="stat card panel">
          <div className="stat-k">Restoration Energy</div>
          <div className="stat-v teal">{Math.round(re).toLocaleString()}</div>
          <div className="stat-s">lifetime, never spent</div>
        </div>
        <div className="stat card panel">
          <div className="stat-k">Approved hours</div>
          <div className="stat-v">{Math.round(wallet?.approvedHours ?? 0).toLocaleString()}</div>
          <div className="stat-s">signed off by a reviewer</div>
        </div>
      </div>

      <div className="lvl card panel">
        <div className="lvl-top">
          <span className="lvl-n">LEVEL {level}</span>
          <span className="lvl-next">
            {level >= maxLevel ? "max level" : `${Math.max(0, Math.ceil(nextAt - re))} RE to level ${level + 1}`}
          </span>
        </div>
        <div className="lvl-bar">
          {cells.map((on, i) => (
            <i key={i} className={on ? "on" : ""} />
          ))}
        </div>
      </div>

      <div className="cols">
        <section className="box card panel">
          <div className="panel-h">
            <b>YOUR PROJECTS</b>
            <Link href="/projects/">All projects</Link>
          </div>
          <div className="plist">
            {list.length === 0 ? (
              <div className="quiet">Nothing here yet. Your first project starts on the projects page.</div>
            ) : (
              list.slice(0, 5).map((p, i) => {
                const cls = ["approved", "shipped", "needs_changes"].includes(p.status) ? p.status : "";
                return (
                  <Link key={i} className="prow" href="/projects/">
                    <span className="nm">{p.name || "Untitled"}</span>
                    <span className={`tag ${cls}`}>{STATUS_LABEL[p.status] ?? String(p.status ?? "").toUpperCase()}</span>
                  </Link>
                );
              })
            )}
          </div>
        </section>
        <section className="box card panel">
          <div className="panel-h">
            <b>RECENT</b>
          </div>
          <div className="nlist">
            {recent.length === 0 ? (
              <div className="quiet">Nothing yet. Approvals, invites and orders show up here.</div>
            ) : (
              recent.map((n, i) => (
                <div key={i} className={`nrow ${n.read ? "" : "unread"}`}>
                  <span className="dot" />
                  <span>{n.body || n.title || ""}</span>
                  <span className="when">{timeAgo(n.created_at)}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="links">
        <Link href="/docs/first-project/">
          <span className="lk">FIRST PROJECT</span>
          <span className="ls">The whole loop, start to finish</span>
        </Link>
        <Link href="/docs/rules/">
          <span className="lk">SHIP RULES</span>
          <span className="ls">What the submit button checks</span>
        </Link>
        <Link href="/docs/energy/">
          <span className="lk">RE &amp; LEVELS</span>
          <span className="ls">How your rate actually works</span>
        </Link>
        <Link href="/explore/">
          <span className="lk">EXPLORE</span>
          <span className="ls">See what others shipped</span>
        </Link>
      </div>
    </>
  );
}
