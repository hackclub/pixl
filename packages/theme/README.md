# @pixl/theme

`palette.json` is the one place LEDGER (dark and light) lives as data: the
named color tokens the game, the web shell and the docs previews all read.
Change a value here and every consumer that generates off it picks it up.

## One identity, two value sets

`palette.json` has `web` and `godot` top-level keys, each with a `dark`
theme object (`web` also has `light`) using the same token names (`ink`,
`gold`, `panel`, ...). Unlike the DUSK/Light palette this replaced, `web.dark`
and `godot.dark` now share the same gold, ink and panel family on purpose -
that's the point of LEDGER: the currency icon, the game's UI and the web
shell's accent all read as the same gold, not three independently-chosen
ones. `godot.dark` only carries the subset of tokens the Godot side actually
consumes today (`gold`, `gold-soft`, `ink`, `panel`, `panel-deep`, `btn-ink`,
`good`, `bad`) - `apps/game/scripts/pixl_theme.gd`'s `apply()` only repaints
a specific subset of `main_theme.tres` and a couple of scripts so far (see
that file's comments for the current scope and what's still deferred).

`godot.light` does not exist. The game has no light-mode design yet.
`PixlTheme` falls back to `godot.dark` whenever a synced "light" choice
reaches the game, so a player who picked Ledger (light) on the web shell
still sees Ledger Dark in-game, unchanged, until someone designs a Godot
light variant.

`web.dark.effects` / `web.light.effects` (`drop`, `dropLg`, `dither`) are
literal CSS value strings, not derived from `ink`, the shadow/dither rgba
values are hand-tuned per theme and don't reduce to a clean tint of `ink`.
Godot has no consumer for these, so they're omitted from the generated
`apps/game/theme.json`.

`--img-slot` in `pixl.css` stays out of this file entirely - it's explicitly
fixed, never redefined per theme (see the comment next to it in `pixl.css`).

## Consuming it

Nothing imports `@pixl/theme` at runtime, for the same reason nothing imports
`@pixl/config` at runtime: Railway/Vercel build from per-app roots, and the
game runs from an exported PCK. Generated, committed copies reach every
consumer instead:

```bash
bun run theme:sync
```

Run that after editing `palette.json`. It rewrites:

- `apps/game/theme.json` - read by `apps/game/scripts/pixl_theme.gd`
- the color-token lines inside `apps/game/web/pixl.css`'s `:root{}` and
  `:root[data-theme="light"]{}` blocks, between `/* <pixl-theme:...> */`
  markers. Everything else in those blocks (the LEDGER design-philosophy
  comment, `--img-slot`, structural vars like `--sans`/`--radius`/`--notch`)
  is hand-authored and untouched by the sync.

`packages/docs-engine/src/og.ts` (the link-preview cards for every page, not
just docs) reads `web.dark` directly at build time, so the previews always
match whatever LEDGER DARK currently is without a separate copy.

Both `theme.json` and `pixl.css` are committed (the game and the web shell
need them at runtime) but are **generated - do not hand-edit them**, the next
sync overwrites your changes.
