import { mkdir, readdir, rm } from "node:fs/promises";
import { render, type Doc } from "./src/markdown.ts";
import { renderPage, type NavItem } from "./src/page.ts";
import { renderCard } from "./src/og.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const CONTENT = `${ROOT}docs`;
const OUT = `${ROOT}apps/game/web/docs`;
const config = JSON.parse(
  await Bun.file(`${ROOT}packages/config/pixl.json`).text(),
);
// Light is the default theme (pixl.js falls back to it before localStorage
// is read), used here so the /docs redirect stub doesn't flash pure white
// before pixl.css ever loads.
const LEDGER = JSON.parse(
  await Bun.file(`${ROOT}packages/theme/palette.json`).text(),
).web.light;

// Canonical host for absolute links and card URLs. Off packages/config so a
// domain move is one edit, not a hunt through two builders - these were
// hardcoded to pixl.rsvp and kept pointing there after the move, which left
// every og:image resolving to a 404.
const SITE: string = config.urls.site;
const SITE_HOST = SITE.replace(/^https?:\/\//, "");
const E = config.economy;

// Numbers the copy quotes, resolved at build time so the pages can never drift
// from packages/config the way the hand-written HTML did.
const px = (usd: number) => `${Math.round(usd / E.pixelValueUsd)} px`;
const tokens: Record<string, string> = {
  basePx: px(E.basePayoutUsd),
  maxPx: px(E.maxPayoutUsd),
  baseUsd: `$${E.basePayoutUsd.toFixed(2)}`,
  maxUsd: `$${E.maxPayoutUsd.toFixed(2)}`,
  reCap: E.reForMaxPayout.toLocaleString("en-US"),
  maxLevel: String(E.levelBands[E.levelBands.length - 1].throughLevel),
  kickerUsd: `$${E.tierKickerUsdPerStep.toFixed(2)}`,
  kickerHours: String(E.tierKickerHours),
  trialBonusRe: String(E.trialBonusRe),
  t1: String(E.tierRePerHour[0]),
  t2: String(E.tierRePerHour[1]),
  t3: String(E.tierRePerHour[2]),
  t4: String(E.tierRePerHour[3]),
  cutoff: new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(config.hackatimeCutoff)),
};

const exampleHours = 10;
const exampleTier = E.tierRePerHour.length;
const exampleUsd = E.tierKickerUsdPerStep * (exampleTier - 1) * exampleHours;
tokens.kickerExampleUsd = `$${exampleUsd.toFixed(2)}`;
tokens.kickerExamplePx = `${Math.round(exampleUsd / E.pixelValueUsd)} px`;

// Mirrors packages/config/sync.ts's payoutUsdPerHour/averageUsdPerHourOver -
// the ramp is linear, so the average over [0, re] (re <= reForMaxPayout,
// true for every example below) is just the average of its two endpoints.
const rampAvgUsd = (re: number) => {
  const r = Math.min(re, E.reForMaxPayout);
  return E.basePayoutUsd + (r / (2 * E.reForMaxPayout)) * (E.maxPayoutUsd - E.basePayoutUsd);
};

// Same 10h/T4 project the kicker example already quotes - now the full total,
// ramp + kicker together, so the two mechanics visibly add up to one number.
const exampleProjectRe = E.tierRePerHour[exampleTier - 1] * exampleHours;
const exampleRampUsd = rampAvgUsd(exampleProjectRe) * exampleHours;
const exampleTotalUsd = exampleRampUsd + exampleUsd;
tokens.exampleRampUsd = `$${exampleRampUsd.toFixed(2)}`;
tokens.exampleTotalUsd = `$${exampleTotalUsd.toFixed(2)}`;
tokens.exampleTotalPx = `${Math.round(exampleTotalUsd / E.pixelValueUsd)} px`;

// A project big enough to hit the cap on its own: reForMaxPayout RE at the
// top tier, so its own average rate runs the whole ramp start to finish.
const capTier = E.tierRePerHour.length;
const capHours = Math.round(E.reForMaxPayout / E.tierRePerHour[capTier - 1]);
const capKickerUsd = E.tierKickerUsdPerStep * (capTier - 1) * Math.min(capHours, E.tierKickerHours);
const capUsd = rampAvgUsd(E.reForMaxPayout) * capHours + capKickerUsd;
tokens.capExampleHours = String(capHours);
tokens.capExampleUsd = `$${capUsd.toFixed(2)}`;
tokens.capExamplePx = `${Math.round(capUsd / E.pixelValueUsd)} px`;

// The same player's next project, small and low tier, right after the one
// above - shows the rate resets instead of carrying over.
const nextHours = 5;
const nextRe = E.tierRePerHour[0] * nextHours;
const nextRate = rampAvgUsd(nextRe);
tokens.nextExampleHours = String(nextHours);
tokens.nextExampleRate = `$${nextRate.toFixed(2)}`;
tokens.nextExamplePx = `${Math.round((nextRate * nextHours) / E.pixelValueUsd)} px`;

let from = 1;
let cumulative = 0;
E.levelBands.forEach((band: { throughLevel: number; rePerLevel: number }, i: number) => {
  cumulative += (band.throughLevel - from + 1) * band.rePerLevel;
  tokens[`band${i + 1}From`] = String(from);
  tokens[`band${i + 1}To`] = String(band.throughLevel);
  tokens[`band${i + 1}Per`] = String(band.rePerLevel);
  tokens[`band${i + 1}Total`] = cumulative.toLocaleString("en-US");
  from = band.throughLevel + 1;
});

// Order comes from the filename prefix (010-welcome.md), which keeps the nav
// order in the filesystem instead of a separate manifest.
const files = (await readdir(CONTENT)).filter((f) => f.endsWith(".md")).sort();
if (files.length === 0) {
  console.error(`[docs] no markdown in ${CONTENT}`);
  process.exit(1);
}

const docs: Doc[] = [];
for (const file of files) {
  const slug = file.replace(/^\d+-/, "").replace(/\.md$/, "");
  try {
    const doc = render(await Bun.file(`${CONTENT}/${file}`).text(), tokens);
    docs.push({ ...doc, slug });
  } catch (err) {
    console.error(`[docs] ${file}: ${(err as Error).message}`);
    process.exit(1);
  }
}

const nav: NavItem[] = docs.map((d) => ({
  slug: d.slug,
  title: d.meta.title,
  group: d.meta.group,
}));

// Wipe generated page directories but keep hand-maintained assets alongside.
for (const entry of await readdir(OUT, { withFileTypes: true })) {
  if (entry.isDirectory())
    await rm(`${OUT}/${entry.name}`, { recursive: true, force: true });
}

for (const [i, doc] of docs.entries()) {
  const dir = `${OUT}/${doc.slug}`;
  await mkdir(dir, { recursive: true });
  await Bun.write(
    `${dir}/index.html`,
    renderPage({
      doc,
      nav,
      siteUrl: SITE,
      prev: nav[i - 1] ?? null,
      next: nav[i + 1] ?? null,
    }),
  );
  await Bun.write(
    `${dir}/og.png`,
    renderCard({
      title: doc.meta.title,
      eyebrow: doc.meta.group,
      url: `${SITE_HOST}/docs/${doc.slug}`,
    }),
  );
}

// /docs itself lands on the first page.
const first = docs[0]!.slug;
await Bun.write(
  `${OUT}/index.html`,
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pixl · Docs</title>
<link rel="canonical" href="${SITE}/docs/${first}/">
<meta http-equiv="refresh" content="0; url=/docs/${first}/">
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:${LEDGER["panel-deep"]};color:${LEDGER.ink};font-family:system-ui,sans-serif}
  a{color:${LEDGER.gold}}
</style>
</head>
<body><a href="/docs/${first}/">Pixl docs</a></body>
</html>
`,
);

console.log(
  `[docs] built ${docs.length} pages + ${docs.length} cards into apps/game/web/docs/`,
);
