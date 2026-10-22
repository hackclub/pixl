/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import "./_ui/admin.css";
import "./_ui/themes.css";
import "./_ui/fonts.css";
import { fontVariables } from "./fonts";
import { getAccess } from "@/lib/guard";
import { countPendingReviews, countOpenReports, countPendingOrders, getStaffSettings } from "@/lib/db";
import { ticketStats } from "@/lib/tickets";
import { getLiveMode, getHideReviewers } from "@/lib/liveModeServer";
import { setLiveMode } from "@/app/actions";
import { LiveModeProvider } from "@/app/_components/LiveMode";
import { ReviewCelebration } from "@/app/_components/ReviewCelebration";
import TopNav from "@/app/_ui/TopNav";
import CommandPalette from "@/app/_ui/CommandPalette";
import Tooltips from "@/app/_ui/Tooltips";
import { buildNav } from "@/app/_ui/nav";
import { ActionButton, Button, Icon, Mono } from "@/app/_ui/ui";

export const metadata: Metadata = {
  title: "Pixl",
  description: "The Pixl team's home for reviews, players, and pixels",
  // Internal tool: keep it out of search entirely. Deliberately not paired
  // with a robots.txt disallow, which would stop crawlers from ever seeing
  // this noindex and dropping an already-indexed URL.
  robots: { index: false, follow: false },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Badge counts in the top bar. Each is best effort: a slow or failing count
// must never take the whole dashboard down with it.
async function navCounts(access: NonNullable<Awaited<ReturnType<typeof getAccess>>>, live: boolean) {
  const owner = access.isOwner;
  const safe = async (fn: () => Promise<number>) => {
    try {
      return await fn();
    } catch (e) {
      console.error("[layout] nav count failed", (e as Error).message);
      return 0;
    }
  };
  const [review, reports, tickets, orders] = await Promise.all([
    owner || access.isReviewer ? safe(() => countPendingReviews({ viewer: access.session.slackId })) : 0,
    !live && owner ? safe(countOpenReports) : 0,
    access.isHelper ? safe(async () => (await ticketStats()).open) : 0,
    !live && access.isFulfiller ? safe(countPendingOrders) : 0,
  ]);
  return { "/review": review, "/reports": reports, "/tickets": tickets, "/fulfillment": orders };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const access = await getAccess();

  if (!access) {
    return (
      <html lang="en" className={fontVariables}>
        <body>
          <div className="admin-shell">{children}</div>
        </body>
      </html>
    );
  }

  const session = access.session;
  const live = await getLiveMode();
  const hideReviewers = await getHideReviewers();
  const nav = buildNav(access, live);
  const [counts, settings] = await Promise.all([navCounts(access, live), getStaffSettings(session.slackId)]);
  const firstName = session.name.split(" ")[0] || "Staff";

  return (
    <html
      lang="en"
      className={fontVariables}
      data-theme={settings.theme}
      data-accent={settings.accent}
      data-font={settings.font}
      data-mono-font={settings.monoFont}
      data-density={settings.compact ? "compact" : "normal"}
    >
      <body>
        <LiveModeProvider live={live} hideReviewers={hideReviewers} viewer={session.slackId}>
          <div className="admin-shell">
            <ReviewCelebration confetti={settings.confetti} sound={settings.sound} />
            <Tooltips />
            <header className="hc-topbar sticky top-0 z-20">
              <div className="hc-topbar-inner mx-auto flex min-h-14 max-w-[1840px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-2">
                <Link href="/" className="hc-brand flex shrink-0 items-center gap-2">
                  <img src="/logo.png" alt="Pixl" width={28} height={28} />
                  <span className="hc-brand-text hc-heading">Pixl</span>
                </Link>
                <TopNav nav={nav} counts={counts} />
                <div className="hc-search-slot flex min-w-48 flex-1 justify-center">
                  <CommandPalette nav={nav} />
                </div>
                <div className="hc-account-actions flex shrink-0 items-center gap-3">
                  <form action={setLiveMode} className="hc-live-toggle flex items-center gap-2" data-live={live || undefined}>
                    <input type="hidden" name="on" value={live ? "0" : "1"} />
                    <span
                      title={
                        live
                          ? "Live mode is on: names, emails, addresses and other personal details are hidden. Click to turn it off."
                          : "Hides names, emails, addresses and other personal details, for when you are streaming or sharing your screen."
                      }
                    >
                      <ActionButton variant={live ? "primary" : "ghost"} size="sm" icon="view" pendingLabel="Switching...">
                        {live ? "Live" : "Live mode"}
                      </ActionButton>
                    </span>
                  </form>
                  <span className="hidden text-sm 2xl:inline">
                    <span className="font-bold">{firstName}</span>{" "}
                    <span className="hc-muted">
                      (<Mono>{session.slackId}</Mono>)
                    </span>
                  </span>
                  <Link
                    href="/settings"
                    className="hc-btn hc-btn-ghost hc-btn-sm hc-btn-icon"
                    title="Settings"
                    aria-label="Settings"
                  >
                    <Icon glyph="settings" size={20} />
                  </Link>
                  <form action="/api/auth/logout" method="post">
                    <Button type="submit" variant="ghost" size="sm" icon="door-leave" className="hc-logout" aria-label="Log out">
                      <span className="hc-logout-label">Log out</span>
                    </Button>
                  </form>
                </div>
              </div>
            </header>
            <main className="hc-main mx-auto max-w-[1840px] px-6 py-8">{children}</main>
          </div>
        </LiveModeProvider>
      </body>
    </html>
  );
}
