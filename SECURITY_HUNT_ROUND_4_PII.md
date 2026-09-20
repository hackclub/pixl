# Security Hunt — Round 4: PII leaks (address, phone, email, DOB, journals, memory)

Branch: `security/round-4-pii` (from round-3 tip `e7e4726`).
Constraint: local only. No prod, no push, no PR.

## Finding R4-1 — Report form promised unconditional anonymity the backend doesn't keep

- Class: PII / anonymity-contract violation (reporter display name).
- Severity: Low. Audience is staff-only (`requireReportViewer()` role);
  data exposed is display name, not address/DOB/email. But the promise is
  explicit and the checkbox is opt-out-by-default, so the mismatch matters.
- Trace: `apps/game/web/report/index.html:74` — "Report anonymously, the
  review team won't be shown who you are." Meanwhile
  `apps/dashboard/app/reports/page.tsx:126-128` and
  `apps/dashboard/app/reports/[id]/page.tsx:43-46,90-103` deanonymize any
  reporter with `counts.byReporter >= REPEAT_THRESHOLD (3)` ("Serial
  reporters get deanonymized to viewers"), linking their player page.
  Filing 3 legitimate reports (e.g. ongoing harassment) triggers the
  reveal, contradicting the form copy.
- Fix: disclosed the exception in the form copy ("Filing repeated reports
  reveals your name to reviewers so report spam can be caught") instead of
  removing the anti-abuse reveal, which is deliberate and documented in
  code. One line, no behavior change.
- Regression test: new `apps/game/web/report-anonymity.test.ts` pins the
  contract (anonymous option present + repeat/reveal disclosure present).
  RED (1 fail with copy reverted) → GREEN (2 pass).

## Not found (with searches)

- Address / DOB at rest: AES-256-GCM (`encryptPII`, random IV, `gcm1:`
  prefix, key required at boot) in `apps/server/src/crypto.ts` (mirrored
  in `apps/dashboard/lib/crypto.ts`); all server writes go through
  `encryptPII` (auth.ts login/backfill verified). Email/real_name are
  plaintext (needed for lookups/notifications — standard, not a leak).
- Address / DOB / email in API responses: every `decryptPII` sink
  inventoried (39 matches) — server `profile.ts` eligibility is
  `.eq("id", session.userId)` self-only; `shop.ts` uses country only for
  region math, never returns it; `projects.ts:586` select feeds
  server-side Hackatime calls and presence checks only (final
  `res.json` is `toPlayerProject(data)` of the project row, no user PII);
  dashboard sinks are perm-gated staff surfaces (export = super-only,
  review page = review-perm, Airtable push = approval flow). No server
  `select()` containing `email` reaches any response (one grep, zero
  hits); explore public endpoints select display_name/avatar only, with
  comments asserting slack_id/email are never selected.
- Journals: share tokens are 192-bit `randomBytes` (`ensureJournalShareToken`,
  `dashboard/lib/db.ts`), stable per project by design (goes to the YSWS
  Airtable field on approval); the public endpoint (`journalsPublic.ts`)
  uses timing-safe compare, uniform 404s (never confirms project ids),
  30/min rate limit, and returns journal content + display names only.
  No rotation exists — accepted limitation for a share-link scheme, not
  a leak. Reviewer journal access (`getProject`) is review-perm by design.
- Memory (pixorpheus `user_memory`/`user_personality`): `/pixl-remember`,
  `/pixl-forget`, `/pixl-memories` are helper/ticket-channel-only;
  `/pixl-mymemory [@user]` enforces self-or-helper and always responds
  ephemeral (never posts to channel), including the AI-summary path.
- Logs: grepped `console.*(email|address|birthday|phone|token|dob)` across
  server src — only status strings, raw date-parse warnings (no values
  beyond unparsed input shape... `extractBirthday` warns with the raw
  value on parse failure; that value comes from HCA, not the player, and
  lands in server logs only — noted, negligible), userIds, and error
  messages. No PII values in logs.
- Slack / email / external pushes: ship alerts carry project content +
  Slack mention only; report posts carry display name + reason;
  `dmOrEmail`/Resend bodies are moderation notices without PII;
  `shopNotify`/`notify.ts` contain no address/email/birthday/phone
  references; Joe fraud-review submission sends only slack_id-or-email
  as submitter identity (minimal, purpose-built); Airtable push +
  YSWS export are the program's stated sponsor-submission path, gated
  (approval flow / super-only) to approved projects.
- Dashboard roles: players pages (warn/ban), reports (report-viewer
  role), forms (forms perm), fulfillment (fulfiller), audit feeds
  (review-audit tab is super-only; `/audit` is owner-only, so the email
  in `updatePlayerInfo`'s mod_actions detail never reaches a broader
  audience). Anonymous reporters stay "anonymous" to viewers below the
  repeat threshold (see R4-1 for the exception).
- web-shell renders no PII fields at all (grep for
  addressLine/birthday/email across `app/` + `lib/`, excluding tests:
  zero hits) — only server-computed wallet/level values.
- Phone: HCA `phone` scope is requested but `phone_number` is never
  persisted (extractAddress drops it) and never rendered anywhere.

## Commits

- `a451e8c` fix: disclose repeat-report identity reveal on report form
  (`apps/game/web/report/index.html`, `apps/game/web/report-anonymity.test.ts`)

## Tests

- `bun test report-anonymity.test.ts` (game/web): RED 1 pass/1 fail
  pre-fix → GREEN 2 pass/0 fail post-fix.
