/**
 * Copies the baked world maps into the dashboard's public directory.
 *
 *   bun run map:sync
 *
 * The dashboard's NPC spot-picker draws these PNGs and converts a click into a
 * world coordinate with bounds.json. It can't read them out of apps/game
 * directly: the dashboard builds from its own /apps/dashboard root, so anything
 * outside that root doesn't exist at build time. Same reason packages/config and
 * packages/theme generate committed copies rather than being imported.
 *
 * The source PNGs come from scripts/tools/world_map_baker.gd - re-run that first
 * if tilemaps moved, then this to push the result to the dashboard.
 *
 * Targets are committed but generated. Hand-edits are overwritten on the next run.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../../", import.meta.url).pathname;
const SRC = `${ROOT}apps/game/assets/map/`;
const DEST = `${ROOT}apps/dashboard/public/map/`;

const MAPS = ["open_world.png", "village.png", "factory_island.png", "pixel_cafe.png"];

await mkdir(DEST, { recursive: true });

const written: string[] = [];

for (const name of MAPS) {
  await copyFile(`${SRC}${name}`, `${DEST}${name}`);
  written.push(`${DEST}${name}`.replace(ROOT, ""));
}

// bounds.json rides along with a generated-file marker, since unlike the PNGs
// it's the kind of thing someone might otherwise be tempted to hand-tune.
const bounds = JSON.parse(await readFile(`${SRC}bounds.json`, "utf8"));
await writeFile(
  `${DEST}bounds.json`,
  `${JSON.stringify(
    {
      _note: "GENERATED from apps/game/assets/map/bounds.json by `bun run map:sync` - do not edit",
      ...bounds,
    },
    null,
    2,
  )}\n`,
);
written.push(`${DEST}bounds.json`.replace(ROOT, ""));

console.log(`map:sync wrote ${written.length} files`);
for (const w of written) console.log(`  ${w}`);
