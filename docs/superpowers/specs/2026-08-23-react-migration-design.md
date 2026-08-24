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
- ~~Deciding the page order for slices after docs (dashboard, shop, etc.) —
  to be scoped when that slice is planned.~~ Decided in the addendum below.

## Addendum (2026-08-24): migrating the rest of the player web shell

Docs shipped and is live. This addendum decides section 6's follow-on
("Sequencing after docs... not decided as part of this design") and
concretizes section 5's auth design now that a real slice depends on it.
Sections 1-4 stand unchanged. Scope: every remaining `SHELL_PATHS` family in
`apps/landing/next.config.ts` — `shop`, `orders`, `collectibles`, `vault`,
`explore`, `ideas`, `quests`, `trials`, `timeline`, `projects`, `report`,
`dashboard`, `hackatime`, `refers`, `account`, `calc` — except the Godot
game itself, which this migration never touches.

### Deferred: `quests` and `timeline`

Both exist as real pages but are commented out of `pixl.js`'s `NAV_GROUPS`
today ("not ready for players" / "disabled for now"). Decision: **skip
both for this migration.** They stay on the old static site, unmigrated,
until whoever finishes their design ships them — porting UI for a feature
that may still change shape before launch is wasted work. Their
`SHELL_PATHS` rewrites keep pointing at `play.pixl.hackclub.com`
indefinitely, until a future slice (out of scope here) takes them on.

### Slice order

Foundation first (nothing signed-in can ship before auth + shared shell
exist), then every other family ordered by size/risk, with the two largest
pages carved into their own dedicated slices:

1. **Foundation** — shared shell chrome (sidebar/topbar/nav/mobile
   dock/theme picker), the auth redesign from section 5 (now concretized
   below), and shared `lib/` utilities (economy formulas, bbcode/markdown
   renderers, confirm dialog) — shipped together with `dashboard` (476
   lines) as the proof-of-concept content page, since it's read-mostly
   (wallet + Restoration chips, no forms) and is the literal landing page
   every player hits first.
2. `collectibles` (167) + `account` (186) + `trials` (208) — smallest
   remaining pages, mostly read + simple claim/save actions.
3. `report` (238) + `vault` (264) + `orders` (286).
4. `refers` (302) + `ideas` (340) — upvote/downvote and referral tracking
   push these above the previous tier.
5. `calc` (391) — standalone and public (`window.PIXL_PUBLIC`, no auth
   required), but deliberately *not* slotted earlier despite that: cutting
   it over before auth ships would flip an already-signed-in player's chrome
   from signed-in to signed-out on that one page for the window between two
   slices, a regression not worth the size-based ordering purity.
6. `explore` (733) — largest of the "normal" pages.
7. `shop` (1863: `shop/` index + `shop/item/`) — its own slice, likely two
   tasks (catalog list, item detail + config picker).
8. `projects` (3797) + the `hackatime` redirect — by far the largest:
   the create/ship/journal flow, the project editor, Hackatime linking.
   `hackatime/index.html` is a bare redirect stub to `/projects/` (not a
   real page) and is folded in here rather than given its own slice.

Cutover in `apps/landing/next.config.ts` still happens **per family, not
per slice** — a bundled slice's pages each get their own rewrite repointed
independently once that specific page is verified end-to-end, the same
safety property the docs slice's single-family cutover already had.

Plans for these slices are written **just-in-time**, one per slice,
starting with Foundation — not all 8 up front — so each plan reflects what
the previous slice actually taught us rather than a pattern guessed at
before it exists anywhere in `apps/web-shell`.

### Auth, concretized

Section 5 decided the shape (httpOnly cookie on `apps/web-shell`'s own
domain, forwarding the same token `apps/server` already expects) but
deferred the mechanics to "an implementation-time call." Foundation makes
that call:

- `apps/web-shell` gets `JWT_SECRET` as an env var — the same secret
  `apps/server` holds — and a `lib/session.ts` that ports
  `verifySessionToken` byte-for-byte from
  `apps/server/src/auth/session.ts` (same `jsonwebtoken` verify, same
  `SessionPayload` shape). This avoids a network round-trip just to know
  who's signed in. `apps/dashboard/lib/session.ts` is a real precedent for
  the cookie plumbing (httpOnly, `sameSite: "lax"`, `secure` gated on
  `BASE_URL` starting with `https`) — simpler here, since the "session" is
  already a signed JWT and doesn't need dashboard's HMAC-wrapping.
- **Token handoff happens in `middleware.ts`, not a single callback
  route.** Unlike `apps/dashboard` (which runs its own OAuth exchange and
  always lands on one `/api/auth/callback`), `apps/server` still owns the
  whole Hack Club Auth exchange and redirects back to whatever
  `web_redirect` pointed at — the page the player started login from — with
  `?token=` appended (see `pixl.js`'s `loginUrl()`). So `middleware.ts` runs
  on every request, checks for `?token=`, sets the httpOnly cookie, and 307s
  to the same URL with the param stripped — the server-side equivalent of
  what `pixl.js` does client-side today via `history.replaceState`.
- **Mutations go through a generic proxy**, since the token is now
  unreadable by client JS by design (that's the entire point of httpOnly).
  A single route handler, `app/api/proxy/[...path]/route.ts`, forwards
  method/body/query to `apps/server` and injects the cookie's token;
  Client Components fetch `/api/proxy/...` instead of `apps/server`
  directly. This preserves nearly the exact shape of `pixl.js`'s existing
  `api()`/`send()` calls (swap the base URL, drop the explicit token
  param) across every remaining slice, instead of hand-writing a Server
  Action per mutation. It's the same trust boundary as today: a
  signed-in client could already call any `apps/server` endpoint with its
  own token — this only moves *where* the token itself lives.

### Shared shell + `lib/` architecture

- The sidebar/topbar/mobile-dock/theme-picker become a `(shell)`
  route-group layout: a Server Component that calls `getSession()` to pick
  signed-in vs. signed-out chrome (mirroring `mountTopbar`'s branch today),
  with small Client Components for the genuinely interactive pieces (mobile
  sheet, theme dropdown). `apps/web-shell/app/[slug]/docs-shell.tsx`
  already built this same shape for docs' three-column layout — this is
  reuse of an established pattern, not a from-scratch design.
- `lib/economy.ts` — `rePerHour`/`reForHours`/`payoutUsdPerHour`/
  `projectPayoutUsd`/`projectPayoutPx` ported as a **tested** pure module
  (same pattern as `packages/docs-engine/src/tokens.ts` from the docs
  slice), since CLAUDE.md requires this stay byte-for-byte identical to
  `apps/server`'s own payout math.
- `lib/bbcode.ts`, `lib/markdown.ts` — the player-journal renderers (not
  `docs-engine`'s doc-content markdown), ported as pure tested functions.
- `confirmDialog()` becomes a `useConfirm()` hook backed by a single
  `<ConfirmDialogHost/>` mounted once in the shell layout — keeps the
  `if (!(await confirm({...}))) return;` call-site shape almost unchanged
  at every port site instead of a redesign.
- `enhanceSelect()`'s DOM-hijacking hack is retired in favor of a real
  Radix `<Select>` — section 1 already flagged "shadcn/radix where useful"
  and this is the first real use case for it.
- **The onboarding tour (`runTour`/`ONBOARDING_STEPS`) is explicitly not
  redesigned in Foundation.** It's DOM-target-based (`#new-btn`, `#f-name`,
  ...) and only matters for the `projects` create/ship flow (slice 8) — its
  redesign (targeting real component refs instead of querySelector strings)
  is deferred to that slice, when the actual component tree it needs to
  target exists to design against.
