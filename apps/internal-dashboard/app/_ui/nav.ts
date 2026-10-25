import type { GlyphName } from "@hackclub/icons";
import type { AdminAccess } from "@/lib/roles";

export interface NavItem {
  href: string;
  label: string;
  glyph: GlyphName;
}

export interface NavGroup {
  label: string;
  glyph: GlyphName;
  items: NavItem[];
}

// What the top bar shows: a few direct links, then one More menu with a
// section per group.
export interface NavModel {
  primary: NavItem[];
  groups: NavGroup[];
}

type Gate = boolean;

function pick(items: [Gate, NavItem][]): NavItem[] {
  return items.filter(([show]) => show).map(([, item]) => item);
}

// Role-filtered nav. Each page still re-checks with requirePage(); this only
// decides what's worth showing. Live mode hides the PII-heavy pages.
export function buildNav(access: AdminAccess, live: boolean): NavModel {
  const owner = access.isOwner;
  const reviewer = owner || access.isReviewer;

  // Owners get the four everyday links; their queues sit under More. Helpers
  // and fulfillers see so little that their queue is a direct link instead.
  const primary = pick([
    [owner, { href: "/", label: "Overview", glyph: "dashboard-meter" }],
    [!owner && access.isReviewer, { href: "/review/stats", label: "My stats", glyph: "dashboard-meter" }],
    [reviewer, { href: "/review", label: "Review", glyph: "view" }],
    [!reviewer && access.canFraudReview, { href: "/review/fraud-reviews", label: "Fraud reviews", glyph: "view" }],
    [reviewer, { href: "/projects", label: "Projects", glyph: "rep" }],
    [owner, { href: "/players", label: "Players", glyph: "people-3" }],
    [!owner && access.isHelper, { href: "/tickets", label: "Tickets", glyph: "support" }],
    [!owner && !live && access.isFulfiller, { href: "/fulfillment", label: "Fulfillment", glyph: "package" }],
  ]);

  const all: NavGroup[] = [
    {
      label: "Queues",
      glyph: "list",
      items: pick([
        [owner && access.isHelper, { href: "/tickets", label: "Tickets", glyph: "support" }],
        [owner && !live && access.isFulfiller, { href: "/fulfillment", label: "Fulfillment", glyph: "package" }],
      ]),
    },
    {
      label: "Economy",
      glyph: "bank",
      items: pick([
        [!live && owner, { href: "/pixels", label: "Pixels", glyph: "bank" }],
        [!live && owner, { href: "/budget", label: "Budget", glyph: "payment" }],
        [owner, { href: "/shop", label: "Shop", glyph: "bag" }],
        [owner, { href: "/shop-detail", label: "Shop detail", glyph: "search" }],
        [owner, { href: "/events", label: "Events", glyph: "explore" }],
        [owner, { href: "/operations", label: "Operations", glyph: "flag" }],
        [!live && owner, { href: "/referrals", label: "Referrals", glyph: "member-add" }],
      ]),
    },
    {
      label: "World",
      glyph: "compass",
      items: pick([
        [owner, { href: "/sidequests", label: "Trials & NPCs", glyph: "compass" }],
        [owner, { href: "/story", label: "Story", glyph: "docs" }],
        [owner, { href: "/community-goals", label: "Community goals", glyph: "rep" }],
        [owner, { href: "/show-n-tell", label: "Show & Tell", glyph: "photo" }],
      ]),
    },
    {
      label: "Moderation",
      glyph: "private",
      items: pick([
        [!live && owner, { href: "/reports", label: "Reports", glyph: "message-exclamation" }],
        [!live && owner, { href: "/violations", label: "Violations", glyph: "message" }],
        [!live && owner, { href: "/bans", label: "Bans", glyph: "private" }],
        [owner, { href: "/ideas", label: "Ideas", glyph: "idea" }],
      ]),
    },
    {
      label: "Admin",
      glyph: "settings",
      items: pick([
        [owner, { href: "/reviewers", label: "Reviewers", glyph: "checkmark" }],
        [owner, { href: "/admins", label: "Team & roles", glyph: "person" }],
        [owner, { href: "/notify", label: "Notify", glyph: "notification" }],
        [owner, { href: "/forms", label: "Forms", glyph: "list" }],
      ]),
    },
  ];

  return { primary, groups: all.filter((g) => g.items.length > 0) };
}

function matches(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(href + "/");
}

// The one nav link to highlight: the longest href the path sits under. Longest
// wins because some links nest ("My stats" is /review/stats, under /review),
// and only the more specific one should light up.
export function activeNavHref(pathname: string, nav: NavModel): string | null {
  const hrefs = [...nav.primary, ...nav.groups.flatMap((g) => g.items)].map((item) => item.href);
  let best: string | null = null;
  for (const href of hrefs) {
    if (matches(pathname, href) && (best === null || href.length > best.length)) best = href;
  }
  return best;
}
