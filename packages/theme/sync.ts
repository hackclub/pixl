/**
 * Pushes palette.json out to every consumer that can't import a workspace
 * package at runtime, the same way packages/config/sync.ts does for program
 * facts — see that file's header for why (Railway/Vercel per-app roots, the
 * Godot export runs from a PCK).
 *
 *   bun run theme:sync
 *
 * Every target below is committed but generated. Hand-edits are overwritten
 * on the next run. See README.md for the web/godot value-set split.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const SOURCE = `${ROOT}packages/theme/palette.json`;

const NOTE = "GENERATED from packages/theme/palette.json by `bun run theme:sync` - do not edit";

const raw = await readFile(SOURCE, "utf8");
const palette = JSON.parse(raw);

const written: string[] = [];

async function write(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  written.push(path.replace(ROOT, ""));
}

function cssDecls(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([name, value]) => `--${name}:${value};`)
    .join("");
}

function replaceBetween(content: string, open: string, close: string, body: string, file: string): string {
  const start = content.indexOf(open);
  const end = content.indexOf(close);
  if (start === -1 || end === -1) {
    console.error(`[theme:sync] missing ${open} / ${close} markers in ${file}`);
    process.exit(1);
  }
  return content.slice(0, start + open.length) + `\n  ${body}\n  ` + content.slice(end);
}

// --- Godot: read off res:// by scripts/pixl_theme.gd ------------------------
await write(
  `${ROOT}apps/game/theme.json`,
  `${JSON.stringify({ _generated: NOTE, ...palette.godot }, null, 2)}\n`,
);

// --- The web shell's shared stylesheet ---------------------------------------
const CSS_TARGET = `${ROOT}apps/game/web/pixl.css`;
let css = await readFile(CSS_TARGET, "utf8");

// apps/web-shell/app/globals.css carries its own hand-authored Tailwind
// setup around the same <pixl-theme:...> markers, injected the same way.
const WEB_SHELL_CSS_TARGET = `${ROOT}apps/web-shell/app/globals.css`;
let webShellCss = await readFile(WEB_SHELL_CSS_TARGET, "utf8");

for (const theme of Object.keys(palette.web)) {
  const { effects, ...tokens } = palette.web[theme];
  css = replaceBetween(
    css,
    `/* <pixl-theme:${theme}> */`,
    `/* <pixl-theme:${theme}:end> */`,
    cssDecls(tokens),
    CSS_TARGET,
  );
  webShellCss = replaceBetween(
    webShellCss,
    `/* <pixl-theme:${theme}> */`,
    `/* <pixl-theme:${theme}:end> */`,
    cssDecls(tokens),
    WEB_SHELL_CSS_TARGET,
  );
  const effectDecls = Object.entries(effects as Record<string, string>)
    .map(([name, value]) => `--${name === "dropLg" ? "drop-lg" : name}:${value};`)
    .join("");
  css = replaceBetween(
    css,
    `/* <pixl-theme:${theme}:effects> */`,
    `/* <pixl-theme:${theme}:effects:end> */`,
    effectDecls,
    CSS_TARGET,
  );
  webShellCss = replaceBetween(
    webShellCss,
    `/* <pixl-theme:${theme}:effects> */`,
    `/* <pixl-theme:${theme}:effects:end> */`,
    effectDecls,
    WEB_SHELL_CSS_TARGET,
  );
}

await write(CSS_TARGET, css);
await write(WEB_SHELL_CSS_TARGET, webShellCss);

console.log(`[theme:sync] wrote:\n  ${written.join("\n  ")}`);
