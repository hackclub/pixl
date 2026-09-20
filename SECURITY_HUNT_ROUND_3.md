# Security Hunt — Round 3 (fresh audit)

Branch: `security/round-3-hunt` off `origin/main` (`e8b90b7`).
Scope: NEW bugs only. F-1 through F-13 were not re-verified per instructions.
Constraint: local only. No prod traffic, no push, no PR.

## Commits (one per finding)

- `dea9e53` fix: pin CodeQL workflow actions to SHAs, drop persisted credentials
- `42c42b4` fix: constrain dashboard action redirects to same-app paths
- `dc25296` fix: check message origin on game logout sync
- `d14d342` fix: use CSPRNG for collaborator join codes

## Finding R3-1 — Unpinned Actions + credential persistence (supply chain)

- Class: CI supply-chain (zizmor `unpinned-uses`, `artipacked`).
- Severity: Medium (tag-move / tag-reuse swaps code running on every push to main).
- Trace: `.github/workflows/codeql.yml` used `actions/checkout@v7`,
  `github/codeql-action/init@v4`, `github/codeql-action/analyze@v4`
  (mutable tags), and checkout persisted `GITHUB_TOKEN` into git config
  although the job only reads the tree.
- Repro: `zizmor .github/workflows/codeql.yml` reported 3 `unpinned-uses`
  errors + 1 `artipacked` note.
- Fix: pinned all three refs to their tag SHAs with `# v7` / `# v4` comments
  (checkout `3d3c42e5aac5ba805825da76410c181273ba90b1`,
  codeql-action `1c5b675653bb5c22dbe9b12b556ec555138e09fd`, both verified
  to resolve to real commits via the GitHub API), added
  `persist-credentials: false`. Siblings searched: the only other workflow
  files live under untracked `pixldownnitifier/` (not part of this repo,
  out of scope, noted below).
- Regression test: re-ran `zizmor .github/workflows/codeql.yml` → "No findings
  to report" (was 4 findings).
- Adversarial review: SHA immutability holds; tag comments keep updates
  greppable; CodeQL result upload uses the runner-provided `GITHUB_TOKEN`
  env, not persisted git credentials, so the upload path is unaffected.

## Finding R3-2 — Open redirect via dashboard action return targets

- Class: Open redirect (CWE-601).
- Severity: Low. All sinks sit behind `requirePerm(...)` (reviewer/admin
  only) and Next.js server-action CSRF protections prevent a third party
  from submitting the form for a victim, so this is defense-in-depth, not
  a remotely exploitable redirect. Fixed anyway: unvalidated redirect
  targets are one refactor away from a real bug.
- Trace: `apps/dashboard/app/actions.ts` read `returnTo` (rejectProject,
  banProject, holdReview, releaseReviewHold, banIdea), `back`
  (mass-moderation actions), and `backTo` (sendNotification) straight from
  caller-controlled `FormData` into `redirect(...)`. `redirect()` follows
  absolute URLs, so `returnTo=https://evil.com` redirects the admin's
  browser off-app after the action. Hidden form inputs (`returnTo`,
  `backTo`) are trivially tampered (devtools) — the server never validated.
- Repro (pre-fix logic): `String("https://evil.com" ?? "") || fallback`
  evaluates to `"https://evil.com"` and reaches `redirect()` unchanged;
  likewise `//evil.com`.
- Fix: new `safeRedirectPath(raw, fallback)` in
  `apps/dashboard/lib/safeUrl.ts` — only same-app paths pass
  (rejects absolute URLs, `//host`, backslashes, CR/LF/line-separator
  chars, anything resolving off the base origin); applied at all 7 sink
  sites with the previous default as fallback. `nextPath` (server-computed
  via `nextReviewPath`) and fixed-path redirects needed no change.
  Siblings searched: every `formData.get("returnTo"|"back"|"backTo")` in
  the app (7 sites, all patched); dashboard login/callback take no `next`
  parameter (fixed targets); server `safeWebRedirect` (auth.ts) already
  allowlists hosts — untouched.
- Regression test: `apps/dashboard/lib/safeUrl.test.ts` gained a
  `safeRedirectPath` suite (absolute/protocol-relative/scheme/backslash/
  CRLF rejected; same-app paths incl. query strings pass). RED: suite
  fails without the helper; GREEN after. Full dashboard suite:
  164 pass / 0 fail. `tsc --noEmit` shows only two pre-existing
  `.next/` validator errors (present with changes stashed; unrelated).
- Adversarial review: bypass candidates `//evil.com` (double-slash guard),
  `/\evil.com` (backslash guard + origin check), `https:evil.com`
  (no leading `/` → fallback), embedded `%0d%0a` (URL parse keeps them in
  a same-origin path; raw CR/LF rejected; Next encodes on redirect).
  Query-string error suffixes still append correctly to the sanitized path.

## Finding R3-3 — postMessage logout without origin check (logout CSRF)

- Class: Client-side message handling (CWE-345).
- Severity: Low (integrity of session UX only — forced sign-out, no data
  theft or session fixation; the handler only clears the token).
- Trace: `apps/game/web/pixl.js` accepted
  `e.data.pixl === "logout"` whenever `e.source === window.opener`. Any page
  that opened the shell page (attacker popup via `window.open`) satisfies
  the source check, so a malicious opener could force-sign-out a visitor.
  Sender confirmed in `apps/game/scripts/web_pages.gd` (`_sign_out_js`
  posts `{pixl:'logout'}` with target `'*'`, opener = game page on apex /
  play.* / localhost).
- Repro: harness dispatching `{source: opener, origin: "https://evil.com",
  data: {pixl: "logout"}}` against the old handler called `signedOut()`.
- Fix: new `logoutSenderAllowed(origin)` — exact-match allowlist derived
  at runtime (no hardcoded hosts to drift): `location.origin`, the
  generated `config.urls.play` origin, and the play.* side of the current
  deploy pair (both directions). Same-origin (incl. `http://localhost`
  shell dev) keeps working; cross-origin must be `https:` + allowlisted.
  Receiver-side single-point fix covers both `window.open` paths in the
  sender; fail-closed elsewhere.
- Regression test: new `apps/game/web/pixl-logout.test.ts` (7 tests:
  evil-origin logout CSRF blocked, non-opener blocked, non-logout data
  ignored, play/config/play-pair origins accepted, same-origin + localhost
  accepted, plaintext-http rejected). RED: suite errors pre-fix (markers
  absent, evil origin fires); GREEN after: 25 pass / 0 fail across
  `pixl-logout` + existing `pixl-login` + `pixl-markdown` suites.
- Adversarial review: `e.origin` is browser-set and unspoofable;
  `pixl.rsvp.evil.com` / scheme tricks fail exact compare; the
  `//pixl.` swap is guarded by `!==` so non-matching hosts can't smuggle
  a value through; `null`/non-string origins rejected (legit sender is
  always http(s)).

## Finding R3-4 — Collaborator join codes from Math.random (weak RNG)

- Class: Insecure randomness (CWE-338). Framed honestly as hardening:
  6 chars from a 32-char alphabet (~30 bits) with online redemption behind
  auth + 60/min write limiter is not practically brute-forceable, but a
  join code is a bearer credential and must come from a CSPRNG.
- Trace: `apps/server/src/routes/collaborators.ts` `randomCode()` used
  `Math.random()`; `POST /api/collaborators/redeem` accepts whoever holds
  the code (owner check only excludes self-redeem).
- Fix: `randomInt` from `crypto` (same pattern as referral.ts), exported
  for test. Siblings searched: referral codes already use `randomInt`;
  no other `Math.random()` credential generation in server routes.
- Regression test: new `apps/server/src/routes/collaborators.test.ts`
  (shape + batch-uniqueness). RED: fails pre-fix (no export);
  GREEN after: 2 pass / 0 fail.

## Disproven leads (with evidence)

- Secrets: `gitleaks detect` over full history (1135 commits) → exactly 1
  hit, the `pushProjectRecord` function-name false positive on the
  `airtable-api-key` rule (`apps/dashboard/app/actions.ts:65`, import, no
  secret material). Worktree scan (92 hits) → all inside git-ignored
  `.next/` build output (Next.js dev preview/encryption keys) plus the
  same FP. Verdict: no leaked secrets.
- JWT (`apps/server/src/auth/session.ts`, `apps/web-shell/lib/session.ts`):
  verified empirically with crafted tokens — `alg:none` rejected
  ("jwt signature is required"), wrong-secret rejected, expired rejected;
  `JWT_SECRET` required at boot (throws if unset); no `kid`/`jku`
  handling; single HS256 secret. Verdict: not vulnerable, no change.
- Mass assignment: no `...req.body` spread into any DB write repo-wide
  (one grep); projects use strict allowlist `parseProjectBody`
  (bom_url forced `""`, URLs scheme-checked); profile/friends/
  collaborators/referral/uploads all use explicit field lists.
- Open redirects, server-side: `safeWebRedirect` (auth.ts) enforces
  `https:` + allowlisted hosts (`new URL` rejects scheme-relative/bare
  inputs); `web-shell/app/api/login` passes `back` only as an opaque
  query value the server re-validates; `web-shell/proxy.ts` redirects to
  self; dashboard login/callback have no `next` param. `game/serve.ts`
  redirects are all fixed targets.
- CORS: `apps/server/src/index.ts` sets `Access-Control-Allow-Origin: *`
  with NO `Allow-Credentials` and tokens travel in query strings, not
  cookies — wildcard is safe here by construction. No per-route reflector
  found (one grep).
- CRLF / header injection: `Retry-After` values are numeric; filenames are
  server-generated (`journal-<ts>.<ext>`, `bom-<ts>.csv`); redirect targets
  go through `URL`/`URLSearchParams` (encode on set). No user input flows
  into a raw header.
- Path traversal: `game/serve.ts` `serveStatic` resolves under `ROOT`
  with a containment check; uploads use generated names; no `sendFile`
  with user input.
- SSTI / XXE / deserialization / method-override / vhost confusion:
  no template engines, no XML parsers, no `eval`/`Function(` with user
  input in shipped code (only test harnesses), no `method-override`
  middleware, no `X-Forwarded-Host`/`X-Original-URL` usage (one grep each).
- Request smuggling / cache poisoning: no reverse-proxy request
  rewriting in-repo (Next rewrites are path-only; `trust proxy: 1` is
  correctly set for a single ingress hop); no shared cache layer.
- Content-type confusion: uploads narrow `req.body` with
  `Buffer.isBuffer` and branch on exact content-type allowlists.
- WebSocket (`apps/server/src/ws/gameServer.ts`): `maxPayload` 32 KiB,
  per-connection 60 msg/s throttle, JSON parse in try/catch, binary
  ignored, `move` coords must be finite + speed-capped with server snap-
  back, `change_scene` length-capped + lobby password gated with
  per-user rate limit, `village:<id>` forced to caller's own room,
  chat length-capped + censored + violation-count auto-ban. Malformed /
  oversized / wrong-type payloads are dropped, not broadcast.
- Business logic: referral blocks self-refer + enforces 6 h window + DB
  unique constraint wins races; friends/collaborator-invite require the
  other party's consent (invite→accept), self-target rejected, removed
  rows re-invited not duplicated; join-code redeem excludes the owner;
  reports block self-report + 5/hour rate limit; shop buy/cancel run
  inside `buy_shop_item` / `cancel_shop_order` RPCs under row locks
  (double-click safe); Joe webhook + reconcile share `outcomePatch`,
  which allowlists `approved`/`rejected` and only transitions out of
  `fraud_review`.
- Pixorpheus/pixo-dm webhooks: GitHub (`x-hub-signature-256`), shop
  webhook (`x-shop-webhook-secret`), ticket API + pixo-dm (`x-api-key`)
  all require secrets with timing-safe compare and fail closed when
  unconfigured; pixo-dm adds user/global/daily rate limits + Slack-ID
  format check.
- Godot: no `OS.execute`; `load()` paths are const/validated skin
  descriptors or admin-authored NPC `custom_sheet` values, all
  null-guarded (`tex == null` → return); `markdown_util.gd` only ever
  creates `[url=...]` for `https?://` schemes and loads images as
  PNG/JPG/WEBP buffers with parse-failure drops.
- Dashboard API routes / server actions spot-checked (tickets reply,
  search, projects export with CSV formula escaping, review pending,
  cron + Joe routes behind secrets, notify pixel adjust behind perms):
  auth-checked, no IDOR or mass assignment found. Landing `/api/rsvp`:
  validated + rate-limited + Airtable formula escaped.

## Tools used per target

- Installed from the awesome-bugbounty-toolset list: `gitleaks v8.30.1`
  (history + worktree), `zizmor v1.30.1` (Actions audit). Not installed:
  dynamic scanners (`dalfox`, `nuclei`, `sqlmap`, `commix`, `crlfuzz`,
  `Corsy`, …) — they need a live target with seeded DB/secrets, and
  pointing them at prod would violate the local-only constraint; every
  class they cover was instead traced statically input→sink with
  `grep`/`read` plus empirical checks where cheap (JWT vectors,
  redirect expressions).
- Static audit ran against `apps/server` (all routes + WS), `apps/dashboard`
  (actions + API routes + lib), `apps/web-shell` (proxy, login, docs/form),
  `apps/landing` (rsvp, proxy/rewrites), `apps/pixorpheus` (webhooks,
  external routes), `apps/pixo-dm` (full service, 109 lines),
  `apps/game/web` (pixl.js, meta handlers, serve.ts) and Godot scripts.

## What remains unverified

- Race conditions were reasoned about from code (DB constraints + RPC row
  locks) but NOT proven with concurrent live traffic — no seeded local
  stack exists here. If a staging env appears, the worth-firing list is:
  shop buy ×20, referral apply ×2, collaborator redeem ×2, RSVP ×20.
- `pixldownnitifier/` (untracked, not part of this repo) has its own
  zizmor findings (unpinned `actions/checkout@v4`,
  `oven-sh/setup-bun@v2`, missing `persist-credentials: false`) — left
  alone as out of scope.
- Godot image loads (`markdown_util.gd` `_load_image`) set no byte cap or
  request timeout; a giant image URL in author-controlled content could
  balloon viewer memory. Client-side robustness only, no test harness
  available here — noted, not fixed.
