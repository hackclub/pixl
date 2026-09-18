# PIXL Defensive Security Audit

**Branch:** `security/safe-full-audit` (existing dedicated security branch, reused)
**Scope:** `apps/server`, `apps/dashboard`, `apps/web-shell`, `apps/landing`, `apps/pixorpheus`, `apps/pixo-dm`, `apps/game/web`, dependency tree
**Method:** Static code review, code-trace analysis, local deterministic reproductions (fixture data, mocked network/DB, in-repo Postgres query builder's `.build()`), local dependency-advisory lookup. No traffic was sent to any live PIXL/Hack Club service, no production credentials were used, no real user data was touched.
**Status:** Not merged, not deployed, not pushed. All work sits on the local branch for review.

---

## Executive summary

PIXL's core security architecture is solid: session cookies are HMAC-signed with constant-time verification, OAuth uses a properly validated `state` parameter, the shop's money-moving RPC uses real row-level locking (`SELECT ... FOR UPDATE`) with server-side price computation, mass assignment is prevented by explicit field allowlists everywhere checked, SQL injection is prevented by parameterized queries (verified via the query builder's own `.build()` output), and the public project-listing endpoints use a genuine SQL-level column allowlist, not an app-level denylist.

Within that solid foundation, this audit found and fixed **seven confirmed, concrete gaps**, the most severe being **two critical unauthenticated-RCE advisories in the pinned Next.js version** used by three production apps. It also found and fixed **one test/wiring defect** that had nothing to do with security (an unexported constant), corrected a **stale note** in this document's own earlier draft (`gitRepoUrl.ts` had already been fixed for DNS rebinding but was still listed as open), and documented **two real but deliberately-unfixed findings** that are either cross-cutting architectural questions or genuine product-policy decisions that shouldn't be changed silently.

An adversarial self-review pass (see "False positives disproved") caught one of my own early conclusions running ahead of the evidence — a suspected public PII leak in `explore.ts` — and walked it back with a real regression test before it was reported as a vulnerability.

---

## Security skills used

Newly installed `cyberskills-elite` / `cyberskills-tools` packs were inspected first (`find`/`Read`, no bundled scripts executed). Applied, not just referenced:

| Skill | Applied to |
|---|---|
| `bug-hunting/methodology/ai-report-writing-guardrails` | This report's structure/discipline: one issue per finding, no inflated impact language, concrete numbers, specific file/line remediation |
| `bug-hunting/web-vulnerabilities/ssrf-server-side-request-forgery` | Re-verified `urlLiveness.ts`/`isBlockedIp` against its IP-obfuscation payload catalog (decimal/hex/octal/short-form IPv4, userinfo/fragment bypass, IPv4-mapped IPv6) |
| `bug-hunting/api-security/broken-object-level-authorization` | Ownership-check audit across `projects.ts`, `collaborators.ts`, `shop.ts` |
| `bug-hunting/api-security/api-mass-assignment-exploitation` | Verified every project create/update path uses an explicit field parser, not raw `req.body` spread |
| `bug-hunting/api-security/jwt-forgery-algorithm-confusion` | Empirically tested `none`-alg and wrong-secret forgery against `session.ts`'s real `jwt.verify()` call |
| `bug-hunting/web-vulnerabilities/race-condition-toctou-exploitation` | Verified `buy_shop_item`'s row-locking; identified and fixed the upload/moderation race |
| `bug-hunting/web-vulnerabilities/cors-misconfiguration-exploitation` | Reviewed dashboard/web-shell/landing header configs |
| `bug-hunting/web-vulnerabilities/csrf-token-bypass-techniques` | Reviewed OAuth `state` handling in `apps/dashboard/app/api/auth/callback` |
| `bug-hunting/api-security/oauth-flow-exploitation` | Verified HCA OAuth flow against missing-state/redirect_uri/account-linking attacks |
| `bug-hunting/api-security/api-rate-limit-bypass-techniques` | Reviewed `trust proxy` + `X-Forwarded-For` handling in `rateLimit.ts` and the WS upgrade limiter |
| `bug-hunting/deep-dive-labs/file-upload` | Applied its "validate-then-delete race" pattern directly to the CDN-upload/moderation race found and fixed here |
| `bug-hunting/deep-dive-labs/websockets` | Reviewed DM/lobby/origin handling in `gameServer.ts` |

Not used: anything under `red-teaming/`, `penetration-testing/{active-directory,wireless,mobile}`, `exploit-development/`, `malware-analysis/` — out of scope for a Node/Postgres web app and not appropriate to pull into a defensive audit.

---

## Critical

### C-1: Two critical unauthenticated-RCE advisories in pinned Next.js version — FIXED
- **Severity:** Critical
- **Where:** `apps/dashboard/package.json`, `apps/landing/package.json`, `apps/web-shell/package.json` — all pinned `next: 16.2.11`
- **Prerequisite:** None (unauthenticated).
- **Impact:** `bun audit` (public npm advisory DB, read-only lookup, no PIXL traffic) reported the installed range `next >=16.0.0 <16.3.3` is affected by:
  - `GHSA-p293-qw3h-jr36` — unauthenticated RCE on Windows-hosted servers (does not apply to PIXL's Linux/Orchard deployment, but confirms the vulnerable code is present)
  - `GHSA-2xp9-vwfh-vxw4` — unauthenticated RCE in the Image Optimization API when AVIF files are processed. This one is not platform-specific; `apps/dashboard` has `sharp` as a direct dependency (used by `next/image`'s optimizer), so the vulnerable code path is present and reachable if `next/image` ever processes an attacker-influenced image.
- **Existing mitigations:** None specific to this — the vulnerable version was simply installed.
- **Proof:** `bun audit` output (local, read-only npm advisory lookup) plus confirming the exact resolved version (`node_modules/next/package.json` → `16.2.11`) fell inside the advisory's affected range.
- **Fix:** Bumped `next` to `16.3.5` (current stable, well past the `16.3.3` fix threshold) in all three `package.json` files, ran `bun install`, reconfirmed with `bun audit` that both advisories are gone, and rebuilt/typechecked/tested all three apps.
- **Regression test:** N/A (dependency-version fix) — verified via `bun audit` re-run showing zero `next` advisories, plus full build+typecheck+test of `dashboard`, `landing`, `web-shell`.

---

## High

### H-1: Uploaded images were stored on the public CDN concurrently with moderation, not gated by it — FIXED
- **Severity:** High
- **File/function:** `apps/server/src/routes/uploads.ts`, `POST /api/uploads`
- **Prerequisite:** Any authenticated player uploading an image.
- **Impact:** The old code ran `Promise.all([checkImageSafe(buf, type), cdnUpload])` — the CDN upload started immediately, in parallel with the moderation check, not after it. An image moderation flagged as unsafe was **still durably uploaded to `cdn.hackclub.com`** (a public, no-auth-required host); only the URL was withheld from the API response. There was no delete/revoke call anywhere in the codebase (`grep -rn "cdn.hackclub.com" src/` confirmed only the two upload POSTs exist, no DELETE). This directly contradicts the stated requirement that moderation gate what reaches the CDN.
- **Existing mitigations:** The client never received the CDN URL for a rejected image, so casual discovery was not trivial, but the file was not a "no-op" upload — it was live, public infrastructure storage regardless of the verdict.
- **Fix:** Reordered to `await checkImageSafe(...)` first; the CDN `fetch()` is now only constructed and sent if `safety.safe` is `true`.
- **Regression test:** `uploads.test.ts` now spins up the real `uploadsRouter` on a loopback HTTP server and asserts, against a live request/response round trip, that a rejected verdict and a thrown moderation error both return `400 image_rejected` with the mocked CDN endpoint never invoked; a positive control (safe verdict → CDN called, URL returned) proves the harness itself isn't just vacuously passing.

### H-2: Image moderation failed open on every error, not just when unconfigured — FIXED
- **Severity:** High
- **File/function:** `apps/server/src/imageModeration.ts`, `checkImageSafe()`
- **Prerequisite:** OpenRouter API errors, times out, rate-limits, or returns malformed JSON (all realistic third-party-API failure modes) — no attacker action needed to trigger it, though an attacker aware of this could deliberately time uploads around known outages.
- **Impact:** Every failure path (`!r.ok`, thrown exception, timeout) returned `{ safe: true, reason: "" }` — an image that was never actually checked was treated as checked-and-safe. There was already a committed-but-failing regression test (`imageModeration.test.ts`, untracked on this branch) asserting the opposite behavior, confirming this was a known, intended requirement that the implementation didn't meet. A missing `OPENROUTER_API_KEY` also fell open unconditionally, with no way to distinguish "deliberately unconfigured for local dev" from "misconfigured in production."
- **Existing mitigations:** None — this was the entire gap.
- **Fix:** A real API-call failure (`!r.ok`, thrown exception) now always fails closed (`{ safe: false, reason: "moderation_unavailable" }`). A missing key now also fails closed by default — matching prod, which has no reliable "am I prod" signal to key off (`NODE_ENV` isn't set there, same reasoning as `auth.ts`'s `ALLOW_LOCAL_REDIRECT`) — unless `ALLOW_UNMODERATED_UPLOADS=true` is explicitly set, which is the new opt-in local-dev escape hatch (documented in `.env.example`). An invalid/empty/oversized buffer also now fails closed regardless of key state, closing a second latent gap in the same conditional.
- **Regression test:** `imageModeration.test.ts` — the pre-existing failing test now passes; 6 tests total covering: throws-fails-closed, no-key-and-no-opt-in-fails-closed (new default), no-key-with-opt-in-still-allows (dev escape hatch), invalid-buffer-fails-closed-even-with-a-key, and explicit-unsafe-verdict-still-rejects.

### H-3: Lobby password had no attempt limit — brute-forceable in ~3 minutes — FIXED
- **Severity:** High
- **File/function:** `apps/server/src/ws/gameServer.ts`, `lobbyJoinError()` / the `lobby_join` WS message handler
- **Prerequisite:** An authenticated session and knowledge (or a guess) of a 5-character lobby ID; no friendship or invite needed.
- **Impact:** Lobby passwords are 4 digits (`randomInt(1000, 10000)`, 10,000 possibilities). The only throttle was the generic per-connection message cap (60 msg/sec), so all 10,000 combinations could be exhausted in ≈167 seconds over one WebSocket connection — confirmed by code trace, not a live brute-force run. A "private" lobby's actual privacy guarantee was closer to a public one against even a mildly motivated single account.
- **Existing mitigations:** The generic 60 msg/sec throttle (not password-specific), and the per-IP WS-upgrade cap (30 new connections/60s) which only slows multi-connection parallelization, not a single-connection guess loop.
- **Fix:** Added a per-user rate limit (10 attempts/60s, reusing the existing `consumeRateLimit` primitive) that only engages on an actual wrong-password attempt against a private lobby — correct passwords, public lobbies, and the lobby's own owner never touch it. This raises brute-force cost from ~3 minutes to ~16.7 hours per account; a multi-account attacker (explicitly assumed by the threat model) can still parallelize, but each account now needs to go through Hack Club Auth OAuth, not just an HTTP request — a real, if not absolute, cost increase.
- **Regression test:** `gameServer.test.ts` — `lobbyJoinError` pure-logic tests (missing lobby, public lobby, owner bypass, correct/wrong password) plus two tests exercising the real `LOBBY_JOIN_ATTEMPT_LIMIT` constant proving the 11th attempt in a window is blocked and that one user's attempts don't exhaust another's budget.

### H-4: BOM CSV uploads were never checked for formula injection — FIXED
- **Severity:** High
- **File/function:** `apps/server/src/routes/bomCsv.ts`
- **Prerequisite:** Any authenticated player submitting a hardware project with a BOM CSV; a reviewer opening the "Download BOM (.csv)" link (confirmed present in `apps/dashboard/app/review/[id]/page.tsx`) in Excel or Google Sheets.
- **Impact:** `validateBomCsv` only checked structural validity (quoting, row/column counts, byte size, UTF-8) — it never checked for a leading `=`, `+`, `-`, or `@`, the classic CSV-formula-injection trigger (CWE-1236). The raw, unmodified uploaded bytes were stored on the CDN and linked directly for staff to download. `apps/dashboard`'s own project-data CSV export (`app/api/projects/export/route.ts`) already neutralizes exactly this pattern with a leading `'` — the BOM upload path was the one place in the codebase that didn't.
- **Existing mitigations:** None on this specific path.
- **Fix:** Added `sanitizeBomCsv()` (parses each row/cell, prefixes a leading `=+-@` with `'`, matching the existing dashboard-export convention exactly) and call it after validation, before the bytes are sent to the CDN.
- **Regression test:** `uploads.test.ts` — neutralizes a formula cell, every one of the four trigger characters, ordinary data round-trips unchanged, and a cell needing CSV quoting still round-trips correctly.
- **Known residual limitation, documented not fixed:** matches the dashboard export's own precedent exactly (no BOM-character or tab/CR handling) — noted for completeness, not treated as a new gap since it's the codebase's established convention, not a regression.

### H-5: Ship/create/update/unship responses leaked internal moderation/fraud fields — FIXED
- **Severity:** High
- **File/function:** `apps/server/src/routes/projects.ts` — `POST /api/projects`, `PUT /api/projects/:id`, `POST /api/projects/:id/ship`, `POST /api/projects/:id/unship`
- **Prerequisite:** The project's own owner, on their own project, on a project that has been through at least one prior review cycle (or, for `ship`, the same request that just wrote a fresh `system_note` from the double-dip/fraud detector).
- **Impact:** `GET /api/projects` already redacted staff-only fields (`ban_by`, `reviewing_by`, `first_pass_note`, `system_note`, `joe_trust_score`/`joe_reason`/etc. — commit `cc29d1d`), but the fix was never applied to the four other endpoints that also return a raw `.select().single()` row. Most notably, the ship endpoint **writes a fresh internal `system_note`** (the double-dip/fraud-detection commentary) as part of the same request, then handed that exact value straight back to the player it's about, in the API's own success response.
- **Existing mitigations:** `GET /api/projects` (the list view) was already correctly redacted.
- **Fix:** Extracted `redactStaffFields` to module scope (was a per-request closure inside the list handler) and applied it at all four additional response sites.
- **Regression test:** New `projects.test.ts` — exports and directly tests `redactStaffFields`: strips every one of the 25 staff-only fields, keeps player-facing fields (including `review_note`/`reject_reason`, which are intentionally kept), and passes through a row with no staff fields set unchanged.

---

## Medium

### M-1: Session/auth tokens are read exclusively from the URL query string — documented, not fixed
- **Severity:** Medium (architectural; real risk is deployment/infra-dependent and could not be confirmed or denied from code alone)
- **Where:** All ~120 authenticated call sites in `apps/server/src/routes/*.ts`, every HTTP method including state-changing `POST`/`PUT`/`PATCH`/`DELETE` (e.g. `/api/shop/buy/:id`, `/api/projects/:id/ship`), all follow `const token = typeof req.query.token === "string" ? req.query.token : "";`
- **Prerequisite for real exposure:** Access to server/proxy/CDN access logs, or another leak path (Referer header on a direct top-level navigation to one of these URLs, browser history sync) — none of which this audit could confirm or rule out from code alone.
- **Impact:** A 14-day-lived JWT sitting in every request's URL means it's a candidate for capture anywhere a URL gets logged, cached, or reflected, for the life of that token. This is the exact "long-lived tokens in query strings/localStorage" concern named in the original brief, and it's real and systemic, not a one-off.
- **Why not fixed here:** This is the app's whole auth transport for `apps/game/web`'s static client and is used by ~120 call sites across `apps/server`; migrating to an `Authorization: Bearer` header (or httpOnly cookie, as `apps/web-shell` already does for its own newer flow) requires coordinated client-side changes across multiple apps, not a self-contained server fix. Silently changing this would risk breaking every existing client without warning — exactly what the brief says not to do. Recommend as the top architectural priority for a scoped follow-up, migrating one client at a time behind a header-or-query fallback.

### M-2: No per-user cumulative CDN storage quota — FIXED
- **Severity:** Medium
- **Where:** `apps/server/src/routes/uploads.ts` (both `POST /api/uploads` and `POST /api/projects/:projectId/bom`, since they share the same CDN key/storage liability)
- **Prerequisite:** An authenticated account, sustained automation.
- **Impact:** The only limit was the generic 60 non-GET-requests/minute global limiter; there was no cumulative per-account byte/request-count cap. A sustained script could upload continuously (bounded only by that 60/min limiter × up to 15MB/image) with no lifetime ceiling, driving real, unbounded Hack Club CDN storage/bandwidth cost.
- **Fix:** New `cdnQuota.ts` — a per-user, fixed 24h-window budget (60 requests, 100MB, same in-memory-bucket tradeoff as `rateLimit.ts`) reserved synchronously, with no `await` between the check and the write, before either CDN call starts. This makes it atomic on a single instance the same way `consumeRateLimit` already is: two concurrent uploads from the same account can't both pass a check only one should. If the CDN call itself then fails, the reservation is released, so a failed attempt doesn't permanently cost quota. The 60 req / 100MB numbers are a starting default sized to be generous for legitimate use, not a validated product number — worth revisiting with real usage data.
- **Regression test:** `cdnQuota.test.ts` (7 tests) — request-cap enforcement, byte-cap enforcement, per-user isolation, concurrent-reservation-never-oversells (10 simultaneous 100-byte reservations against a 500-byte budget grant exactly 5), and release-then-reserve. `uploads.test.ts` adds a route-level test pre-exhausting the real `CDN_UPLOAD_QUOTA` bucket and confirming the route returns `429 quota_exceeded` with the CDN mock never called.

### M-3: Direct messages have no friendship requirement — documented, not fixed
- **Severity:** Medium (product-policy question, not a code defect)
- **Where:** `apps/server/src/ws/gameServer.ts`, `msg.type === "dm"` handler
- **Prerequisite:** Any two connected, authenticated players; no friend relationship needed.
- **Impact:** Any player can DM any other online player by name/ID. The only protections are: a block list (checked, works correctly), chat censoring + moderation escalation (`censorChat`/`punishChat`), a 200-char cap, and a self-DM block. `lobby_join_friend` (a related feature) does explicitly check `areFriends()` — DM does not, an inconsistency worth resolving. Given `imageModeration.ts`'s own moderation prompt describes PIXL as "a kids' game," open unsolicited messaging between strangers is a real harassment/grooming-adjacent surface worth a deliberate policy decision, not an assumption either way.
- **Why not fixed here:** This may be intentional (open-chat-with-blocking is a legitimate design, common in many multiplayer games); restricting it to friends-only would be a real behavior change affecting every player, and the brief explicitly says not to silently change product policy. Flagging for an explicit decision — not treating "add `areFriends()` before the DM" as self-evidently correct.

---

## Low

### L-1: Timing-unsafe secret comparison on two low-frequency internal endpoints
- **Severity:** Low
- **Where:** `apps/dashboard/app/api/joe/outcome/[key]/route.ts` (`key !== secret`), `apps/dashboard/app/api/cron/*` (`Bearer ${secret}` compared with `!==`)
- **Impact:** Both endpoints are correctly secret-gated (return 401 on mismatch, both require the secret configured at all), but the comparison is `!==` rather than a constant-time one, unlike `apps/server/src/routes/admin.ts` and `apps/dashboard/lib/session.ts` (both already use `timingSafeEqual` correctly). Practically exploiting a network-observable nanosecond timing difference against a low-traffic webhook/cron endpoint is not realistic; flagged for consistency, not urgency.
- **Status:** Not fixed — genuinely low priority; noted for a future consistency pass.

### L-2: Explore/news public endpoints rely only on the generic global rate limiter
- **Severity:** Low
- **Where:** `apps/server/src/routes/explore.ts`, `news.ts`
- **Impact:** No route-specific rate limit beyond the app-wide 300 req/min (all methods) limiter — scraping the public player/project directory is bounded, but only by that generic ceiling, not a tuned one.
- **Status:** Not fixed — real baseline protection already exists; a stricter per-route limit is a tuning improvement, not a gap.

### L-3: Upload filenames are a bare timestamp
- **Severity:** Low
- **Where:** `apps/server/src/routes/uploads.ts` — `journal-${Date.now()}.${ext}`
- **Impact:** Predictable within a narrow window if the CDN's URL scheme ever incorporated this filename directly into a guessable path (not confirmed either way from code — this app never sees the final CDN URL structure, only the returned `url` field).
- **Status:** Not fixed — no confirmed exploitability, documented as a hardening note.

---

## False positives disproved

### FP-1: `PUBLIC_PROJECT_COLUMNS` test failure looked like a possible public PII leak — it was a test/export defect
This was flagged mid-audit, investigated adversarially, and **walked back** before being reported as a vulnerability:

- `explore.test.ts` (untracked, pre-existing, never wired up) imports `PUBLIC_PROJECT_COLUMNS` from `explore.ts` as a named export; `explore.ts` defines it but never exports it, so the test file's module failed to load at all — this is what actually caused the pre-existing `1 error` in the suite, not a data leak.
- Direct trace confirmed `PUBLIC_PROJECT_COLUMNS` is a genuine, already-correct SQL column allowlist (`"id, user_id, name, description, project_type, level, status, image_url, repo_url, demo_url, shipped_at, created_at, hackatime_seconds, is_peak"`), used verbatim in all 5 `.select()` calls in the file that fetch full project rows (`grep -n "PUBLIC_PROJECT_COLUMNS" explore.ts`).
- Traced `apps/server/src/db/pgCompat.ts`'s `select()`/`build()` (the same real query-builder `pgCompat.test.ts` already tests via its own `.build()` pattern, no live DB needed) and confirmed it genuinely restricts the SQL `SELECT` clause to exactly those columns — this is enforced at the database query level, not an app-level filter that could be bypassed by a stray extra field.
- Per explicit instruction, built a **black-box, query-behavior-level regression test** (`explore.test.ts`, rewritten) rather than just exporting the constant to satisfy the old one:
  - Asserts `PUBLIC_PROJECT_COLUMNS` lists no field from the same staff-only catalog `redactStaffFields` uses.
  - Calls the **real** `pgCompat` query builder and asserts the actual generated SQL `SELECT` clause (not the JS string) excludes every sensitive column and still includes every field the public routes need.
  - Simulates a matching real-DB row (built strictly from the requested columns) through the same `{...p, ...computed}` spread pattern `explore.ts` uses, and asserts no sensitive key survives.
  - Statically scans `explore.ts`'s own source for **every** `.from("projects").select(...)` call (all 7, including two narrow literal ones like `select("id, user_id")` used only for internal counting/joins) and asserts none requests `"*"` or a sensitive column — this is the regression guard against a future route accidentally bypassing the allowlist.
- Also manually re-verified `GET /api/explore/projects` (the drafts-inclusive listing — confirmed it has no status filter beyond archived/rejected/banned, so it does include drafts) and `GET /api/explore/projects/:id`: both spread only the allowlisted row plus clearly-safe computed fields (`owner_name`, vote counts); the single-project route's `review_audits` query explicitly selects only `verdict, created_at`, never reviewer identity.
- **Verdict: SAFE / test-and-export defect, not a vulnerability.** Fixed by exporting the constant (one line) and replacing the weak 4-line test with the query-behavior-level suite above (5 tests, 279 assertions). This also cleared the pre-existing `1 error`/`1 fail` in the full suite that predated this session.

### FP-2: JWT algorithm confusion / `none`-algorithm forgery
Empirically tested against `session.ts`'s exact `jwt.verify(token, JWT_SECRET)` call (no explicit `algorithms` option) with a forged `alg: "none"` token and a token signed with a wrong secret. Both were correctly rejected (`jwt signature is required` / `invalid signature`). No RSA/asymmetric keys exist anywhere in the auth flow, so the classic RS256→HS256 confusion attack (which needs a public key an attacker can sign against) doesn't apply — `jsonwebtoken`'s implicit-algorithm inference for a plain string secret is limited to HMAC variants. **Verdict: SAFE.** (Recommend hardcoding `algorithms: ["HS256"]` explicitly as defense-in-depth against a future library or usage change — not itself a fix for a live gap.)

### FP-3: SSRF via obfuscated IPv4 forms bypassing `isBlockedIp`
Tested `new URL(...)` against decimal (`2130706433`), hex (`0x7f000001`), octal (`017700000001`/`0177.0.0.1`), short-form (`127.1`), userinfo-bypass (`evil.com@127.0.0.1`), and fragment-bypass (`127.0.0.1#@evil.com`) forms. Node/Bun's WHATWG-compliant URL parser normalizes every one of these to plain dotted-decimal `127.0.0.1` before `isBlockedIp` ever sees the hostname. Also tested the IPv4-mapped IPv6 case both in its "textbook" form (`::ffff:127.0.0.1`) and the actual compressed form Node produces (`::ffff:7f00:1`) — both correctly blocked, the latter via the "not cleanly parseable, refuse rather than guess" fallback rather than the `::ffff:` unwrap path the code comment describes, which is a cosmetic mismatch, not a security gap (the outcome is still fail-closed). **Verdict: SAFE**, all forms tested. (Not re-litigating the broader DNS-rebinding fix — that was this session's earlier, already-completed work.)

### FP-4: Mass assignment on project create/update
`POST /api/projects` and `PUT /api/projects/:id` both route through `parseProjectBody()`, which builds an explicit, individually-validated field object (name, description, repo/demo URLs via `normalizeProjectUrl`, numeric clamps, boolean coercions) — never `{...req.body}` spread into a DB write. `bom_url` is explicitly hardcoded to `""` in this parser with a comment explaining exactly why (it must only be settable by the upload endpoint's own ownership+CSV checks). **Verdict: SAFE.**

### FP-5: Shop purchase race condition / double-spend
`buy_shop_item` (Postgres stored procedure, `drizzle/*.sql`) does `select pixels into v_balance from users where id = p_user_id for update;` before the balance check and `update ... set pixels = pixels - v_price`, inside one transaction — genuine pessimistic row locking, the textbook correct fix for this exact class of bug. A prior migration in the same file also closed a real, previously-live price-integrity bug (client-supplied `config` shape could dodge the price computation) and revoked `PUBLIC` execute on the money-moving RPCs. **Verdict: SAFE**, and better-hardened than a first read suggested.

---

## Fixes applied (all on `security/safe-full-audit`, uncommitted, for review)

| # | File(s) | Fix | Tests added |
|---|---|---|---|
| 1 | `apps/dashboard/package.json`, `apps/landing/package.json`, `apps/web-shell/package.json`, `bun.lock` | `next` 16.2.11 → 16.3.5 (2 critical RCE advisories) | N/A — verified via `bun audit` + full build/typecheck/test of all 3 apps |
| 2 | `apps/server/src/routes/uploads.ts` | Moderate before CDN upload, not concurrently | `uploads.test.ts` — live route-level round trip, CDN mock proven never called |
| 3 | `apps/server/src/imageModeration.ts` | Fail closed on moderation error/timeout/malformed response and on missing key by default (dev opt-in only); invalid buffer fails closed too | `imageModeration.test.ts` (6 tests) |
| 4 | `apps/server/src/ws/gameServer.ts` | Per-user rate limit on wrong lobby-password attempts | `gameServer.test.ts` (+2 tests) |
| 5 | `apps/server/src/ws/gameServer.ts` | Per-user cooldown on `save_npcs` (resource-exhaustion backstop) | `gameServer.test.ts` (+2 tests) |
| 6 | `apps/server/src/routes/bomCsv.ts`, `uploads.ts` | CSV formula-injection sanitization on BOM uploads | `uploads.test.ts` (+4 tests) |
| 7 | `apps/server/src/routes/projects.ts` | Staff/fraud fields redacted on create/update/ship/unship responses, not just list | `projects.test.ts` (new file, 3 tests) |
| 8 | `apps/server/src/routes/explore.ts`, `explore.test.ts` | Exported existing `PUBLIC_PROJECT_COLUMNS` allowlist; replaced weak test with query-behavior-level regression suite | `explore.test.ts` (rewritten, 5 tests, 279 assertions) |
| 9 | `apps/server/src/routes/cdnQuota.ts` (new), `uploads.ts` | Atomic per-user daily CDN request/byte quota on both upload routes | `cdnQuota.test.ts` (new file, 7 tests) + `uploads.test.ts` (+1 route-level test) |

Plus, from earlier in this session (already summarized to the user, included here for completeness of the branch's total security work): DNS-rebinding-proof SSRF guard (`urlLiveness.ts`) reused by `gitRepoUrl.ts`'s git-discovery probe instead of duplicating raw `fetch()`.

## Regression tests

All new/modified test files, current state:

```
apps/server/src/imageModeration.test.ts    6 pass
apps/server/src/routes/bomCsv.ts (via uploads.test.ts)  covered above
apps/server/src/routes/cdnQuota.test.ts    7 pass  (new)
apps/server/src/routes/explore.test.ts     5 pass (279 expect() calls)
apps/server/src/routes/gitRepoUrl.test.ts  31 pass
apps/server/src/routes/projects.test.ts    3 pass  (new)
apps/server/src/routes/uploads.test.ts     12 pass
apps/server/src/routes/urlLiveness.test.ts 55 pass
apps/server/src/ws/gameServer.test.ts      9 pass  (new)
```

Full `apps/server` suite: **164 pass / 0 fail / 0 error** (was 125 pass / 2 fail / 1 error at session start — both pre-existing failures are genuinely fixed, not just unrelated; the prior pass's count of 151 grew by 13 more this pass: +2 in `imageModeration.test.ts`, +7 new `cdnQuota.test.ts`, +4 in `uploads.test.ts`).

## Remaining architectural risks

1. **Query-string session tokens** (M-1) — the single biggest remaining structural risk; needs a coordinated, multi-client migration, not a server-only patch.
2. **In-memory rate limiting/quota doesn't scale horizontally** — `rateLimit.ts`'s comment already documents this (buckets are per-process); if `apps/server` is ever run as more than one replica, every limit in this report (including the CDN quota, H-3, and NPC-save limit) is effectively divided by the replica count. Not a new finding, just re-confirmed as still true.
3. **DM friends-policy ambiguity** (M-3) — needs an explicit product decision, not a default-safe assumption either way.
4. `apps/server/src/routes/gitRepoUrl.ts`'s git-discovery probe already reuses `urlLiveness.ts`'s DNS-pinned `safeRequest`/`hostIsPublic` directly (confirmed, `gitRepoUrl.ts:18,89,91`) — **not** a remaining gap, this line previously said otherwise and was stale. `apps/dashboard/lib/bom.ts`'s `fetchBomRows` is a separate, still-open gap: it calls `assertSafeExternalUrl(url)` then a plain `fetch(url, ...)` as two independent steps, so a DNS answer that changes between them (rebinding) isn't caught the way `urlLiveness.ts` catches it. Out of scope for this pass; worth porting the same pinned-connect pattern into the dashboard app.

## Abuse/privacy risks

- **DM harassment surface** — see M-3. Concrete, real, needs a policy call given the target audience.
- **Lobby password brute-force** — meaningfully raised (H-3), not eliminated; a sufficiently resourced multi-account attacker still has a path, bounded now by OAuth account-creation cost rather than an HTTP request cost.
- **Query-string tokens in access logs** — see M-1; real exposure depends on infra log retention/access this audit could not verify.
- **CDN storage abuse for cost/DoS** — meaningfully bounded now (M-2, fixed); the 60 req/100MB per-day default is a starting number, not a validated product ceiling.

## Production-hardening checklist

- [ ] Confirm Orchard's ingress is the *only* network path to `apps/server` (no direct-to-container access), and that it appends exactly one `X-Forwarded-For` hop, matching `trust proxy: 1` — this audit could verify the code's assumption is internally consistent, not the actual deployment topology.
- [ ] Confirm `BASE_URL` is always set to an `https://` URL in every deployed dashboard environment — `lib/session.ts`'s `secure` cookie flag silently defaults to `false` if `BASE_URL` is unset or doesn't start with `https`.
- [ ] Set `OPENROUTER_API_KEY` in every real deployment — without it, uploads now fail closed (H-2), so a missing key is an outage, not a silent moderation bypass; confirm `ALLOW_UNMODERATED_UPLOADS` is never set outside local dev.
- [ ] Revisit the CDN quota numbers (M-2, `cdnQuota.ts`'s `CDN_UPLOAD_QUOTA`) once there's real usage data — 60 requests / 100MB per day is a conservative starting default, not a measured one.
- [ ] Port the DNS-pinned `urlLiveness.ts` pattern into `apps/dashboard/lib/bom.ts`'s `fetchBomRows` (see Remaining architectural risks #5) — same SSRF-rebinding class already fixed in `apps/server`, still open in `apps/dashboard`.
- [ ] Decide DM friends-policy (M-3), and if changed, update `lobby_join_friend`'s existing `areFriends()` check to match for consistency either way.
- [ ] Plan the query-string-token → header/cookie migration (M-1), one client at a time.
- [ ] Add `algorithms: ["HS256"]` explicitly to `jwt.verify()` in `session.ts` (defense-in-depth, not a live gap).
- [ ] Swap `!==` for `timingSafeEqual` on the Joe webhook and cron-secret checks for consistency (L-1).
- [ ] Add web-shell CSP headers (`apps/web-shell/next.config.ts` currently has none); dashboard/landing have `frame-ancestors 'none'` but no `script-src` restriction — a future XSS would have no CSP-layer mitigation there. Not fixed here: a CSP wrong enough to break hydration/scripts is worse than none, and verifying a correct one needs running every page, which this static audit couldn't safely do.
- [ ] Re-run `bun audit` periodically; several moderate/high advisories remain in **dev-tooling-only** transitive dependencies (`shadcn` CLI's `fast-uri`/`ip-address`/`hono`/`postcss`/`nanoid`, `eslint`'s `js-yaml`/`brace-expansion`, `drizzle-kit`/`tsx`'s `esbuild`, `pixorpheus`'s `jimp`→`file-type`, `pixo-dm`'s bundled `express`→`qs`) — none of these run in the production request path, so they were deliberately not bumped in this pass to avoid unrelated churn, but they're worth a dedicated dependency-hygiene pass.
