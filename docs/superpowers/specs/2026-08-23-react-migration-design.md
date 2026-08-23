# React migration: docs + player web shell

Design for moving Pixl's web shell (`apps/game/web/`) off static HTML/vanilla
JS and onto React, starting with the docs site. Follows the kickoff prompt at
`docs/superpowers/specs/react-migration-kickoff-prompt.md`.

## Why

Docs pages are static, server-rendered-once HTML: `packages/docs-engine`
builds `docs/*.md` into `apps/game/web/docs/<slug>/index.html`, one real file
per page, no client router. Every click between docs pages is a full page
load, so client state (e.g. an expanded nav sidebar group) doesn't survive
navigation — there's no SPA routing to persist it. This was previously
patched with localStorage, which treats the symptom, not the architecture.

The player dashboard has the same problem: `apps/game/web/pixl.js` is a
~1300-line hand-written vanilla-JS file building sidebar/topbar HTML via
template strings, with logic duplicated against `docs/docs.js` (e.g. two
independently-maintained copies of the theme picker). A React app with
client-side routing and shared components fixes both bug classes at the
root.

## Current-state findings that shape this design

- `apps/landing`/`apps/dashboard` already run Next.js 16 + React 19 +
  Tailwind 4 on Vercel — established conventions to follow, not a first
  React app in the monorepo. Both have (or should follow) the "this Next.js
  is very new, read `node_modules/next/dist/docs/` first" warning.
- Nothing in this repo is Vercel-hosted anymore. All five apps (including
  `apps/landing` and `apps/dashboard`) moved to Orchard k8s on 2026-08-11,
  each with its own committed `Dockerfile`. `apps/game`'s bakes the Godot web
  export and the web shell into one container, served by a hand-rolled
  `apps/game/serve.ts` (Bun), live at `play.pixl.hackclub.com`. The proxy
  that makes `pixl.hackclub.com/<page>` reach that origin is
  `apps/landing/next.config.ts`'s `rewrites()` — `vercel.json` is inert on
  Orchard and kept only as a fossil from the Vercel era.
- `packages/theme/palette.json` and `packages/config/pixl.json` are the
  single sources of truth for design tokens and program facts respectively.
  Nothing imports them at runtime (Railway/Vercel/Orchard each build an
  app from its own subdirectory); every consumer reads a generated,
  git-committed copy produced by `theme:sync`/`config:sync`.
- `packages/docs-engine` (`build.ts`) turns `docs/*.md` into static HTML +
  OG preview cards under `apps/game/web/docs/`, using `{{token}}`
  placeholders resolved against `packages/config/pixl.json` at build time.
- Auth today: Hack Club Auth redirects back with a `?token=`, which
  `pixl.js` stores in `localStorage` and sends as a query param on every
  `apps/server` API call. The Godot game client uses the same scheme
  natively (`NetworkManager._start_login_web`).
- `apps/game/web/index.html` (the Godot export's own landing page) is
  written by the Godot export step itself, not hand-authored — out of scope.

## Decisions

### 1. App boundary & deployment

A new standalone app, `apps/web-shell` — Next.js 16 App Router, matching
`apps/dashboard`/`apps/landing` conventions (React 19, Tailwind 4,
shadcn/radix where useful). It gets its own `Dockerfile` and is deployed to
Orchard the same way `apps/game` is today: a sibling container, not folded
into the Godot container and not moved onto Vercel. `apps/game`'s
`Dockerfile` stops running `docs:build`/`previews:build` and stops copying
`apps/game/web/docs/` once docs are cut over.

Rejected: folding into `apps/dashboard` or `apps/landing` (reuses Vercel
infra, but mixes player-facing auth into apps built for a different
audience, and would move this content's hosting off Orchard for no
architectural reason). Rejected: Vite + React SPA (lighter build, and this
content is mostly static-ish pages rather than a heavy interactive app, but
the repo has zero precedent for it versus strong existing Next.js
conventions and docs/MDX tooling).

### 2. Rollout: incremental, docs first

Old static shell and new Next app run side by side for the duration of the
migration. Cutover is per-page-family, driven from `apps/landing`'s
`next.config.ts`: today every web-shell path rewrites to
`play.pixl.hackclub.com`. Migrating a page family means repointing *only
that family's* rewrite rule to the new `apps/web-shell` Orchard URL —
`/docs` and `/docs/:path*` move first; `/shop`, `/dashboard`, `/vault`, etc.
keep pointing at `play.pixl.hackclub.com` until their own later slices land.
Nothing on the old side is deleted until its last consumer (the rewrite
pointing at it) is gone. `apps/landing/proxy.ts`'s locale-redirect matcher
only needs updating for a migrated path family if that family should start
getting locale redirects — docs isn't locale-aware today, so no matcher
change for the docs slice.

Sequencing after docs: dashboard/shop and the rest, in an order to be
decided when that slice is planned — not decided as part of this design.

### 3. Docs content pipeline

`docs/*.md` stays the source of truth. Rendering moves into
`apps/web-shell` as Next.js pages (`app/docs/[slug]/page.tsx`), reading the
markdown at build time — via `next-mdx-remote` or a small loader adapting
the parsing logic currently in `packages/docs-engine/src/markdown.ts`
(frontmatter, `{{token}}` substitution against `packages/config/pixl.json`,
nav ordering from the `<order>-<slug>.md` filename convention).
`packages/docs-engine/src/page.ts` (the HTML-shell renderer) and
`build.ts`'s per-page HTML output retire. `packages/docs-engine/src/og.ts`
(PNG preview-card generation) stays — either as its own build step or
ported to a Next.js OG image route (an implementation-time call, not a
brainstorm-level one) — so shared doc links keep unfurling correctly.
`docs.css`/`docs.js` (hand-maintained today) get ported into the app's own
components/Tailwind rather than carried over as raw files.

### 4. Theming & shared config

`packages/theme/palette.json` and `packages/config/pixl.json` remain the
sources of truth. `theme:sync` and `config:sync` gain a third output
target: `apps/web-shell` gets its own generated, git-committed copies (a
CSS-custom-properties file or Tailwind theme extension for the palette; a
`_generated/config.ts` matching the `landing`/`dashboard` pattern of
`@/app/_generated/config`). Same rule as every existing consumer: generated,
never hand-edited, re-run the sync script after editing the source JSON.

### 5. Auth (deferred to the dashboard slice, designed now)

Not needed for the docs slice (docs are public content, matching today's
`window.PIXL_PUBLIC` opt-out) — but decided now for consistency since a
later slice depends on it.

The session becomes an httpOnly cookie scoped to `apps/web-shell`'s own
domain (`pixl.hackclub.com`, via the same proxy every page already rewrites
through) rather than to `apps/server`'s domain — this sidesteps cross-site
cookie restrictions entirely. Flow: the Hack Club Auth callback is still
handled by `apps/server`, exactly as today, and redirects back to
`apps/web-shell` with the token in the URL. A route handler in the new app
reads it once, stores it server-side in an httpOnly cookie, and strips it
from the URL. From then on, Server Components read the cookie via
`next/headers`, and Server Actions/route handlers forward that same token
value to `apps/server` as the existing query param. `apps/server`'s
`verifySessionToken` and every existing route are unchanged — only *who*
holds and forwards the token changes (the Next server, instead of
client-side `pixl.js`/`localStorage`). The Godot game client and any
web-shell pages still on the old static system keep using the current
token-in-localStorage flow unmodified — this redesign is scoped to
`apps/web-shell` only, not a platform-wide auth migration.

### 6. First slice scope (what gets planned next)

- Scaffold `apps/web-shell` (Next.js App Router, Tailwind 4), wired into
  `config:sync`/`theme:sync` as a third output target.
- Port `docs/*.md` rendering (frontmatter, `{{token}}` substitution, nav
  ordering/prev-next) into Next pages, replacing
  `packages/docs-engine`'s `markdown.ts`/`page.ts`/`build.ts` HTML output.
  `og.ts` card generation carried over (as-is or ported to a Next OG image
  route).
- No auth work required for this slice.
- Repoint `/docs` and `/docs/:path*` in `apps/landing/next.config.ts` at the
  new Orchard deployment.
- `apps/game`'s `Dockerfile` stops running `docs:build`/copying
  `apps/game/web/docs/` once the cutover is live.
- **Done when:** all 30 doc pages render correctly in the new app,
  client-side nav between them persists sidebar/expand state (the actual
  bug this migration exists to fix), OG cards still unfurl correctly, and
  the old docs-engine HTML-page-rendering pipeline is fully retired.

## Explicitly out of scope

- `apps/game/web/index.html` (the Godot web-export's own landing page) —
  a build artifact, not hand-authored shell content.
- Any change to the Godot client's own auth flow or to `apps/server`'s
  existing token-verification behavior.
- Deciding the page order for slices after docs (dashboard, shop, etc.) —
  to be scoped when that slice is planned.
