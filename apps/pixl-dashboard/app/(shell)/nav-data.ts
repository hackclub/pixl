// Sidebar structure. Every signed-in player page lives here; /journals is a
// public share link and deliberately has no nav entry.
export interface NavLink {
  slug: string;
  label: string;
  href: string;
}

export interface NavGroup {
  label: string;
  items: NavLink[];
}

const link = (slug: string, label: string, href = `/${slug}`): NavLink => ({ slug, label, href });

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "PLAY",
    items: [
      link("dashboard", "OVERVIEW"),
      link("projects", "PROJECTS"),
      link("trials", "TRIALS"),
      link("docs", "DOCS", "/docs"),
    ],
  },
  {
    label: "COMMUNITY",
    items: [
      link("explore", "EXPLORE"),
      link("leaderboard", "LEADERBOARD", "/explore/leaderboard"),
      link("ideas", "IDEAS"),
      link("show-n-tell", "SHOW & TELL"),
    ],
  },
  {
    label: "ECONOMY",
    items: [
      link("shop", "SHOP"),
      link("orders", "ORDERS"),
      link("calc", "CALCULATOR"),
      link("vault", "VAULT"),
      link("collectibles", "COLLECTIBLES"),
      link("refers", "REFERRALS"),
    ],
  },
  {
    label: "YOU",
    items: [link("report", "REPORT"), link("account", "ACCOUNT")],
  },
];

/** What the mobile dock shows without opening the MORE sheet. */
export const MOBILE_PRIMARY = ["dashboard", "projects", "shop", "account"];

// Whole-pixel rects on a 16x16 grid: [x, y, width, height]. Rendered as React
// <rect> elements (components/pixel-icon.tsx), no HTML strings.
export type Rect = readonly [number, number, number, number];

export const ICONS: Record<string, readonly Rect[]> = {
  dashboard: [[7, 1, 2, 2], [5, 3, 6, 2], [3, 5, 10, 2], [3, 7, 3, 7], [10, 7, 3, 7], [6, 7, 4, 2]],
  docs: [[2, 4, 5, 8], [9, 4, 5, 8], [2, 12, 12, 2]],
  shop: [[5, 1, 6, 2], [5, 3, 2, 2], [9, 3, 2, 2], [3, 5, 10, 9]],
  orders: [[3, 2, 10, 2], [3, 12, 10, 2], [3, 2, 2, 12], [11, 2, 2, 12], [6, 6, 4, 2], [6, 9, 4, 2]],
  projects: [[2, 3, 12, 2], [2, 5, 2, 8], [12, 5, 2, 8], [2, 11, 12, 2]],
  report: [[3, 2, 2, 12], [5, 3, 8, 6]],
  account: [[5, 2, 6, 5], [3, 9, 10, 5]],
  trials: [[2, 3, 12, 2], [2, 11, 12, 2], [2, 3, 2, 10], [12, 3, 2, 10], [7, 5, 2, 1], [7, 7, 2, 1], [7, 9, 2, 1]],
  explore: [[5, 2, 6, 2], [3, 4, 2, 6], [11, 4, 2, 6], [5, 10, 6, 2], [11, 11, 2, 2], [13, 13, 2, 2]],
  leaderboard: [[6, 3, 4, 11], [2, 7, 4, 7], [10, 9, 4, 5]],
  ideas: [[5, 1, 6, 2], [3, 3, 2, 5], [11, 3, 2, 5], [5, 8, 2, 2], [9, 8, 2, 2], [6, 10, 4, 2], [6, 13, 4, 2]],
  "show-n-tell": [[2, 3, 12, 2], [2, 5, 2, 6], [12, 5, 2, 6], [2, 11, 12, 2], [7, 13, 2, 2], [6, 7, 3, 2]],
  calc: [[3, 1, 10, 14], [5, 3, 6, 3], [5, 8, 2, 2], [9, 8, 2, 2], [5, 11, 2, 2], [9, 11, 2, 2]],
  vault: [[2, 2, 12, 12], [6, 6, 4, 4], [7, 4, 2, 2], [7, 10, 2, 2]],
  collectibles: [[7, 1, 2, 4], [5, 5, 6, 2], [2, 7, 12, 2], [4, 9, 8, 2], [3, 11, 4, 3], [9, 11, 4, 3]],
  refers: [[2, 4, 4, 4], [10, 4, 4, 4], [1, 10, 6, 4], [9, 10, 6, 4], [6, 6, 4, 2]],
};

export const MORE_ICON: readonly Rect[] = [
  [2, 2, 3, 3], [7, 2, 3, 3], [12, 2, 2, 3], [2, 7, 3, 3], [7, 7, 3, 3], [12, 7, 2, 3], [2, 12, 3, 2], [7, 12, 3, 2], [12, 12, 2, 2],
];
export const PALETTE_ICON: readonly Rect[] = [
  [4, 2, 8, 2], [2, 4, 2, 7], [12, 4, 2, 6], [4, 11, 7, 2], [10, 10, 2, 2], [5, 5, 2, 2], [9, 5, 2, 2], [5, 8, 2, 2],
];
export const FONT_ICON: readonly Rect[] = [
  [6, 2, 4, 2], [5, 4, 2, 2], [9, 4, 2, 2], [4, 6, 2, 2], [10, 6, 2, 2], [3, 8, 2, 6], [11, 8, 2, 6], [5, 9, 6, 2],
];
