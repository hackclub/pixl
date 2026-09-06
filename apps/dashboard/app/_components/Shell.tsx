"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import HcIcon from "@hackclub/icons";
import { CommandPalette } from "@/app/_components/CommandPalette";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export interface NavFlags {
  overview: boolean;
  players: boolean;
  projects: boolean;
  review: boolean;
  pixels: boolean;
  moderation: boolean;
  ideas: boolean;
  reports: boolean;
  tickets: boolean;
  notify: boolean;
  admins: boolean;
  reviewers: boolean;
  slackLookup: boolean;
  referrals: boolean;
  online: boolean;
  shop: boolean;
  fulfillment: boolean;
  events: boolean;
  sidequests: boolean;
  story: boolean;
  goals: boolean;
  news: boolean;
  showNTell: boolean;
}

const GLYPHS = {
  overview: "home",
  review: "flag",
  projects: "code",
  players: "people-3",
  pixels: "bank",
  violations: "message",
  reports: "message-exclamation",
  tickets: "support-fill",
  bans: "private",
  ideas: "lightbulb-fill",
  notify: "bell",
  admins: "person-badge",
  reviewers: "checkmark",
  slackLookup: "slack",
  referrals: "member-add",
  online: "welcome",
  shop: "bag-fill",
  shopDetail: "search",
  fulfillment: "package",
  events: "explore",
  sidequests: "compass",
  story: "compass",
  goals: "bank",
  news: "message",
  showNTell: "explore",
} as const;

type IconKey = keyof typeof GLYPHS;

function Icon({ name }: { name: IconKey }) {
  return (
    <span className="shrink-0 inline-flex" aria-hidden>
      <HcIcon glyph={GLYPHS[name]} size={18} />
    </span>
  );
}

interface Tab {
  href: string;
  label: string;
  icon: IconKey;
  show: boolean;
  count?: number;
}

export function Shell({
  session,
  nav,
  reviewCount = 0,
  reportCount = 0,
  ticketCount = 0,
  orderCount = 0,
  // children,
}: {
  session: { name: string; slackId: string };
  nav: NavFlags;
  reviewCount?: number;
  reportCount?: number;
  ticketCount?: number;
  orderCount?: number;
  // children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(href + "/");

  const rawGroups: { label: string | null; items: Tab[] }[] = [
    {
      label: null,
      items: [
        // Owners get the full Overview; reviewers get their own stats as their
        // home instead. Everyone else (mod-only sub-admins) keeps Overview.
        !nav.overview && nav.review
          ? { href: "/review/stats", label: "My stats", icon: "overview", show: true }
          : { href: "/", label: "Overview", icon: "overview", show: true },
        {
          href: "/review",
          label: "Needs review",
          icon: "review",
          show: nav.review,
          count: reviewCount,
        },
        {
          href: "/projects",
          label: "Projects",
          icon: "projects",
          show: nav.projects,
        },
        {
          href: "/players",
          label: "Players",
          icon: "players",
          show: nav.players,
        },
        {
          href: "/referrals",
          label: "Referrals",
          icon: "referrals",
          show: nav.referrals,
        },
        { href: "/online", label: "Online", icon: "online", show: nav.online },
      ],
    },
    {
      label: "Economy",
      items: [
        { href: "/pixels", label: "Pixels", icon: "pixels", show: nav.pixels },
        { href: "/shop", label: "Shop", icon: "shop", show: nav.shop },
        { href: "/shop-detail", label: "Shop Detail", icon: "shopDetail", show: nav.shop },
        {
          href: "/fulfillment",
          label: "Fulfillment",
          icon: "fulfillment",
          show: nav.fulfillment,
          count: orderCount,
        },
        { href: "/events", label: "Events", icon: "events", show: nav.events },
        {
          href: "/sidequests",
          label: "Trials & NPCs",
          icon: "sidequests",
          show: nav.sidequests,
        },
      ],
    },
    {
      label: "World",
      items: [
        { href: "/story", label: "Story", icon: "story", show: nav.story },
        {
          href: "/community-goals",
          label: "Community Goals",
          icon: "goals",
          show: nav.goals,
        },
        { href: "/news", label: "News", icon: "news", show: nav.news },
        { href: "/show-n-tell", label: "Show & Tell", icon: "showNTell", show: nav.showNTell },
      ],
    },
    {
      label: "Moderation",
      items: [
        {
          href: "/reports",
          label: "Reports",
          icon: "reports",
          show: nav.reports,
          count: reportCount,
        },
        {
          href: "/tickets",
          label: "Tickets",
          icon: "tickets",
          show: nav.tickets,
          count: ticketCount,
        },
        {
          href: "/violations",
          label: "Violations",
          icon: "violations",
          show: nav.moderation,
        },
        { href: "/bans", label: "Bans", icon: "bans", show: nav.moderation },
        { href: "/ideas", label: "Ideas", icon: "ideas", show: nav.ideas },
      ],
    },
    {
      label: "Admin",
      items: [
        { href: "/notify", label: "Notify", icon: "notify", show: nav.notify },
        {
          href: "/reviewers",
          label: "Reviewers",
          icon: "reviewers",
          show: nav.reviewers,
        },
        {
          href: "/admins",
          label: "Admins",
          icon: "admins",
          show: nav.admins,
        },
        {
          href: "/slack-lookup",
          label: "Slack Lookup",
          icon: "slackLookup",
          show: nav.slackLookup,
        },
      ],
    },
  ];
  const groups = rawGroups
    .map((g) => ({ ...g, items: g.items.filter((t) => t.show) }))
    .filter((g) => g.items.length > 0);

  const initials = (session.name || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const navLink = (t: Tab) => {
    const active = isActive(t.href);
    return (
      <Link
        key={t.href}
        href={t.href}
        className={`group flex items-center gap-2.5 px-2.5 py-1.5 rounded-[4px] text-[0.875rem] font-medium transition-colors ${
          active
            ? "bg-[#303030] text-white/90"
            : "text-white/60 hover:text-ink hover:bg-[#262626]"
        }`}
      >
        <span
          className={
            active ? "text-white/90" : "text-white/60 group-hover:text-ink/70"
          }
        >
          <Icon name={t.icon} />
        </span>
        <span className="truncate">{t.label}</span>
        {t.count ? (
          <span
            className={`ml-auto text-[0.9rem] font-semibold w-5 h-5 flex items-center justify-center rounded-full ${
              active
                ? "bg-white text-black"
                : "bg-black/[0.06] dark:bg-white/10 text-ink/60"
            }`}
          >
            {t.count}
          </span>
        ) : null}
      </Link>
    );
  };

  return (
    // <div className="min-h-screen">
    //   {/* mobile top bar */}
    //   <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 h-14 px-4 border-b border-[var(--line)] bg-[var(--bg)]/90 backdrop-blur">
    //     <button
    //       onClick={() => setOpen(true)}
    //       className="grid place-items-center w-9 h-9 rounded-lg border border-[var(--line)] hover:bg-black/5 dark:hover:bg-white/5"
    //       aria-label="Open menu"
    //     >
    //       <HcIcon glyph="menu" size={20} />
    //     </button>
    //     <Link href="/" className="flex items-center gap-2">
    //       <span className="grid place-items-center w-6 h-6 rounded-lg bg-brand text-white text-xs font-bold">
    //         P
    //       </span>
    //       <span className="font-semibold text-sm">Pixl HQ</span>
    //     </Link>
    //   </header>

    //   {/* overlay (mobile) */}
    //   {open && (
    //     <div
    //       className="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
    //       onClick={() => setOpen(false)}
    //     />
    //   )}

    //   {/* sidebar */}
    //   <aside
    //     className={`fixed top-0 left-0 z-50 h-screen w-64 flex flex-col border-r border-[var(--line)] bg-[#191919] transition-transform duration-200 md:translate-x-0 ${
    //       open ? "translate-x-0" : "-translate-x-full"
    //     }`}
    //   >
    //     <div className="px-4 h-16 flex items-center shrink-0">
    //       <Link href="/" className="flex items-center gap-2.5">
    //         <span className="grid place-items-center w-7 h-7 rounded-lg bg-brand text-white text-sm font-bold">
    //           P
    //         </span>
    //         <span className="font-semibold tracking-tight">Pixl HQ</span>
    //       </Link>
    //     </div>

    //     <div className="px-5 pb-2 shrink-0">
    //       <CommandPalette
    //         navGroups={groups.map((g) => ({
    //           label: g.label,
    //           items: g.items.map((it) => ({ href: it.href, label: it.label })),
    //         }))}
    //       />
    //     </div>

    //     <nav className="flex-1 overflow-y-auto px-5 py-2 gap-px flex flex-col space-y-4">
    //       {groups.map((g, i) => (
    //         <div key={i} className="space-y-0.5">
    //           {g.label && (
    //             <div className="px-2.5 pt-1 pb-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-ink/35">
    //               {g.label}
    //             </div>
    //           )}
    //           {g.items.map(navLink)}
    //         </div>
    //       ))}
    //     </nav>

    //     <div className="shrink-0 border-t border-[var(--line)] p-3 space-y-2">
    //       <div className="flex items-center gap-2.5 px-1">
    //         <span className="grid place-items-center w-8 h-8 rounded-full bg-brand/15 text-brand text-xs font-semibold shrink-0">
    //           {initials || "?"}
    //         </span>
    //         <div className="min-w-0">
    //           <div className="text-sm font-medium truncate">{session.name}</div>
    //           <div className="text-xs text-ink/45 truncate">
    //             {session.slackId}
    //           </div>
    //         </div>
    //       </div>
    //       <div className="flex items-center gap-1.5">
    //         <button
    //           data-theme-toggle
    //           className="grid place-items-center w-8 h-8 rounded-lg border border-[var(--line)] text-ink/60 hover:text-ink hover:bg-black/5 dark:hover:bg-white/5"
    //           title="Toggle theme"
    //         >
    //           ☾
    //         </button>
    //         <button
    //           data-font-cycle
    //           className="grid place-items-center w-8 h-8 rounded-lg border border-[var(--line)] text-ink/60 hover:text-ink hover:bg-black/5 dark:hover:bg-white/5"
    //           title="Text size"
    //         >
    //           A
    //         </button>
    //         <form action="/api/auth/logout" method="post" className="ml-auto">
    //           <button className="px-3 h-8 rounded-lg border border-[var(--line)] text-sm text-rose-500 hover:bg-rose-500/10">
    //             Sign out
    //           </button>
    //         </form>
    //       </div>
    //     </div>
    //   </aside>

    //   {/* main */}
    //   {/* <div className="md:pl-64">
    //     <main className="min-w-0">
    //       <div className="max-w-[1200px] mx-auto w-full px-4 md:px-8 py-6 md:py-8">
    //         {children}
    //       </div>
    //     </main>
    //   </div> */}
    // </div>
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white font-bold">
            P
          </div>

          <div>
            <p className="font-semibold leading-none">Pixl HQ</p>
            <p className="text-xs text-muted-foreground">Dashboard</p>
          </div>
        </Link>

        <div className="mt-3">
          <CommandPalette
            navGroups={groups.map((g) => ({
              label: g.label,
              items: g.items.map((i) => ({
                href: i.href,
                label: i.label,
              })),
            }))}
          />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label ?? "general"}>
            {group.label && (
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            )}

            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive(item.href)}>
                      <Link href={item.href}>
                        <Icon name={item.icon} />
                        <span>{item.label}</span>

                        {item.count ? (
                          <span className="ml-auto">{item.count}</span>
                        ) : null}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white">
            {initials}
          </div>

          <div className="flex-1 overflow-hidden">
            <p className="truncate font-medium">{session.name}</p>

            <p className="truncate text-xs text-muted-foreground">
              {session.slackId}
            </p>
          </div>

          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="grid place-items-center w-8 h-8 rounded-lg border border-[var(--line)] text-muted-foreground hover:text-foreground hover:bg-accent"
              title="Sign out"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </form>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
