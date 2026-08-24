// Only OG preview cards now — docs/*.md rendering itself moved into
// apps/web-shell/lib/docs.ts. Still runs from the repo root via
// `bun run docs:build`, but now writes into apps/web-shell/public/docs/<slug>/
// instead of static HTML pages under apps/game/web/docs/. apps/web-shell has
// no basePath (see next.config.ts) - doc pages live at the literal
// /docs/<slug>/ route, so their OG images need to physically sit at
// public/docs/<slug>/og.png to match.
import { mkdir, readdir } from "node:fs/promises";
import { render } from "./src/markdown.ts";
import { renderCard } from "./src/og.ts";
import { buildTokens } from "./src/tokens.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const CONTENT = `${ROOT}docs`;
const OUT = `${ROOT}apps/web-shell/public/docs`;
const config = JSON.parse(
  await Bun.file(`${ROOT}packages/config/pixl.json`).text(),
);
const SITE_HOST: string = config.urls.site.replace(/^https?:\/\//, "");
const tokens = buildTokens(config);

const files = (await readdir(CONTENT)).filter((f) => f.endsWith(".md")).sort();
if (files.length === 0) {
  console.error(`[docs] no markdown in ${CONTENT}`);
  process.exit(1);
}

let count = 0;
for (const file of files) {
  const slug = file.replace(/^\d+-/, "").replace(/\.md$/, "");
  let doc;
  try {
    doc = render(await Bun.file(`${CONTENT}/${file}`).text(), tokens);
  } catch (err) {
    console.error(`[docs] ${file}: ${(err as Error).message}`);
    process.exit(1);
  }
  const dir = `${OUT}/${slug}`;
  await mkdir(dir, { recursive: true });
  await Bun.write(
    `${dir}/og.png`,
    renderCard({
      title: doc.meta.title,
      eyebrow: doc.meta.group,
      url: `${SITE_HOST}/docs/${slug}`,
    }),
  );
  count++;
}

console.log(`[docs] built ${count} OG cards into apps/web-shell/public/docs/`);
