// Ported from apps/game/web/pixl.js. "docs" is intentionally not in here -
// it's a separate top-level Next route with its own layout
// (app/docs/[slug]), not a page this shell wraps. quests and timeline are
// also intentionally absent - see the migration design doc's 2026-08-24
// addendum: both are deferred out of this migration entirely.
export interface NavLink {
  slug: string;
  label: string;
}

export interface NavGroup {
  label: string;
  items: NavLink[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "PLAY",
    items: [
      { slug: "dashboard", label: "OVERVIEW" },
      { slug: "explore", label: "EXPLORE" },
      { slug: "ideas", label: "IDEAS" },
      { slug: "vault", label: "GOALS" },
      { slug: "trials", label: "TRIALS" },
      { slug: "projects", label: "PROJECTS" },
    ],
  },
  {
    label: "ECONOMY",
    items: [
      { slug: "shop", label: "SHOP" },
      { slug: "orders", label: "ORDERS" },
      { slug: "collectibles", label: "COLLECT" },
      { slug: "refers", label: "REFERS" },
      { slug: "calc", label: "CALC" },
    ],
  },
  {
    label: "YOU",
    items: [
      { slug: "report", label: "REPORT" },
      { slug: "account", label: "ACCOUNT" },
    ],
  },
];

// What the mobile dock shows without opening the MORE sheet.
export const MOBILE_PRIMARY = ["dashboard", "projects", "shop", "explore"];

// Whole-pixel <rect>s on a 16x16 grid, ported verbatim from pixl.js's
// ICONS - crisp at the sidebar's small size, one currentColor fill, no
// painted-on detail (it disappears into the fill at this size).
export const ICONS: Record<string, string> = {
  dashboard: `<rect x="7" y="1" width="2" height="2"/><rect x="5" y="3" width="6" height="2"/><rect x="3" y="5" width="10" height="2"/><rect x="3" y="7" width="3" height="7"/><rect x="10" y="7" width="3" height="7"/><rect x="6" y="7" width="4" height="2"/>`,
  shop: `<rect x="5" y="1" width="6" height="2"/><rect x="5" y="3" width="2" height="2"/><rect x="9" y="3" width="2" height="2"/><rect x="3" y="5" width="10" height="9"/>`,
  orders: `<rect x="3" y="2" width="10" height="2"/><rect x="3" y="12" width="10" height="2"/><rect x="3" y="2" width="2" height="12"/><rect x="11" y="2" width="2" height="12"/><rect x="6" y="6" width="4" height="2"/><rect x="6" y="9" width="4" height="2"/>`,
  refers: `<rect x="3" y="3" width="4" height="4"/><rect x="1" y="8" width="8" height="6"/><rect x="9" y="4" width="6" height="2"/><rect x="11" y="2" width="2" height="6"/>`,
  collectibles: `<rect x="4" y="3" width="8" height="2"/><rect x="2" y="5" width="12" height="2"/><rect x="4" y="7" width="8" height="2"/><rect x="6" y="9" width="4" height="2"/><rect x="7" y="11" width="2" height="2"/>`,
  explore: `<rect x="5" y="2" width="6" height="2"/><rect x="3" y="4" width="2" height="2"/><rect x="11" y="4" width="2" height="2"/><rect x="2" y="6" width="2" height="4"/><rect x="12" y="6" width="2" height="4"/><rect x="3" y="10" width="2" height="2"/><rect x="11" y="10" width="2" height="2"/><rect x="5" y="12" width="6" height="2"/><rect x="7" y="7" width="2" height="2"/>`,
  ideas: `<rect x="5" y="1" width="6" height="1"/><rect x="4" y="2" width="8" height="6"/><rect x="5" y="8" width="6" height="1"/><rect x="6" y="10" width="4" height="2"/><rect x="6" y="13" width="4" height="2"/>`,
  projects: `<rect x="2" y="3" width="12" height="2"/><rect x="2" y="5" width="2" height="8"/><rect x="12" y="5" width="2" height="8"/><rect x="2" y="11" width="12" height="2"/>`,
  report: `<rect x="3" y="2" width="2" height="12"/><rect x="5" y="3" width="8" height="6"/>`,
  account: `<rect x="5" y="2" width="6" height="5"/><rect x="3" y="9" width="10" height="5"/>`,
  vault: `<rect x="3" y="2" width="10" height="2"/><rect x="3" y="12" width="10" height="2"/><rect x="3" y="4" width="2" height="8"/><rect x="11" y="4" width="2" height="8"/><rect x="7" y="5" width="2" height="6"/><rect x="6" y="7" width="4" height="2"/>`,
  calc: `<rect x="3" y="1" width="10" height="2"/><rect x="3" y="13" width="10" height="2"/><rect x="3" y="1" width="2" height="14"/><rect x="11" y="1" width="2" height="14"/><rect x="5" y="3" width="6" height="3"/><rect x="5" y="8" width="2" height="2"/><rect x="9" y="8" width="2" height="2"/><rect x="5" y="11" width="2" height="2"/><rect x="9" y="11" width="2" height="2"/>`,
  trials: `<rect x="2" y="3" width="12" height="2"/><rect x="2" y="11" width="12" height="2"/><rect x="2" y="3" width="2" height="10"/><rect x="12" y="3" width="2" height="10"/><rect x="7" y="5" width="2" height="1"/><rect x="7" y="7" width="2" height="1"/><rect x="7" y="9" width="2" height="1"/>`,
};

export const MORE_ICON = `<rect x="2" y="2" width="3" height="3"/><rect x="7" y="2" width="3" height="3"/><rect x="12" y="2" width="2" height="3"/><rect x="2" y="7" width="3" height="3"/><rect x="7" y="7" width="3" height="3"/><rect x="12" y="7" width="2" height="3"/><rect x="2" y="12" width="3" height="2"/><rect x="7" y="12" width="3" height="2"/><rect x="12" y="12" width="2" height="2"/>`;
export const RE_ICON = `<path d="M8 1l4 6-4 8-4-8z"/>`;
export const PALETTE_ICON = `<rect x="4" y="2" width="8" height="2"/><rect x="2" y="4" width="2" height="7"/><rect x="12" y="4" width="2" height="6"/><rect x="4" y="11" width="7" height="2"/><rect x="10" y="10" width="2" height="2"/><rect x="5" y="5" width="2" height="2"/><rect x="9" y="5" width="2" height="2"/><rect x="5" y="8" width="2" height="2"/>`;
