# PIXL XSS Audit & Hardening Report

Branch: `security/xss-hardening` (from `origin/main` @ `bce9816`)
Date: 2026-09-16

## Summary

| # | Confirmed exploitable | Likely exploitable | Defense-in-depth | False positives ruled out |
|---|---|---|---|---|
| Count | **2** | 0 | 3 | 6+ (see "Safe / false positives" below) |

**Confirmed vulnerabilities, fixed:**

1. **Project `repo_url`/`demo_url` dangerous-scheme injection** (the originally reported issue) — stored XSS, click-triggered.
2. **Player `avatar_url` inline-`onerror` JS-string breakout** (found during the full-repo audit) — stored XSS, zero-click (fires on image load failure).

Both are fixed in this branch. Details, proof, and fixes below.

---

## Finding 1 (CONFIRMED EXPLOITABLE): `repo_url`/`demo_url` dangerous URL scheme

- **Classification:** CONFIRMED EXPLOITABLE
- **Type:** Stored XSS, click-triggered
- **Affected fields:** `projects.repo_url`, `projects.demo_url` (and, defense-in-depth, `projects.image_url`)
- **Affected pages:** `apps/game/web/projects/index.html` (public project page, reached from Explore or a direct `/project/<id>` link), `apps/dashboard/app/review/[id]/page.tsx`, `apps/dashboard/app/projects/[id]/page.tsx`, `apps/dashboard/app/_components/ReviewForm.tsx`, `apps/dashboard/app/_components/ReviewDetailTabs.tsx` (YSWS cross-program ship list)

### Source → sink trace

1. **Source:** `POST/PUT /api/projects` (`apps/server/src/routes/projects.ts`, `parseProjectBody`) accepted `repoUrl`/`demoUrl` from any signed-in player, normalizing with the old `ensureProtocol()`:
   ```js
   function ensureProtocol(raw) {
     const s = String(raw ?? "").trim();
     if (!s) return "";
     return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
   }
   ```
   If the input already matched `scheme://...`, it was stored **verbatim, whatever the scheme**. Ship-time validation (`normalizeDemoUrl`, `isGithubRepoUrl`) only runs when a project is actually shipped — a draft never goes through it.

2. **Storage:** a draft project (`status = 'shipped'` never reached) can sit indefinitely with `repo_url = "javascript://%0aalert(1)"`.

3. **Exposure, no auth required:** `GET /api/explore/projects` (`apps/server/src/routes/explore.ts`) is explicitly `#public` (token optional) and its own comment says "Browse everyone's projects (**including drafts**)" — with no `shipped` query param, every status is returned, `repo_url`/`demo_url` included in `PUBLIC_PROJECT_COLUMNS`.

4. **Sink:** every renderer we found puts the value straight into `<a href>`:
   - Game (`apps/game/web/projects/index.html`, 8 occurrences): `` `<a href="${Pixl.esc(p.repo_url)}" ...>` ``
   - Dashboard (React, plain JSX attribute — **not** `dangerouslySetInnerHTML`): `<a href={p.repo_url}>` in `review/[id]/page.tsx`, `projects/[id]/page.tsx`, `ReviewForm.tsx`
   - Dashboard `ReviewDetailTabs.tsx`'s "YSWS" tab additionally renders `codeUrl`/`demoUrl` from Hack Club's **external** `ships.hackclub.com` archive the same unguarded way — a malicious value from *any other* Hack Club YSWS program's submission surfaces here too if the repo/demo URL happens to match a Pixl project.

   `Pixl.esc()` HTML-escapes `<>&"'` — it does **not** touch the URL scheme, and neither does React's JSX attribute handling (JSX does not sanitize `href`/`src` against `javascript:`; that protection only exists for `dangerouslySetInnerHTML`). Clicking the rendered link navigates to the raw scheme.

### Proof (safe, local, no browser required)

Verified with Node against the actual regex/parsing logic (harmless payloads only, no exfiltration):

```
"javascript://alert(1)"        -> stored as-is,  protocol: javascript:
"javascript://%0aalert(1)"     -> stored as-is,  protocol: javascript:
"vbscript://alert(1)"          -> stored as-is,  protocol: vbscript:
"file:///etc/passwd"           -> stored as-is,  protocol: file:
"javascript:alert(1)" (no //)  -> "https://javascript:alert(1)" (inert - not exploitable, no `//`)
"https://example.com"          -> unchanged, protocol: https:
"github.com/user/repo"         -> "https://github.com/user/repo"
```

This confirms the exact bug shape from the report: only the `scheme://` form (not bare `scheme:`) survived unmodified, and it survives specifically because `ensureProtocol` never inspects what the scheme *is*, only whether one is present.

### Fix applied

- **New file `apps/server/src/routes/projectUrlSafety.ts`** — `normalizeProjectUrl()` replaces `ensureProtocol()`. Preserves the exact same "no scheme → prepend `https://`" behavior (verified against `example.com:8080/path`, `localhost:3000/game`, and plain garbage placeholder text — all unchanged), but for anything that already has a `scheme://`, it now **parses the URL and requires `http:`/`https:`**, rejecting everything else (`{ ok: false }`) instead of storing it.
- **`apps/server/src/routes/projects.ts`** — `parseProjectBody` now returns `{ error: "repo_invalid" }` / `{ error: "demo_invalid" }` when the new check rejects the input (both codes already exist as ship-time error strings the frontend's `err()` map understands; `repo_invalid` is new but the game's `err()` has a graceful fallback for unmapped codes). `normalizeDemoUrl` (ship-time) now also uses `normalizeProjectUrl` internally, and `image_url` gets the same scheme check for defense-in-depth (an `<img src="javascript:...">` doesn't execute in modern browsers, but there's no reason to store a non-http(s) value there either).
- **Client-side defense-in-depth** (in case an already-stored row predates this fix, or another write path is ever missed):
  - `apps/game/web/pixl.js` — new `Pixl.safeHref(url)`, returns the URL unchanged only if it's a plain `http(s)` (or same-app-relative) link, else `""`.
  - `apps/game/web/projects/index.html` — all 8 `<a href="${Pixl.esc(p.repo_url)}">`/`demo_url` renders now also gate on `Pixl.safeHref(...)`; an unsafe URL renders no link at all instead of a clickable dangerous one.
  - `apps/dashboard/lib/safeUrl.ts` — new `isSafeUrl(url): url is string` (TS type guard), same semantics.
  - Applied to every dashboard `<a href={...}>` built from `repo_url`/`demo_url`: `review/[id]/page.tsx` (3 links), `projects/[id]/page.tsx` (2 links), `ReviewForm.tsx` (2 links), `ReviewDetailTabs.tsx` (2 links, the external-archive `codeUrl`/`demoUrl`).

### Tests added

`apps/server/src/routes/projectUrlSafety.test.ts` (20 cases, `bun test`):
- Rejects: `javascript://alert(1)`, `javascript://%0aalert(1)`, `JaVaScRiPt://alert(1)`, `data://text/html,<script>...`, `vbscript://alert(1)`, `file:///etc/passwd`, `file://C:/Windows/System32`.
- Confirms scheme-less lookalikes (`javascript:alert(1)` with no `//`) are inert, not rejected (matches the pre-existing behavior for garbage text, not a security concern).
- Confirms legitimate inputs unchanged: `https://example.com`, `http://example.com`, `github.com/user/repo`, `https://github.com/user/repo`, `example.com:8080/path`, `localhost:3000/game`, whitespace-trimmed input.
- Empty/null/undefined → `""`, not an error. 500-char truncation preserved.

`apps/dashboard/lib/safeUrl.test.ts` (4 groups, `bun test`): rejects the same dangerous-scheme set, accepts plain http(s) and relative links, rejects empty/blank/missing.

---

## Finding 2 (CONFIRMED EXPLOITABLE, found during full-repo audit): `avatar_url` inline-`onerror` JS-string breakout

- **Classification:** CONFIRMED EXPLOITABLE
- **Type:** Stored XSS, **zero-click** (fires automatically on image load failure — no victim interaction needed beyond viewing a page)
- **Affected field:** `users.avatar_url`
- **Affected pages:** `apps/game/web/explore/`, `explore/players/`, `explore/leaderboard/` (anywhere `avatarHtml()` is used — every player card on those pages)

### Source → sink trace

1. **Source:** `POST /api/profile/card-image` (`apps/server/src/routes/profile.ts`) lets any signed-in player set their own `avatar_url` to arbitrary text, the only check being:
   ```js
   if (!url.startsWith("https://") || url.length > 500) return res.status(400)...
   ```
   Nothing stops it from containing a literal `'`, `<`, `;`, or anything else after that prefix.

2. **Sink (`apps/game/web/explore.js`, `avatarHtml()`):** the fallback-on-broken-image handler was built as an inline `onerror="..."` attribute string, splicing `avatar_url` into a single-quoted JS literal:
   ```js
   const fallback = pixifySrc && avatarUrl ? Pixl.esc(avatarUrl) : "";
   const onerror = fallback
     ? `this.onerror=function(){this.parentNode.textContent='${letter}'};this.src='${fallback}'`
     : ...;
   return `<div class="avatar"><img src="..." onerror="${onerror}"></div>`;
   ```
   `Pixl.esc()` turns a literal `'` into `&#39;`. **This does not help here**: `onerror="..."` is an HTML attribute, and browsers decode HTML character references inside attribute values *before* handing the decoded string to the JS engine as the event handler's source. `&#39;` decodes right back to `'` at that point, so the escaping is fully defeated for this specific sink — it only ever protected the outer `onerror="..."` attribute boundary (which uses `"`, already handled separately), never the inner single-quoted JS string.

   An `avatar_url` such as `https://x'};(function(){/* attacker JS */})();//` closes the `this.src='...'` string early, and the rest runs as a real second statement — the moment the browser tries (and fails) to load that URL as an image, which it always will, since it's not a real image resource. This requires **no click**: `onerror` fires automatically.

### Why this reaches the sink in practice

`fallback` is only populated when **both** `pixifySrc` (the Pixify Slack-photo proxy) and `avatar_url` are set — i.e. a normal player who has uploaded a custom card image and hasn't disabled Pixify. Pixify legitimately 404s/503s (no Slack photo, service hiccup — the surrounding code comment says exactly this), which is what triggers `onerror`. This isn't a rare edge case; it's the code's own documented fallback path.

### Proof (safe, local, code trace only — no browser payload executed)

Traced manually rather than executed, per the "safe testing" constraint: the browser HTML-attribute-entity-decode-before-JS-parse behavior for inline event handlers is standard, documented DOM/HTML parsing behavior (not something we need to fire against a live target to confirm) — verified by reading the exact escape function (`Pixl.esc`, `apps/game/web/pixl.js`) and confirming it only encodes `&<>"'` as named/numeric character references, which is precisely the class of encoding attribute-value parsing reverses before code execution.

### Fix applied

Rewrote `avatarHtml()` (`apps/game/web/explore.js`) to carry the fallback values in `data-*` attributes instead of building JS source as a string, and added one capture-phase `error` listener (module scope, `error` doesn't bubble) that applies the fallback via real DOM property writes (`img.src = ...`, `parentNode.textContent = ...`) — never re-parsed as HTML or JS, so no injection is possible regardless of what `avatar_url` contains. Visual behavior (Pixify → uploaded pfp → first-letter avatar) is unchanged.

No new dangerous scheme is possible here either: even a `javascript:` value assigned to `img.src` via a real DOM property write does not execute (browsers don't run script for `<img src>`, only for actual navigation contexts like `<a href>`/`location`).

---

## Defense-in-depth issues (not independently exploitable, hardened anyway)

1. **`projects.image_url`** — same save-time scheme check applied as `repo_url`/`demo_url`. `<img src="javascript:...">` doesn't execute in modern browsers, so this was not itself an exploitable sink, but there's no reason to allow a non-http(s) value to persist.
2. **Dashboard `isGithubUrl()`** (`ReviewDetailTabs.tsx`, gates the embedded HURT fraud-check iframe) checks `new URL(url).hostname === "github.com"` but never checks `protocol`. A crafted `javascript://github.com/x` would pass this check, but it only ever ends up as a **query-string value** inside a fixed `https://hurt-xi.vercel.app/?repo=...` iframe `src` — the iframe's own scheme is always `https:`, so this cannot execute script in Pixl's origin. Left unfixed (out of scope — not a Pixl vulnerability, and changing it risks breaking the fraud-check tool's own URL parsing), but noted for whoever owns HURT.
3. **Client-side `Pixl.safeHref`/`isSafeUrl` backstops** on every repo_url/demo_url render site (listed under Finding 1) — the server-side fix is the actual root-cause closure; these are the second layer in case of old data or a future missed write path.

## Safe / false positives (from this session's audit, not exhaustively re-verified in this report but checked)

- **Custom Markdown renderers** (`apps/dashboard/lib/markdown.ts`'s `renderMarkdown`, `apps/game/web/pixl.js`'s `markdown()`/`bbcode()`) — used via `dangerouslySetInnerHTML` for project descriptions/journal entries. All escape (`esc()`) the **entire raw string first**, then build HTML tags around the already-escaped text; URLs extracted from `[text](url)`/`[url]...[/url]` syntax are validated to be `^https?://[^"'\s]+$` *after* escaping has already removed any literal `"`/`'` from the candidate, so there's no way to break out of the `href="..."`/`src="..."` attributes they generate. Traced carefully; no issue found.
- **`fmtSlack()`** (`apps/dashboard/app/tickets/TicketsClient.tsx`) — same escape-first pattern, no `href`/`src` built from ticket text at all.
- **OG meta-tag generators** (`apps/game/web/api/{project,player,shop-item}-meta.ts`) — server-rendered `<meta content="...">`/`<title>` from project/player/shop names & descriptions. Escape `&<>"` before interpolation into double-quoted attributes; missing `'` escaping is irrelevant since nothing here uses single-quoted attributes.
- **`Pixl.confirm()` dialog** (`pixl.js`) — `title`/`body`/button text passed to `confirmDialog()` are escaped inside that function regardless of what the caller does at the call site (e.g. `deleteProject`'s `` `Delete "${p.name}"...` `` looked unescaped at a glance from the call site, but isn't — it's escaped downstream).
- **BBCode `[bgcolor]`/`[font_size]` CSS-context substitutions** (`pixl.js`) — validated against strict allow-list regexes (`^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{2,24})$` for color, digits-only clamped 8-64 for font size) applied *after* the whole string was already HTML-escaped, so no CSS/attribute breakout is possible.
- **Display names / real names** (`explore.js`'s `projCard`, and every other occurrence found by grep) — consistently passed through `Pixl.esc()` before insertion as text/attribute content.
- **`eval`/`new Function`/string-`setTimeout`/string-`setInterval`/`document.write`/`srcdoc`/dynamic `<script>` creation** — none found anywhere in `apps/` outside `node_modules`.
- **Reflected `location.hash`/`location.search` values** — every occurrence found (`projects/index.html`, `explore/projects/index.html`, `hackatime/index.html`, `refers/index.html`, `shop/item/index.html`) is used only for routing decisions or assigned to an `<input>`'s `.value` (a safe DOM property write), never concatenated into `innerHTML`.
- **Inline `onclick="fn(${id})"` handlers with a numeric ID** (`explore.js`, `ideas/index.html`, `quests/index.html`) — all use `Number(p.id)`/`q.id`, which are always DB-integer IDs, never free text; cannot break out of the handler.

## CSP findings

- **`apps/server`** (JSON API only): `default-src 'none'; frame-ancestors 'none'` — appropriate for a pure API, no change needed.
- **`apps/dashboard`** (Next.js): only sets `frame-ancestors 'none'` (anti-clickjacking) — no `script-src`/`object-src`/`base-uri` restriction at all. A successful XSS here is currently *not* mitigated by CSP.
- **`apps/game/web`** (the highest-value target — this is the origin holding `pixl_token` in `localStorage`): **no Content-Security-Policy header at all.** Only `X-Content-Type-Options`, `X-Frame-Options`, HSTS, COOP/COEP (`vercel.json`).

**Not implemented in this branch, by design** (per the task's own instruction not to ship a CSP change without verifying functionality): `apps/game/web` makes extensive, repo-wide use of inline `onclick`/`onerror` attribute handlers (dozens of legitimate call sites — vote buttons, delete/apply buttons, quest cards, etc., confirmed by grep). A `script-src 'self'` CSP — which would have outright blocked Finding 2's inline-handler exploit even if the code bug had shipped — requires either migrating all of those to real `addEventListener` calls, or a nonce/hash scheme for every one. That's a real, valuable follow-up project, but it's a separate, much larger effort than this security-bug-fix branch and genuinely risks breaking the app if rushed. **Recommendation:** track "migrate game/web off inline event-handler attributes, then add `script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`" as its own follow-up. The dashboard's smaller Next.js surface is a more tractable place to start (fewer inline handlers, and Next supports nonce-based strict CSP natively).

## `pixl_token` / localStorage auth impact

`apps/game/web` stores the session token in `localStorage` (`pixl_token`, read by `pixl.js`'s `Pixl.token`/`Pixl.api`). **This is a genuine impact multiplier for any XSS on this origin**: unlike an `HttpOnly` cookie, JavaScript running under an XSS payload can read `localStorage.pixl_token` directly and exfiltrate it, giving a full, durable account takeover (not just one-off action-as-victim) — for as long as the token is valid. Both findings in this report are on `apps/game/web`'s origin (Finding 1's sink is on this origin too — the game's own `projects/index.html`; the dashboard sink is a separate, session-cookie-based origin). We did not exploit this in any test — no token was read or transmitted anywhere as part of this work.

**Recommendation** (not implemented — explicitly out of scope per the task): move `apps/game/web`'s session to an `HttpOnly`, `Secure`, `SameSite=Lax` (or `Strict`, if cross-site flows allow) cookie, mirroring what `apps/web-shell` already does (`lib/session.ts` there verifies a `pixl_session` httpOnly cookie signed with the same `JWT_SECRET`). This is a real architecture change (the game client currently reads the token directly for `Authorization`-style API calls from a Godot web-export context too, not just the HTML pages) and needs its own dedicated project — flagged here as the report's clearest highest-leverage follow-up, not attempted in this branch.

## Files changed

- `apps/server/src/routes/projectUrlSafety.ts` (new) — centralized URL scheme validation
- `apps/server/src/routes/projectUrlSafety.test.ts` (new) — 20 regression tests
- `apps/server/src/routes/projects.ts` — wired the new validation into `parseProjectBody`/`normalizeDemoUrl`, removed the vulnerable `ensureProtocol`
- `apps/dashboard/lib/safeUrl.ts` (new) — `isSafeUrl()` type guard
- `apps/dashboard/lib/safeUrl.test.ts` (new) — regression tests
- `apps/dashboard/app/review/[id]/page.tsx` — gated 3 `<a href>` renders
- `apps/dashboard/app/projects/[id]/page.tsx` — gated 2 `<a href>` renders
- `apps/dashboard/app/_components/ReviewForm.tsx` — gated 2 `<a href>` renders
- `apps/dashboard/app/_components/ReviewDetailTabs.tsx` — gated 2 `<a href>` renders (external YSWS archive data)
- `apps/game/web/pixl.js` — new `Pixl.safeHref()`
- `apps/game/web/projects/index.html` — gated all 8 repo/demo `<a href>` renders
- `apps/game/web/explore.js` — rewrote `avatarHtml()` and its fallback mechanism (Finding 2)

## Tests run and results

- `cd apps/server && bun test` → **30 pass, 0 fail** (includes the 20 new `projectUrlSafety.test.ts` cases; the pre-existing `pixlSlack.test.ts` failure line is an expected, unrelated external-call log, not a test failure)
- `cd apps/server && bunx tsc --noEmit` → clean
- `cd apps/server && bun run build` (tsc -p tsconfig.json) → clean
- `cd apps/dashboard && bun test` → **65 pass, 0 fail** (includes the 4 new `safeUrl.test.ts` groups)
- `cd apps/dashboard && bun run typecheck` → clean
- `cd apps/dashboard && bun run build` (next build) → succeeded, all routes compiled including the new `/review/proposed-bans` route from unrelated prior work on this branch
- Manual Node-level proof of the `normalizeProjectUrl` behavior against all payloads listed in the task (see Finding 1's "Proof" section)
- No live browser smoke test was performed (no dev server was started in this environment) — typecheck, build, and unit tests are the verification performed; recommend a manual click-through of project create/edit, Explore, and the reviewer dashboard before merging, per the task's own request.

## Whether any exploit could access `pixl_token`

Yes, in principle, for both findings (see "localStorage auth impact" above) — neither was exploited to actually retrieve, log, or transmit a real token in this session.

## Remaining risk / manual-review items

- The client-side `Pixl.safeHref`/`isSafeUrl` backstops do not retroactively clean already-stored dangerous-scheme rows from the database (if any exist in production) — they stop them from rendering as clickable links, but a one-off data migration/audit query (`SELECT id FROM projects WHERE repo_url similar to '(javascript|vbscript|file|data)://%' OR demo_url similar to ...`) would be worth running against production once this ships, to confirm nothing is already sitting there.
- `apps/landing` and `apps/pixorpheus` were spot-checked for `dangerouslySetInnerHTML`/inline-handler patterns but not audited to the same depth as `apps/game/web`/`apps/dashboard` in this pass, given the scope of the two confirmed findings already found there.
- CSP hardening (both apps) and the `pixl_token` → httpOnly-cookie migration are flagged as valuable follow-ups, intentionally not attempted here (see their sections above for why).

## Behavior changed intentionally

Yes: saving a project (draft or otherwise) with a `repo_url`/`demo_url` that already carries a non-http(s) scheme (`javascript://...`, `vbscript://...`, `file://...`, `data://...`, or any other scheme) now fails with a `repo_invalid`/`demo_invalid` error instead of silently saving. No legitimate project link is affected — verified against the full set of legitimate-input test cases (bare domains, `github.com/user/repo`, ports, `localhost`, already-`https://` links) plus a full dashboard `next build`.
