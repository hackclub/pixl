# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

Pixl is a Hack Club YSWS ("You Ship, We Ship") program built around a pixel-art multiplayer game. It is a Bun + Turborepo monorepo (workspaces `apps/*`, `packages/*`, `packageManager: bun@1.3.13`).

| Path | Stack | Purpose |
|---|---|---|
| `apps/server` | Bun/Node, Express, `ws`, Postgres | Game server: auth, player state, WebSocket game/lobby loop, projects, shop, economy, forms |
| `apps/game` | Godot 4 (GDScript) | Multiplayer game client, plus the old static web pages in `apps/game/web/` |
| `apps/landing` | Next.js 16, React 19, Tailwind 4 | Marketing site and apex proxy for pixl.hackclub.com |
| `apps/web-shell` | Next.js 16, React 19 | React migration of the player-facing web shell (`/docs`, `/form/:formKey`, the `(shell)` signed-in pages) |
| `apps/dashboard` | Next.js 16, React 19, Tailwind 4, shadcn/radix | Admin/reviewer dashboard: review queue, moderation, bans, tickets, fulfillment, stats |
| `apps/pixorpheus` | Bun, TypeScript, Slack Bolt v4 | Slack bot "Pixo": tickets, AI chat, moderation DMs, review channel, slash commands |
| `apps/pixo-dm` | Node (CommonJS), Express | Tiny relay that sends dashboard-initiated DMs as Pixo. Plain `node index.js`; don't convert it to Bun or ESM |
| `packages/config` | JSON + sync script | Single source of truth for program facts (launch date, Hackatime cutoff, URLs, economy rates) |
| `packages/theme` | JSON + sync script | Single source of truth for the LEDGER color palette |
| `packages/docs-engine` | Bun/TS | Markdown renderer for `docs/*.md` and the OG preview card builder |
| `packages/map-sync` | Bun/TS | Copies the game's baked world-map PNGs into the dashboard |

The apps are deployed independently on **Orchard** (Hack Club's Kubernetes platform). `pixo-dm` is the exception and runs on Railway. Ignore any leftover `vercel.json` files.

**Data layer:** every app talks straight to a shared **Orchard Postgres** over `DATABASE_URL`. The project used to run on Supabase. Each app still has a `pgCompat.ts` shim (`apps/server/src/db/`, `apps/dashboard/lib/`, `apps/pixorpheus/src/db/`) that copies the subset of the Supabase query-builder API the call sites use. In `apps/server` it is even still exported as `supabase`. That object is not a real Supabase client, so only use builder methods that `pgCompat.ts` actually implements. There is no shared internal API between apps. Each one queries the DB directly, and identity comes from Hack Club Auth (players) or Slack OAuth (dashboard admins).

## Commands

Run these from the repo root.

```bash
bun install                              # all workspaces
bun run dev                              # every app's dev server (turbo)
bun run landing | dashboard | web-shell  # one Next app via turbo --filter
bun run build                            # turbo build

# Generated-copy syncs (see "Shared packages" below)
bun run config:sync      # after editing packages/config/pixl.json
bun run theme:sync       # after editing packages/theme/palette.json
bun run docs:build       # OG cards for docs/*.md -> apps/web-shell/public/<slug>/
bun run previews:build   # OG cards for hand-authored web-shell pages
bun run map:sync         # after re-baking a world map in apps/game
bun run npcs:bake

# Per app
bun run --cwd apps/server dev            # tsx watch src/index.ts
bun run --cwd apps/server build          # tsc -> dist/
bun run --cwd apps/dashboard dev         # port 4900
bun run --cwd apps/web-shell dev         # port 4901
bun run --cwd apps/pixorpheus dev        # bun --watch, no build step
bun run --cwd <app> typecheck            # dashboard, web-shell, pixorpheus
bun run --cwd apps/landing lint          # eslint
```

### Tests

All tests use `bun test`. Every app except `pixo-dm` has a `test` script, and there is no root test suite. Tests sit next to their sources (`foo.ts` / `foo.test.ts`).

```bash
bun run --cwd apps/server test                                # whole app
cd apps/server && bun test src/routes/shop.test.ts            # single file
cd apps/server && bun test src/routes/shop.test.ts -t "name"  # single test
```

The `*.db.test.ts` files need a real Postgres. Without `PIXL_TEST_DATABASE_URL` set they fail with a message that gives the setup:

```bash
docker run -d --name pixl-test-pg -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:16
PIXL_TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres bun test src/routes/forms.db.test.ts
```

Each test run creates a throwaway database and applies `apps/server/drizzle/*.sql` to it.

### Migrations

`apps/server/drizzle/` contains **hand-written** numbered SQL files. No Drizzle `schema.ts` exists, so `db:generate` does nothing useful. To add a migration, write the next-numbered `.sql` file and explain the reason in a header comment, the way existing files do. Several people push migrations at the same time and some numbers already collide, so check the current highest number on `main` right before you pick one. Write migrations to be safe to re-run (`if not exists`, `create or replace`).

`meta/_journal.json` stops at `0122`. Newer files aren't in it, so neither `drizzle-kit migrate` nor `src/scripts/apply-migrations.ts` will apply them. That script only covers the journaled migrations: it runs one transaction per migration and was written because `drizzle-kit migrate` got OOM-killed. The `*.db.test.ts` harness applies every `.sql` file directly, so it does cover new ones.

## Shared packages: generated, committed copies

Nothing imports `@pixl/config` or `@pixl/theme` at runtime. Each app is built from its own directory, so a workspace package wouldn't resolve. Each sync script writes **committed generated copies** into the apps instead. Never hand-edit those copies; edit the source JSON and re-sync.

- **config** (`packages/config/pixl.json`): never hardcode the launch date, the Hackatime cutoff, pixl.hackclub.com URLs or economy rates. Server and pixorpheus import `./config.generated.js` (they run as ESM, so keep the `.js` extension). Landing and dashboard import `@/app/_generated/config`. The game reads `apps/game/pixl.json` (via `scripts/pixl_config.gd`) and `Pixl.config` in `apps/game/web/pixl.js`. Dates are ISO-8601 UTC, so always format them with `timeZone: "UTC"`. Copy that depends on launch state switches itself through `hasLaunched()`.
- **theme** (`packages/theme/palette.json`): writes `apps/game/theme.json` and the token block between the `/* <pixl-theme:...> */` markers in `apps/game/web/pixl.css`. Godot only gets the `godot.dark` subset because the game has no light mode.
- **docs-engine**: doc files are named `<order>-<slug>.md`. `{{token}}` placeholders come from `pixl.json` through `src/tokens.ts`, and an unknown token fails the build. `apps/web-shell` imports `render()` from this package directly. That's the only cross-workspace import in the repo, and it only works because web-shell's Dockerfile uses the repo root as its build context. Its Next config also relies on `output: "standalone"` for the same reason.

## Architecture notes

### `apps/server`
- `src/index.ts` mounts the Express routers in `src/routes/*`, plus feature folders such as `src/ysws/` (archive, cross-YSWS double-dip detection), `src/macondo/` (Macondo journal integration), `src/operations/` and `src/hackatime/`.
- The real-time game runs in `src/ws/gameServer.ts`, which owns the multiplayer loop. Private villages and lobbies live in `src/ws/lobbies.ts`.
- `src/auth/session.ts` issues JWTs signed with `JWT_SECRET`, and Hack Club Auth is the identity provider. Public forms (`routes/forms.ts`) are no-account. They verify the submitter by Slack ID, and the questions and close date are edited from the dashboard.
- Moderation (`moderation.ts`, `imageValidation.ts`) feeds the dashboard review queue. XP and levels live in `xp.ts`.
- Some sensitive player fields are encrypted at rest. The dashboard decrypts them with `decryptPII` (`apps/dashboard/lib/crypto.ts`).

### `apps/game`
- This is a Godot 4 project, not a JS one, so don't `bun install` or run it.
- The minimap and world map draw baked PNGs (`assets/map/*.png` + `bounds.json`). To re-bake, run `scripts/tools/bake_world_map.gd` from the editor (File > Run) or `godot --script scripts/tools/bake_world_map_cli.gd`. The CLI needs a real display, because `--headless` produces black images. Run `bun run map:sync` afterwards.

### Next.js apps (`landing`, `dashboard`, `web-shell`)
- These use **Next.js 16** and React 19, which are newer than most training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next code (`apps/landing/AGENTS.md` asks for this) and follow the deprecation notices.
- **landing** is localized under `app/[lang]/dictionaries/`. The dictionary arrays used by `Shop.tsx`/`Sidequests.tsx` are matched to images by index. Add, remove or reorder items the same way in every locale file, or names and prices quietly land on the wrong images.
- **dashboard** mutations live mostly in the large `app/actions.ts` server-action file. **Live mode** (`lib/liveMode.ts`, `lib/liveModeServer.ts`) is a per-viewer cookie that lets staff stream the dashboard without leaking identities. Real names, emails, addresses, Hackatime, referrals, reports, bans and other reviewers' names are replaced **on the server** (for example via `liveAlias`/`reviewerName`), and PII-only sections such as fulfillment, Slack lookup and the CSV export are blocked. Any new page or API route that shows player data must respect live mode.
- **web-shell** has no public hostname of its own. `apps/landing/next.config.ts` `rewrites()` proxies it over cluster DNS. Each page family uses its own literal route segment, and there is no app-wide `basePath`. Auth works through an httpOnly `pixl_session` cookie that holds the same JWT `apps/server` issues. `proxy.ts` moves a `?token=` query param into that cookie, and `lib/session.ts` verifies it, which means `JWT_SECRET` must match the server's. Server Components call the game server through `lib/server-api.ts`. Client Components send mutations through `app/api/proxy/[...path]/route.ts`. The `(shell)` route group renders the sidebar/topbar, which is ported from `pixl.js`'s `mountTopbar()`. Pages that are still on the old static site keep the localStorage token flow. Economy formulas (`rePerHour`, `projectPayoutUsd` in `pixl.js`) haven't been ported yet. If you port them, their output must match the server math exactly, and they need tests. Migration design: `docs/superpowers/specs/2026-08-23-react-migration-design.md`, with per-slice plans in `docs/superpowers/plans/`.

### `apps/pixorpheus`
- A single Bolt v4 process (`src/index.ts`) with code organized by feature (`tickets/`, `chat/`, `ai/`, `memory/`, `commands/`, `shop/`, `external/`, ...). `models.json` lists the OpenRouter models it can use. The dashboard resolves tickets through `src/external/ticketApi.ts`. One-off backfills live in `src/scripts/` (`backfill:pixl-channel`, `backfill:review-channel`). Read `apps/pixorpheus/README.md` before changing bot behavior.

## Conventions

- Default to Bun: `bun <file>`, `bun test`, `bunx`, `bun run`. Bun loads `.env` automatically, so don't add `dotenv` to new code. `apps/server`'s scripts still call `tsx`/`node`/`drizzle-kit`; leave them unless asked to change them. Each app has its own `.env` (see `.env.example` where one exists).
- Don't use em dashes in code, comments or docs. They were removed from the whole codebase on purpose.
- Always write "Hack Club" with that exact spelling and capitalization.
- `backups/` and `shop/` at the repo root are local, untracked data dumps (including a production DB dump). Never commit them.
