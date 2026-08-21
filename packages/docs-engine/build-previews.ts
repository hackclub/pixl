/**
 * Link-preview cards for the static web-shell pages (/dashboard, /shop, /ideas, ...) -
 * a carbon copy of what build.ts already does per doc page, reusing the same
 * renderCard() so every preview across the whole site (docs included) comes
 * from one theme-aware card renderer, not two.
 *
 *   bun run previews:build
 *
 * Unlike docs pages, these index.html files are hand-authored and tracked in
 * git, not generated from scratch. This script only injects a marked meta
 * block right after each page's <title>, leaving everything else untouched,
 * and writes og.png alongside (gitignored, regenerated at deploy time same as
 * docs/*.md's og.png - see build.ts).
 */
import { readFile, writeFile } from "node:fs/promises";
import { renderCard } from "./src/og.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const WEB = `${ROOT}apps/game/web`;

// Canonical host off packages/config rather than a literal - this was pinned to
// pixl.rsvp and kept emitting og:image URLs there after the move, so every card
// pointed at a 404 even where the page itself was reachable.
const SITE: string = JSON.parse(
  await Bun.file(`${ROOT}packages/config/pixl.json`).text(),
).urls.site;
const SITE_HOST = SITE.replace(/^https?:\/\//, "");

interface PageMeta {
  slug: string;
  eyebrow: string;
  description: string;
}

const pages: PageMeta[] = [
  { slug: "dashboard", eyebrow: "Dashboard", description: "Your Pixl status at a glance: level, Pixels, Restoration Energy and what's next." },
  { slug: "ideas", eyebrow: "Community", description: "Post project ideas, browse what others are building, and upvote your favorites." },
  { slug: "shop", eyebrow: "Shop", description: "Spend your Pixels on real, physical rewards." },
  { slug: "shop/item", eyebrow: "Shop", description: "A closer look at a Pixl shop item." },
  { slug: "orders", eyebrow: "Shop", description: "Track the shop orders you've placed with your Pixels." },
  { slug: "collectibles", eyebrow: "Shop", description: "Spend Restoration Energy on collectibles for your village." },
  { slug: "projects", eyebrow: "Ships", description: "Every project you've shipped, its hours, tier and payout." },
  { slug: "quests", eyebrow: "Progress", description: "Trials and sidequests on the way to your next reward." },
  { slug: "hackatime", eyebrow: "Projects", description: "Connect Hackatime and track the coding hours behind your ships." },
  { slug: "explore", eyebrow: "World", description: "Browse villages and see what other players are building." },
  { slug: "timeline", eyebrow: "Community", description: "The Chronicle: a running timeline of what's shipped across Pixl." },
  { slug: "vault", eyebrow: "Community", description: "The Core Vault: what the whole Pixl community has restored together." },
  { slug: "refers", eyebrow: "Community", description: "Invite friends to Pixl and earn a payout when they ship." },
  { slug: "account", eyebrow: "Account", description: "Manage your Pixl profile, session and connected accounts." },
  { slug: "report", eyebrow: "Moderation", description: "Report a player or a piece of content to the Pixl moderation team." },
];

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const OPEN = "<!-- <pixl-preview> -->";
const CLOSE = "<!-- <pixl-preview:end> -->";

let count = 0;

for (const page of pages) {
  const dir = `${WEB}/${page.slug}`;
  const htmlPath = `${dir}/index.html`;
  const html = await readFile(htmlPath, "utf8").catch(() => null);
  if (html === null) {
    console.error(`[previews] ${htmlPath} not found`);
    process.exit(1);
  }

  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  if (!titleMatch) {
    console.error(`[previews] ${htmlPath} has no <title>`);
    process.exit(1);
  }
  const title = titleMatch[1]!;
  const url = `${SITE}/${page.slug}/`;
  const image = `${url}og.png`;

  const block = [
    OPEN,
    `<meta name="description" content="${esc(page.description)}">`,
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Pixl">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(page.description)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(page.description)}">`,
    `<meta name="twitter:image" content="${image}">`,
    CLOSE,
  ].join("\n    ");

  const nextHtml = html.includes(OPEN)
    ? html.replace(new RegExp(`${OPEN}[\\s\\S]*?${CLOSE}`), block)
    : html.replace(/<title>[^<]*<\/title>/, (m) => `${m}\n    ${block}`);

  if (nextHtml !== html) await writeFile(htmlPath, nextHtml);

  await writeFile(
    `${dir}/og.png`,
    renderCard({ title, eyebrow: page.eyebrow, url: `${SITE_HOST}/${page.slug}` }),
  );
  count++;
}

// The game itself has no hand-authored page to inject into - its index.html
// comes out of the Godot export - so only the card is written here and
// apps/game/Dockerfile stitches the meta into the exported HTML.
await writeFile(
  `${WEB}/og.png`,
  renderCard({ title: "Pixl", eyebrow: "Play", url: SITE_HOST }),
);

console.log(`[previews] wrote ${count} og.png cards + meta blocks under apps/game/web/, plus the root card`);
