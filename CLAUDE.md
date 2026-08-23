# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

Pixl is a Bun/Turborepo monorepo (`bun` workspaces: `apps/*`, `packages/*`) for a Hack Club YSWS ("You Ship, We Ship") pixel-art multiplayer game.

| App | Stack | Purpose |
|---|---|---|
| `apps/server` | Bun, Express, `ws`, Drizzle ORM, Supabase (Postgres) | Game server — auth, player state, WebSocket game/lobby logic, projects, shop, economy |
| `apps/game` | Godot 4 | The 2D multiplayer game client (not TypeScript — GDScript/Godot project) |
| `apps/landing` | Next.js 16, React 19, Tailwind 4 | Marketing site (pixl.rsvp) |
| `apps/dashboard` | Next.js 16, React 19, Tailwind 4, shadcn/radix, Supabase | Admin/review dashboard — moderation, tickets, review queue, stats |
| `apps/web-shell` | Next.js 16, React 19 | React migration of the player-facing web shell — docs (`/docs`) so far, `/shop`/`/dashboard`/etc. still on the old static site. See below. |
| `apps/pixorpheus` | Bun, TypeScript, Slack Bolt v4, Express, Supabase | Slack bot — tickets, AI chat, moderation DMs, slash commands |
| `apps/pixo-dm` | Node (CommonJS), Express | Standalone Railway service that relays dashboard-initiated player DMs through Slack as Pixo — plain `node index.js`, not Bun-native; don't convert it unprompted |
| `packages/config` | JSON + plain ESM | **Single source of truth** for the program's facts — name, launch date, Hackatime cutoff, canonical URLs, economy rates. See below. |
| `packages/theme` | JSON + plain ESM | **Single source of truth** for the LEDGER color palette (dark/light, web + Godot). See below. |
| `packages/docs-engine` | Bun/TypeScript | Builds `docs/*.md` into static per-page HTML + OG preview cards under `apps/game/web/docs/`. See below. |

Each app has its own `package.json`/scripts and is largely independent; they share only Supabase as a common data layer (each app talks to Supabase directly rather than through a shared internal API), plus Hack Club Auth/Slack OAuth for identity.

## Commands

Run from the repo root unless noted. This repo uses Bun — see the Bun-specific guidance below.

```bash
bun install                                  # install all workspaces

# Turborepo shortcuts (root package.json)
bun run dev                                  # run all apps' dev servers concurrently
bun run landing                              # turbo dev --filter=@pixl/landing
bun run dashboard                             # turbo dev --filter=@pixl/dashboard
bun run web-shell                            # turbo dev --filter=@pixl/web-shell
bun run build                                # turbo build (all apps)
bun run config:sync                          # regenerate committed config copies (packages/config)
bun run theme:sync                           # regenerate committed theme/palette copies (packages/theme)
bun run docs:build                           # regenerate apps/web-shell/public/<slug>/og.png from docs/*.md (packages/docs-engine)
bun run previews:build                       # regenerate OG preview cards for hand-authored web-shell pages (/shop, /ideas, ...)

# Per-app (cd into the app, or use --cwd)
bun run --cwd apps/server dev                # game server, tsx watch on src/index.ts
bun run --cwd apps/server build              # tsc build to dist/
bun run --cwd apps/server db:generate        # drizzle-kit generate (schema -> migration)
bun run --cwd apps/server db:migrate         # drizzle-kit migrate
bun run --cwd apps/server db:studio          # drizzle-kit studio

bun run --cwd apps/landing dev               # next dev
bun run --cwd apps/dashboard dev    # next dev -p 4900
bun run --cwd apps/dashboard typecheck  # tsc --noEmit

bun run --cwd apps/pixorpheus start          # Slack bot (src/index.ts), Bun-native, no build step
bun run --cwd apps/pixorpheus dev            # same, with --watch
bun run --cwd apps/pixorpheus typecheck      # tsc --noEmit
```

There is no root-level test suite; `apps/pixorpheus`'s `test` script is a placeholder. Check an individual app's `package.json` before assuming a script (lint/typecheck/test) exists there.

### Environment

Each app has its own `.env` (see `.env.example` where present, e.g. `apps/server/.env.example`). Bun auto-loads `.env` files — don't add `dotenv` to Bun-run apps (note `apps/server` still imports `dotenv/config` itself in some files; follow existing conventions in that file rather than changing it unprompted — `apps/pixorpheus` relies on Bun's auto-load and has no `dotenv` dependency). Common vars: `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` (shared across apps), `JWT_SECRET`, Hack Club Auth (`HCA_CLIENT_ID`/`SECRET`/`REDIRECT_URI`), Slack tokens for `pixorpheus`/`dashboard`.

### `packages/config` (shared program facts)

Never hardcode the launch date, the Hackatime cutoff, a pixl.rsvp URL or the
economy rates in an app — they all live in `packages/config/pixl.json`.

- Nothing imports `@pixl/config` at runtime, not even the TS apps — Railway/Vercel build each app from its own `/apps/<app>` root, so a workspace package outside that root doesn't resolve there. Every consumer instead reads a **generated, git-committed copy** produced by `bun run config:sync` after you edit `pixl.json` — never hand-edit the generated files, the next sync overwrites them.
- **TS apps**: `server`/`pixorpheus` import `../config.generated.js` (the `.js` extension is required — they run as ESM); `landing`/`dashboard` import `../_generated/config` (or the `@/app/_generated/config` alias) — all expose `config`, `launchDate`, `hackatimeCutoffUnix`, `hasLaunched`, `launchDateLabel`, etc.
- **Godot** (`apps/game/scripts/pixl_config.gd`) reads `apps/game/pixl.json`, and **the game's web pages** read `Pixl.config` in `apps/game/web/pixl.js` — both are also generated copies from the same sync.
- Dates are ISO-8601 **UTC**. Format them with `timeZone: "UTC"`; a naive `new Date("2026-08-18T00:00:00")` means midnight in the *reader's* timezone and is the exact drift this package exists to stop.

Launch-state copy (Pixo's persona/FAQ, the Slack welcome messages) switches itself
via `hasLaunched()` — there is no string to flip on launch day.

### `packages/theme` (LEDGER palette, generated design tokens)

`palette.json` is the one place the LEDGER palette (dark/light) lives as data — named
color tokens the game, the web shell, and the docs previews all read.

- Nothing imports `@pixl/theme` at runtime, for the same build-isolation reason as `@pixl/config`. Run `bun run theme:sync` after editing `palette.json`; it rewrites `apps/game/theme.json` (read by `apps/game/scripts/pixl_theme.gd`) and the token lines inside `apps/game/web/pixl.css`'s `:root{}` blocks, between `/* <pixl-theme:...> */` markers — both are committed but **generated, never hand-edit them**.
- `godot.dark` only carries the token subset Godot actually consumes; `godot.light` doesn't exist yet (no light-mode design for the game) — `PixlTheme` falls back to `godot.dark` regardless of the player's web-shell choice.
- `packages/docs-engine/src/og.ts` reads `web.dark` directly at build time for preview cards, so it never needs its own synced copy.

### `packages/docs-engine` (docs build)

Doc *pages* now render in `apps/web-shell` (see below) — this package only still generates OG preview cards. `bun run docs:build` writes one `og.png` per doc into `apps/web-shell/public/<slug>/` (no `docs/` nesting there on purpose — `apps/web-shell` sets `basePath: "/docs"`, which already prefixes everything under `public/`). Source files are named `<order>-<slug>.md` (order sets nav position, slug sets the URL). `{{token}}` placeholders pull from `packages/config/pixl.json` at build time via `packages/docs-engine/src/tokens.ts`'s `buildTokens()` — re-run after editing `pixl.json`; unknown tokens fail the build. `packages/docs-engine/src/markdown.ts`'s `render()` (the actual markdown-to-HTML parser) is imported directly by `apps/web-shell/lib/docs.ts` as a workspace package — this is the one place in the repo that happens, since `apps/web-shell`'s Dockerfile uses a repo-root build context specifically to make that resolve (see below).

## Architecture notes

### `apps/server` (game server)
- Entry point `src/index.ts`; Express HTTP routes live under `src/routes/*` (auth, profile, projects, shop, sidequests, story, friends, explore, admin, reports, hackatime, vault, notifications, uploads, events).
- Real-time game state is handled separately in `src/ws/gameServer.ts` (the authoritative multiplayer/WebSocket loop) and `src/ws/lobbies.ts` (private village / lobby grouping).
- `src/auth/session.ts` issues/validates JWT sessions signed with `JWT_SECRET`; Hack Club Auth (HCA) is the identity provider.
- `src/db/client.ts` + `src/db/schema.ts` (Drizzle) define the Postgres schema (via Supabase). Run `db:generate` after schema changes, then `db:migrate` to apply.
- Cross-cutting concerns: `src/xp.ts` (leveling/XP), `src/moderation.ts` / `src/imageModeration.ts` (content moderation, ties into `dashboard`'s review queue), `src/rateLimit.ts`, `src/hackatime/api.ts` (coding-time tracking integration), `src/shipsArchive.ts` (project submission history).

### `apps/game` (Godot client)
- Not a Node/Bun project — it's a Godot 4 project (`project.godot`, `scenes/`, `scripts/`, `addons/`, `shaders/`). GDScript, not TypeScript. Don't try to `bun install`/run it like the other apps.
- `web/` holds the web export target; `exports/` and `build/` hold build artifacts (gitignored).
- The minimap and world map draw a **baked** top-down PNG of each world (`assets/map/*.png` + `bounds.json`), produced by `scripts/tools/world_map_baker.gd`. Re-bake after moving tilemaps: open `scripts/tools/bake_world_map.gd` in the editor and hit File > Run, or `godot --script scripts/tools/bake_world_map_cli.gd` (needs a real display — `--headless` bakes black). If the PNGs are missing both maps fall back to a flat placeholder rect.

### `apps/landing` and `apps/dashboard` (Next.js)
- Both run **Next.js 16** with React 19 and Tailwind 4 (very recent — training-data knowledge of Next.js APIs/conventions is likely stale). `apps/landing` has an `AGENTS.md` flagging this explicitly: **read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code in either app**, and heed deprecation notices.
- `dashboard` runs on port 4900 (`next dev -p 4900` / `next start -p 4900`) since multiple apps run concurrently in dev. It uses shadcn/radix-ui components and talks to Supabase directly plus Slack OAuth (`app/api/auth/*`) for admin login.
- Page routes follow Next App Router conventions (`app/<route>/page.tsx`); shared page-local components live in `app/_components/`.

### `apps/web-shell` (React migration of the player-facing web shell)
- Next.js 16 App Router, first slice is docs-only (`/docs/*`) — see `docs/superpowers/specs/2026-08-23-react-migration-design.md` for the full migration design and `docs/superpowers/plans/2026-08-23-react-migration-docs-slice.md` for what's built vs. planned. Every other web-shell path (`/shop`, `/dashboard`, etc.) still runs on the old static site under `apps/game/web/` until its own migration slice.
- Deployed on Orchard (`pixl-web-shell`, no public hostname of its own — see next point), proxied at `pixl.hackclub.com/docs` via `apps/landing/next.config.ts`'s `rewrites()`.
- Reaches the outside world only through that proxy, so it uses `basePath: "/docs"` (`next.config.ts`) to keep every Next-generated URL (asset chunks, `next/link` hrefs) correctly prefixed — **this is why the app's own route tree has no literal `docs` segment** (`app/[slug]/page.tsx`, not `app/docs/[slug]/page.tsx`; basePath adds that back at request time). Plain `<a>`/`<img>` tags and CSS `url()` are *not* auto-prefixed by basePath, so those carry an explicit `/docs/` by hand where they appear in the code — same reasoning applies to anything public/-served, including the OG cards `packages/docs-engine` writes.
- Reads `docs/*.md` directly via `packages/docs-engine`'s `render()`/`buildTokens()` (a workspace-package import — this app's Dockerfile uses a repo-root build context specifically so that resolves, unlike `apps/dashboard`'s isolated per-app context).
- `apps/landing` reaches it over the Orchard cluster's internal service DNS (`pixl-web-shell.ysws-pixl.svc.cluster.local:3000`), not a public hostname — both run as Orchard deployments in the same `ysws-pixl` k8s namespace, so no DNS record is needed for the hop.
- Docker image uses Next's `output: "standalone"` — required in this monorepo, not just an optimization: without it, the runtime stage would need to drag along the whole workspace's hoisted `node_modules` (Bun installs into a shared `/repo/node_modules/.bun/...` store for any workspace-package-dependent app, since the install runs against the root `package.json`) to keep `apps/web-shell/node_modules`'s symlinks from dangling. `output: "standalone"` traces the real dependency graph into concrete files instead.

### `apps/pixorpheus` (Slack bot)
- Bun-native TypeScript, no build step (`bun run src/index.ts`) — a single Bolt v4 process, organized by feature under `src/` (`tickets/`, `chat/`, `ai/`, `memory/`, `commands/`, `pixelate/`, `github/`, `external/`, `slack/`). There is no separate dashboard process anymore — helper/admin ticket moderation lives in `apps/dashboard` (the Next.js app), which resolves tickets through `src/external/ticketApi.ts` on this bot.
- `models.json` lists OpenRouter models available to the AI chat/roast/fact features.
- See `apps/pixorpheus/README.md` for the full slash-command reference and architecture table before modifying bot behavior.

### `apps/pixo-dm` (Pixo DM relay)
- Small standalone Express service (`index.js`, CommonJS, plain `node`/`require` — not Bun-native, deliberately not ported): exposes `POST /api/external/dm`, called by `apps/dashboard` to deliver a player DM through Slack as Pixo, authenticated with `EXTERNAL_API_KEY`.
- Runs on its own Railway deployment separate from `apps/pixorpheus`; enforces a per-user, global, and daily rate limit in-process (in-memory, so state resets on redeploy) to bound blast radius if the API key leaks.

## Bun usage

Default to Bun over Node.js/npm/yarn/pnpm across this repo (this applies to `apps/server` too, even though its `package.json` scripts currently invoke `tsx`/`node`/`drizzle-kit` directly — don't rewrite those scripts unprompted, but use `bun` for anything new).

- `bun <file>` instead of `node <file>` or `ts-node <file>`
- `bun test` instead of `jest`/`vitest`
- `bun build <file>` instead of `webpack`/`esbuild`
- `bun install` instead of `npm`/`yarn`/`pnpm install`
- `bun run <script>` instead of `npm run`/`yarn run`/`pnpm run`
- `bunx <package>` instead of `npx <package>`
- Bun auto-loads `.env` — don't add `dotenv` to new Bun code.
- `Bun.serve()` for HTTP/WebSocket servers (supports routes, WS, HTTPS) instead of `express` in new Bun code.
- `bun:sqlite` instead of `better-sqlite3`; `Bun.redis` instead of `ioredis`; `Bun.sql` instead of `pg`/`postgres.js`; built-in `WebSocket` instead of `ws`.
- `Bun.file` over `node:fs` readFile/writeFile.
- `Bun.$\`cmd\`` instead of `execa`.

For HTML-import-based frontends (not used by the Next.js apps here, but the default for any new Bun frontend): `Bun.serve()` serving an `index.html` that `<script type="module" src="./frontend.tsx">`s a React entrypoint — no Vite. See `node_modules/bun-types/docs/**.mdx` for the full Bun API reference.

## Communication style: Gen Z Developer Mode

You are still an elite software engineer first. This section only governs tone in chat, not code.

**Personality**
- Talk naturally and casually, like a smart Gen Z programmer. Slang (`yo`, `fr`, `ngl`, `lowkey`, `cooked`, `W`, `L`, `based`, 💀, 🙏, 🔥) is fine but never forced into every sentence — natural over cringe.
- React honestly: bug fixed → `W`; nasty bug → `bro we were COOKED`; clever fix → `that's actually kinda fire`; bad code → say it's bad straight up, no corporate hedging.
- Match the user's energy — if they go serious, drop the slang.

**Coding behavior stays unchanged**
- Inspect the existing codebase before assuming. Follow existing architecture/conventions. Don't rewrite working code unprompted. Verify with tests/typecheck/build before claiming something works.

**Scope**
- Casual register + emojis are for chat prose only. Code, commit messages, UI copy, and docs stay clean and emoji-free — see the no-emojis and casual-commits conventions already in play for this repo.

**Final response format** (when it's a real task, not chit-chat)

**What I changed**
- short bullet

**Why**
- brief explanation

**Checks**
- tests/build/typecheck results

Core rule: speak like Gen Z, think like a senior engineer. For destructive commands or risky changes, drop the goofiness and warn clearly.
