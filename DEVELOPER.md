<h1 align="center">
  <br>
  <img width="45%" alt="Pixl" src=".github/readme-assets/header-wordmark.png">
  <br>
</h1>

<h4 align="center">
A <a href="https://hackclub.com/">Hack Club</a> YSWS - ship a real project, get real hardware. Built by Gabin, Ridit, and Ricky.
</h4>

<div align="center">

![License](https://img.shields.io/badge/License-MIT-green.svg)
![Runtime](https://img.shields.io/badge/Bun-1.3+-000000.svg)
![Game](https://img.shields.io/badge/Godot-4-478CBF.svg)
![Hack Club](https://img.shields.io/badge/Hack%20Club-YSWS-EC3750.svg)

</div>

<p align="center">
  <a href="#what-is-pixl">What is Pixl?</a> |
  <a href="#repository-structure">Structure</a> |
  <a href="#the-game">Game</a> |
  <a href="#the-landing-site">Landing</a> |
  <a href="#the-game-server">Server</a> |
  <a href="#the-web-shell">Web Shell</a> |
  <a href="#the-admin-dashboard">Dashboard</a> |
  <a href="#pixorpheus">Pixorpheus</a> |
  <a href="#pixo-dm">Pixo DM</a> |
  <a href="#getting-started">Getting Started</a>
</p>

---

## Table of Contents

- [What is Pixl?](#what-is-pixl)
  - [Sidequests vs. shipping your own project](#sidequests-vs-shipping-your-own-project)
- [Repository Structure](#repository-structure)
- [The Game](#the-game)
- [The Landing Site](#the-landing-site)
- [The Game Server](#the-game-server)
  - [API Routes](#api-routes)
  - [Real-time layer](#real-time-layer)
  - [Economy](#economy)
  - [Database](#database)
- [The Web Shell](#the-web-shell)
- [The Admin Dashboard](#the-admin-dashboard)
- [Pixorpheus](#pixorpheus)
- [Pixo DM](#pixo-dm)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Install](#install)
  - [Environment Variables](#environment-variables)
  - [Run](#run)
  - [Shared config/theme/assets](#shared-configthemeassets)
  - [Database Migrations](#database-migrations)
- [Contributing](#contributing)
- [License](#license)

---

## What is Pixl?

Pixl is a **YSWS** ("You Ship, We Ship") from [Hack Club](https://hackclub.com/), the 501(c)(3) nonprofit for teenage programmers. In a YSWS, a teenager ships a real project and gets real hardware or prizes back, no strings attached. Pixl frames that as a 2D multiplayer world: players explore regions, take on sidequests, ship real projects through an in-game NPC, and get graded by human reviewers through the admin dashboard.

- Every completed, approved project gets funded - there's no lottery
- Solo or team, any skill level, mentors help if you're stuck
- Live at [pixl.hackclub.com](https://pixl.hackclub.com)

A shipped project converts into **Restoration Energy** (RE), which sets your Pixel payout rate, plus a real prize matched to what you built. RE also drives player level and unlocks new regions/sidequests community-wide as the whole player base ships more. **Pixels** are the in-game currency, spent in the shop on grants, hardware, and merch.

### Sidequests vs. shipping your own project

Sidequests are pre-defined problems an NPC in an already-unlocked region needs solved, roughly tiered by size:

| Tier | Approx. hours | Example |
|---|---|---|
| Beginner | ~7h | Build a merchant's storefront -> domain + stickers. Make a Roblox game -> 2,000 Robux |
| Intermediate | ~20-30h | Ship a mobile app -> Apple Developer account. Design a game region -> graphics tablet |
| Expert | ~55-65h | Network intrusion detection system -> Flipper Zero. Build a robot arm -> full PCB manufacturing run |

Prizes are swappable for equivalent value. Shipping something entirely of your own (no sidequest) earns hours, RE, and Pixels the same way.

---

## Repository Structure

Bun + Turborepo monorepo. Every app talks to the same [Supabase](https://supabase.com/) (Postgres) project directly rather than through a shared internal API, plus Hack Club Auth / Slack OAuth for identity. Deployed on [Orchard](https://orchard.my) (Kubernetes), not Vercel, despite some apps still shipping a `vercel.json` from an earlier deploy target.

```
pixl/
├── apps/
│   ├── server/          Bun game server - Express + WebSocket + Drizzle
│   ├── game/             Godot 4 game client
│   ├── landing/          Next.js marketing site + apex proxy (pixl.hackclub.com)
│   ├── web-shell/        Next.js player-facing web pages (React migration of apps/game/web)
│   ├── dashboard/        Next.js admin/review dashboard
│   ├── pixorpheus/       Slack bot - tickets, AI chat, moderation
│   └── pixo-dm/          Standalone relay for dashboard -> Slack player DMs
├── packages/
│   ├── config/            Shared program facts (launch date, economy rates, URLs)
│   ├── theme/              Shared LEDGER color palette (dark/light, web + Godot)
│   ├── docs-engine/        Builds docs/*.md into web-shell pages + OG cards
│   └── map-sync/           Copies baked world-map PNGs into the dashboard
├── package.json           Monorepo root (Bun workspaces + Turborepo)
└── bun.lock
```

| App | Stack | Description |
|---|---|---|
| [`server`](apps/server) | Bun, Express, `ws`, Drizzle ORM, Supabase | Game server - auth, player state, real-time multiplayer, projects, shop, economy |
| [`game`](apps/game) | Godot 4 (GDScript) | The 2D multiplayer world players see and play in |
| [`landing`](apps/landing) | Next.js 16, React 19, Tailwind 4 | Marketing site and apex proxy at [pixl.hackclub.com](https://pixl.hackclub.com), localized in English, French, Spanish, Portuguese |
| [`web-shell`](apps/web-shell) | Next.js 16, React 19 | Player-facing pages being migrated off `apps/game/web`'s static HTML - docs, and a growing shell (`/dashboard`, `/form/*`) |
| [`dashboard`](apps/dashboard) | Next.js 16, React 19, Tailwind 4, shadcn/radix | Admin dashboard - project review, moderation, tickets, shop, stats |
| [`pixorpheus`](apps/pixorpheus) | Bun, Slack Bolt v4, Express | Slack bot - help tickets, AI chat, moderation DMs, slash commands ([full docs](https://github.com/gabouin/pixorpheus)) |
| [`pixo-dm`](apps/pixo-dm) | Node.js (CommonJS), Express | Small Railway service that relays dashboard-initiated player DMs through Slack as Pixo |

### Packages

Shared code, each generating committed copies for the apps that can't import a workspace package directly (Vercel/per-app builds don't see outside their own app root):

| Package | Purpose |
|---|---|
| `config` | Single source of truth for launch date, Hackatime cutoff, canonical URLs, economy rates (`pixl.json`) |
| `theme` | Single source of truth for the LEDGER color palette, dark/light, web + Godot |
| `docs-engine` | Renders `docs/*.md` into web-shell pages and generates OG preview cards |
| `map-sync` | Copies baked world-map PNGs from `apps/game` into the dashboard's NPC spot-picker |

---

## The Game

<img alt="Pixl gameplay - a shared open-world village with real players" src=".github/readme-assets/game-screenshot.png" width="640">

`apps/game` is the 2D multiplayer world, built in **Godot 4** (GDScript, not TypeScript). It exports both as a native build and as a WebAssembly build embedded on the web (`apps/game/web/`), reachable from a browser at [play.pixl.hackclub.com](https://play.pixl.hackclub.com).

Key client-side systems (`apps/game/scripts/`):

| System | File(s) | What it does |
|---|---|---|
| Multiplayer world | `multiplayer_world.gd`, `network_manager.gd`, `remote_player.gd` | Keeps every connected player's position/state in sync over WebSocket |
| Character & skins | `character_editor.gd`, `skin_util.gd` | Draw-your-own 16x16 pixel avatar |
| Villages & lobbies | `village.gd`, `lobby_menu.gd`, `house_interior.gd`, `door_trigger.gd`, `house_trigger.gd`, `stair_trigger.gd` | Shared open world plus private "village" instances players can retreat to |
| NPCs & dialogue | `npc.gd`, `dialogue.gd`, `markdown_util.gd` | Sidequest-giving NPCs and their (Markdown-capable) dialogue |
| HUDs | `chat_hud.gd`, `friends_hud.gd`, `emote_hud.gd`, `minimap_hud.gd`, `inbox_hud.gd`, `profile_hud.gd`, `player_hud.gd`, `guide_hud.gd` | In-game chat, friends list, emotes, minimap, inbox/notifications, profile card, first-run guide |
| Web bridge | `web_pages.gd` | Opens browser-hosted pages (shop, vault, explore, quests, timeline, projects, report, docs, hackatime) from inside the game, passing the player's session token |
| Animals & world dressing | `animal.gd`, `water.gd`, `shadow.gd`, `music.gd` | Ambient world life, water shaders, dynamic shadows, music |

The web pages opened via `web_pages.gd` (shop, vault, explore, etc.) are static pages under `apps/game/web/`, sharing a small helper library (`pixl.js`) that exposes `Pixl.api`, `Pixl.send`, `Pixl.loadWallet`, and `Pixl.mountTopbar`. They call directly into [the game server's API](#the-game-server) using the token the Godot client hands them. Newer pages are being rebuilt in `apps/web-shell` instead - see below.

---

## The Landing Site

<img alt="pixl.hackclub.com - the marketing site" src=".github/readme-assets/landing-hero.jpg" width="640">

`apps/landing` is the public site at [pixl.hackclub.com](https://pixl.hackclub.com) - Next.js 16, React 19, Tailwind 4, localized (`en`/`fr`/`es`/`pt`/`hi`) via `app/[lang]/dictionaries/*.json`. It also proxies most of the game/web-shell's paths so everything lives under one apex domain (`next.config.ts`'s `rewrites()`): `/play` to the game host, `/docs` and `/form` to `apps/web-shell` over the Orchard cluster's internal service DNS, and shop/vault/explore/etc. to the game host's static pages.

| Section | Component | Purpose |
|---|---|---|
| Hero | `Hero.tsx` | The pitch, RSVP email capture, "Test the game" CTA |
| Story | `Story.tsx` | Short lore section |
| Sidequests | `Sidequests.tsx` | An auto-scrolling marquee of example sidequests |
| Shop | `Shop.tsx` | An auto-scrolling, drag-to-scroll marquee of real shop items with live Pixel prices |
| FAQ | `FAQ.tsx` | Common questions (who can join, is it really free, when does it launch) |
| Example Submission | `ExampleSubmission.tsx` | Shows what a real project submission looks like |
| Language switcher | `LanguageSwitcher.tsx`, `LocaleProvider.tsx` | Client-side locale switching without a full reload |

<img alt="The Shop section on the landing page" src=".github/readme-assets/landing-shop.jpg" width="640">

The Shop carousel mirrors the real in-game shop 1:1 - item name, description, image, and Pixel price come from `Shop.tsx`'s `ITEM_IMAGES`/`ITEM_PRICES` arrays plus each locale's `shop.items` dictionary, kept in index alignment across all locales. The marquee is a hand-rolled `requestAnimationFrame` component (not Framer Motion's `animate()`), so pressing down reliably pauses it mid-scroll.

---

## The Game Server

<img alt="Server icon" src=".github/readme-assets/icon-server.png" width="72" align="left">

`apps/server` is the authoritative backend: a **Bun** process running **Express** for HTTP routes and raw **WebSocket** (`ws`) for real-time game state, with **Drizzle ORM** over a **Supabase** (Postgres) database.

<br clear="left">

### API Routes

All mounted from `src/index.ts`, one router per concern (`src/routes/*.ts`):

| Router | Handles |
|---|---|
| `auth` | Hack Club Auth (HCA) login flow, JWT session issuance/validation |
| `profile` | Player profile data, onboarding progress |
| `projects` | Project submission, ships archive, YSWS double-dip checks |
| `hackatime` | Coding-time tracking integration (auto-computed project hours) |
| `shop` | `GET /api/shop/items`, `POST /api/shop/buy/:id`, `POST /api/shop/claim/:id` - the real purchasing flow |
| `sidequests` | Sidequest listing and completion |
| `story` | Chapter/Operations story state |
| `explore` | Region/world exploration data, public project browsing |
| `friends` | Friends list, requests |
| `notifications` | In-game inbox/notifications |
| `events` | Community/world events |
| `vault` | The Core's vault - community goal progress |
| `reports` | Player-submitted reports |
| `forms` | Public, no-account forms (e.g. reviewer applications) |
| `uploads` | Image/asset uploads (screenshots, avatars) |
| `admin` | Endpoints the [dashboard](#the-admin-dashboard) calls with a server-side admin key |

### Real-time layer

`src/ws/gameServer.ts` is the authoritative multiplayer loop (player positions, chat, presence). `src/ws/lobbies.ts` handles grouping players into the shared open world vs. private villages.

### Economy

`packages/config/pixl.json`'s `economy` block defines the payout curve: RE per hour by project tier, a linear payout ramp from a base to a max $/hour rate as lifetime RE grows, and level bands. `apps/web-shell/app/_generated/config.ts` (a generated copy, see [Shared config/theme/assets](#shared-configthemeassets)) exposes the actual formulas (`rePerHour`, `payoutUsdPerHour`, `projectPayoutPx`, etc.) - the game server's own math must stay byte-for-byte identical to it.

Every Pixel change is logged to `pixel_transactions` (reasons like `shop_purchase` / `shop_refund`), so the full economy is auditable. The shop (`shop_items`, `shop_orders`, `shop_claims` tables) supports both purchasable items (bought with Pixels via the `buy_shop_item` Postgres function) and XP-gated trophies (`unlock_xp > 0`, claimed rather than bought).

### Database

Schema lives in two places:
- `src/db/schema.ts` - Drizzle-managed tables (`db:generate` / `db:migrate`)
- `drizzle/*.sql` - sequential raw SQL migrations, including data-only ones (e.g. seeding shop items)

Cross-cutting concerns: `moderation.ts` / `imageModeration.ts` (content moderation feeding the dashboard's review queue), `rateLimit.ts`, `ysws/doubleDip.ts` (cross-YSWS duplicate-submission detection), `shipsArchive.ts` (project submission history).

---

## The Web Shell

`apps/web-shell` is the in-progress React rewrite of `apps/game/web`'s static, hand-written pages. It's a separate Next.js 16 deployment with no public hostname of its own - `apps/landing` proxies specific paths to it over the Orchard cluster's internal service DNS (see [The Landing Site](#the-landing-site)).

- Docs (`/docs`) were the first slice moved over, rendered directly from `docs/*.md` via `packages/docs-engine`.
- Auth reuses the same JWT `apps/server` issues, stored in an httpOnly `pixl_session` cookie (`lib/session.ts`). Server Components call `apps/server` directly; Client Components go through a same-origin proxy route since the cookie isn't readable by client JS.
- The `(shell)` route group (`app/(shell)/layout.tsx`) renders the sidebar/topbar chrome around signed-in pages, ported from the old static site's `pixl.js`.
- Public, no-account forms (`/form/:formKey`) read their questions and close date from `apps/server`'s `forms` router, editable from the admin dashboard's Forms tab without a deploy.

Not every player-facing page has moved yet - anything not listed above still lives on the old static site under `apps/game/web/`.

---

## The Admin Dashboard

<img alt="Dashboard icon" src=".github/readme-assets/icon-dashboard.png" width="72" align="left">

`apps/dashboard` is the internal tool the Pixl team uses to run the program - review submissions, manage the shop, and moderate. Next.js 16 (shadcn/radix UI), gated behind Hack Club Auth plus a Slack-ID allowlist (`ADMIN_SLACK_IDS`), with a second, stricter allowlist (`SECOND_PASS_SLACK_IDS`) for who can give final project approval and credit Pixels.

<br clear="left">

| Page | Purpose |
|---|---|
| `review` | The project review queue - first-pass and final-pass grading |
| `projects` | All submitted projects |
| `players` | Player list and profiles |
| `sidequests` | Manage available sidequests |
| `story` | Manage chapters/Operations story state |
| `community-goals` | Manage vault levels - the community-wide chapter-unlock thresholds |
| `shop` | Create/edit/toggle/delete real shop items (name, description, price, image, options) |
| `fulfillment` | Track and fulfill real-world shop orders (mark shipped, cancel + refund) |
| `forms` | Review submissions from the public, no-account forms; edit each form's questions and close date |
| `tickets` | Slack help tickets synced from Pixorpheus |
| `reports` | Player-submitted reports |
| `violations` / `bans` | Moderation history, ban/warning actions |
| `pixels` | Manual Pixel adjustments |
| `online` | Live "who's online" view with kick, via the game server's admin API |
| `events` | Community/world event management |
| `admins` / `reviewers` | Manage who has dashboard/reviewer access, reviewer payout stats |
| `notify` | Send a notification/DM to a player |
| `stats` | Program-wide stats |

Player-facing DMs sent from the dashboard (e.g. review results) are routed through [Pixo DM](#pixo-dm) rather than a direct Slack token, with a Resend email fallback for players without a linked Slack account.

---

## Pixorpheus

<img alt="Pixorpheus" src="https://github.com/user-attachments/assets/7c35eff3-3afb-4c61-965a-4993cc2bcce5" width="72" align="left">

`apps/pixorpheus` is Pixl's Slack bot: help-desk ticket lifecycle (claim/resolve/reopen, auto-close after 5 days of inactivity, a Smart FAQ that checks past resolved tickets before a human gets pinged), an AI chat system with per-user memory and web search, and moderation DMs. Bun-native TypeScript, Slack Bolt v4, no build step.

<br clear="left">

It's maintained as its own repository with a more detailed README (slash commands, AI system, ticket flow, database schema, deployment): [github.com/gabouin/pixorpheus](https://github.com/gabouin/pixorpheus).

---

## Pixo DM

`apps/pixo-dm` is a small standalone Express service (`index.js`, CommonJS, plain `node`, not Bun-native) that exposes `POST /api/external/dm`, called by the dashboard to deliver a player DM through Slack as Pixo. Authenticated with `EXTERNAL_API_KEY`. Runs on its own Railway deployment, separate from `apps/pixorpheus`, and enforces per-user/global/daily rate limits in-process to bound blast radius if the API key leaks.

---

## Getting Started

### Prerequisites

- [Bun](https://bun.com) >= 1.3
- [Node.js](https://nodejs.org) >= 20 (for `pixo-dm`, which is plain CommonJS, not Bun)
- [Godot 4](https://godotengine.org/) (only if you're working on `apps/game`)
- A [Supabase](https://supabase.com/) project (shared Postgres database)

### Install

```bash
bun install
```

### Environment Variables

Each app has its own `.env` (see `.env.example` in `apps/server`, `apps/dashboard`, `apps/web-shell`, `apps/pixo-dm`). Bun auto-loads `.env` files. Common vars shared across apps:

- `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` - same Supabase project everywhere
- `JWT_SECRET` - signs game server sessions; must match exactly between `server`, `dashboard`, and `web-shell`
- Hack Club Auth (`HCA_CLIENT_ID` / `HCA_CLIENT_SECRET` / redirect URI) - identity provider for `server` and `dashboard`
- Slack tokens - for `pixorpheus`, `pixo-dm`, and dashboard notifications

### Run

```bash
# Per app
bun run --cwd apps/server dev          # game server
bun run --cwd apps/landing dev         # landing site
bun run --cwd apps/dashboard dev       # admin dashboard (port 4900)
bun run --cwd apps/web-shell dev       # web shell (port 4901)
bun run --cwd apps/pixorpheus start    # Slack bot
bun run --cwd apps/pixo-dm start       # Pixo DM relay (plain node, not bun)

# Turborepo shortcuts (root package.json)
bun run dev          # all apps concurrently
bun run landing      # @pixl/landing only
bun run dashboard    # @pixl/dashboard only
bun run web-shell    # @pixl/web-shell only
bun run build        # build everything
```

`apps/game` is opened and run through the Godot 4 editor directly, not through Bun.

### Shared config/theme/assets

`packages/config`, `packages/theme`, and `packages/docs-engine`/`packages/map-sync` aren't imported at runtime - each app builds from its own directory, so a workspace package outside that root doesn't resolve. Edit the source, then regenerate the committed copies every consumer actually reads:

```bash
bun run config:sync      # packages/config/pixl.json -> apps/{server,pixorpheus,landing,dashboard,game}
bun run theme:sync       # packages/theme/palette.json -> apps/game/theme.json, apps/game/web/pixl.css
bun run docs:build       # docs/*.md -> apps/web-shell/public/<slug>/og.png
bun run previews:build   # OG cards for hand-authored web-shell pages
bun run map:sync         # apps/game's baked world-map PNGs -> apps/dashboard
```

### Database Migrations

```bash
bun run --cwd apps/server db:generate   # schema.ts change -> new migration
bun run --cwd apps/server db:migrate    # apply pending migrations
bun run --cwd apps/server db:studio     # Drizzle Studio (visual DB browser)
```

Raw SQL migrations (including data-only ones) live in `apps/server/drizzle/` and run in sequential numeric order.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up a change, coding conventions per app, and how to open a pull request.

---

## License

Pixl is licensed under the [MIT License](LICENSE).
