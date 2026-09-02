# Trial reward collaboration

## Problem

A Slack thread surfaced a mismatch between stated policy and actual behavior. Jazz asked whether collaborating on a Trial means everyone who meets the minimum hours gets that Trial's reward. Gabin answered in the thread: "if you both make the minimum hours req then you will both get a reward." The running code does not do this.

Today, a Trial-linked project can have multiple collaborators exactly like a normal project (`project_collaborators`, same invite/accept flow). But when the project ships and is approved:

- Only the project **owner** is eligible for the Trial's actual reward (the prize item, or the held-pixels bonus for the min-hours slice). This is gated by `holdForTrial` in `reviewProject()` (`apps/dashboard/app/actions.ts`), applied only to `creditBeneficiary(project.user_id, ...)`.
- Collaborators are paid through the ordinary split-payout loop - their own rate, their own hours, `holdPixels` always `false` - with **no check against the Trial's `min_hours` at all**. They get paid regardless of whether their own hours would have cleared the Trial.
- The **approval gate itself** only looks at the owner: `if (linkedTrial?.min_hours != null && creditHours < Number(linkedTrial.min_hours))` blocks the whole project from being approved if the owner's credited hours fall short, even if a collaborator on the same ship individually cleared it. The reviewer has no way to approve that ship at all today without lowering the bar or requesting changes.

## Decision

Each collaborator who **individually** clears the Trial's `min_hours` on their own credited hours gets their own full Trial reward - the same prize-or-pixels choice a solo submitter gets. This is not a split of one reward across the team; it's the same "you did the Trial" evaluation applied per person. A collaborator who doesn't clear it still gets paid the normal split-payout pixels, unchanged from today.

A ship should be approvable as long as **at least one participant** (owner or any collaborator) clears `min_hours` - the current owner-only gate is being loosened, not kept.

Approach: mirror the existing owner-side mechanism (`projects.trial_reward_choice` / `trial_held_px` / `trial_prize_px`, and the `POST /api/projects/:id/trial-reward` settlement route) onto `project_collaborators`, reusing the exact prize/pixel-slice math that already works for the owner. A more general unified rewards table (one row per beneficiary per project, covering owner and collaborators uniformly) would be a cleaner long-term shape, but is more migration than this change needs, YAGNI for now.

## Current mechanics (reference)

- `apps/dashboard/app/actions.ts` `reviewProject()`:
  - `claimedHoursFor(projectId)` / `claimedHoursForCollaborator(projectId, userId, hackatimeSeconds)` compute tracked hours.
  - Reviewer submits `approvedHours` (owner) and `collabHours_${c.id}` (per collaborator, decrease-only, defaults to claimed) via the review form - both **already visible and editable pre-approval** in `apps/dashboard/app/_components/ReviewForm.tsx` (`CollaboratorHoursInput`, line 221-240).
  - `creditHours = approvedHours ?? claimedHours`, the owner's credited hours.
  - Hard gate at line 867: blocks approval if `creditHours < linkedTrial.min_hours`.
  - `holdForTrial = !!linkedTrial && trialChoice !== "pixels"`, owner-only, passed into `creditBeneficiary(project.user_id, ..., holdForTrial)`.
  - `trialPrizeFor(linkedTrial)`, `trialMinHours`, `trialPrizePx` (the pixel value of the first `min_hours` slice, clamped to the full payout), `trialBeyondPx` (pixels for hours beyond the minimum), all computed once for the owner and reused for the notification copy and the `projects` row update (`trial_reward_choice: "pending"`, `trial_held_px: totalPx`, `trial_prize_px: trialPrizePx`).
  - Collaborator loop (line ~998-1032): computes `cCreditHours` from `collabHours_${c.id}` (clamped to `cClaimedHours`), calls `creditBeneficiary(c.user_id, ..., holdPixels` **omitted, defaults false**`)`, always paid immediately, never held, never Trial-gated.
- `POST /api/projects/:id/trial-reward` (`apps/server/src/routes/projects.ts:703-829`): owner-only (`.eq("user_id", session.userId)`), lets the player choose "item" (fulfills the prize, e.g. a shop order) or "pixels" (releases the held pixels), reading/writing `projects.trial_reward_choice` etc.
- Web UI: the claim buttons (`#tr-item` / `#tr-px`) render only on the project owner's own project page (`apps/game/web/projects/index.html`), driven by `trialRewardHtml(p)` reading `p.trial_reward_choice` etc. off the `projects` row.

## Design

### 1. Schema

New migration, `project_collaborators` gets the same three columns `projects` already has:

```sql
alter table project_collaborators
  add column if not exists trial_reward_choice text,
  add column if not exists trial_held_px integer,
  add column if not exists trial_prize_px integer;
```

No change to `projects`. No backfill needed - these are only ever set going forward, at review-approval time, same as the owner's columns.

### 2. Approval gate (loosen to "anyone clears it")

In `reviewProject()`, before the existing hard-block check, also compute each collaborator's `cCreditHours` (the same clamp-to-claimed logic the payout loop already does, just moved earlier) and check whether any of them individually clears `linkedTrial.min_hours`. The block only fires if **neither the owner nor any collaborator** clears it:

```
const anyoneClearsMinHours =
  !linkedTrial?.min_hours ||
  creditHours >= Number(linkedTrial.min_hours) ||
  collaborators.some((c) => cCreditHoursFor(c) >= Number(linkedTrial.min_hours));
```

This requires reading the `collabHours_${c.id}` form fields once, ahead of where the collaborator payout loop currently reads them the second time - refactor into one pass computing `cCreditHours` per collaborator up front, reused by both the gate check and the payout loop below (avoids reading the same form field twice with potentially different clamping).

### 3. Payout loop - per-collaborator Trial hold

For each collaborator, after computing `cCreditHours`:

```
const cHoldForTrial =
  !!linkedTrial &&
  cCreditHours >= Number(linkedTrial.min_hours ?? 0) &&
  c.trial_reward_choice !== "pixels";
```

- `creditBeneficiary(c.user_id, ..., tierUsed, cHoldForTrial)`, pass the hold flag through (currently omitted/always-false).
- Reuse `trialPrizeFor(linkedTrial)` (already computed once for the owner, same prize for everyone on this Trial) and compute this collaborator's own slice: `cTrialPrizePx = min(max(round(projectPayoutPx(trialMinHours, tierUsed, 0) * goalMult), 0), cPayout.totalPx)`, mirroring the owner's formula but against `cPayout.totalPx`.
- If `cHoldForTrial && c.trial_reward_choice !== "item"`: update the `project_collaborators` row - `trial_reward_choice: "pending"`, `trial_held_px: cPayout.totalPx`, `trial_prize_px: cTrialPrizePx`.
- Notification copy (`cCredited` string) gets the same three-way branch the owner's `credited` string already has (pending choice / kept item / normal pixels).
- Collaborators who don't individually clear `min_hours` are entirely unaffected, same immediate split-payout pixels as today.

### 4. Settlement route

Generalize `POST /api/projects/:id/trial-reward`:

- Look up the project by id (no `user_id` filter yet).
- If `session.userId === project.user_id` → existing owner path, unchanged.
- Else, look up an **accepted** `project_collaborators` row for `(project_id, user_id: session.userId)`. If found and it has a pending Trial choice, settle against that row instead (same "item" fulfills the prize / "pixels" releases `trial_held_px` logic, just reading/writing the collaborator row).
- If neither matches → 403, same as today's implicit behavior.
- Prize fulfillment (whatever creates the shop order / grants the item) needs to run per-beneficiary - confirm it's already parameterized by `user_id` rather than assuming `project.user_id` (check the fulfillment call inside the existing route before generalizing it).

### 5. Web UI

- `trialRewardHtml(p)` in `apps/game/web/projects/index.html` currently reads Trial-choice fields off the `projects` row `p` and only renders for whoever's viewing their own project. Collaborators viewing a project they're on (not the owner) need the equivalent block reading *their own* collaborator-row fields instead - the project detail API response for a collaborator's view needs to include their own `trial_reward_choice`/`trial_held_px`/`trial_prize_px` (currently only the project owner's fields are exposed at all).
- Confirm how a collaborator currently views a shared project (same `/projects/:id` page? a different collaborator-scoped view?) before wiring this in - this determines where exactly the claim UI needs to render.

### 6. Reviewer-facing (nice-to-have, not blocking)

`ReviewForm.tsx`'s min-hours warning (line 389-400) currently only compares the owner's hours field. Once collaborators can individually clear it, show a per-collaborator indicator next to each `CollaboratorHoursInput` (clears / doesn't clear `min_hours`) so the reviewer can see at a glance who's getting a Trial reward on this ship, not just whether the ship is approvable at all.

## Edge cases

- **Re-approval of an already-settled ship** (first-pass overturned, etc.): the owner path already leaves an existing `trial_reward_choice` alone (`trialChoice !== "item"` / `!== "pixels"` guards). Same guard needs to apply per-collaborator so a re-review doesn't reopen or re-hold a reward someone already claimed.
- **Collaborator removed/un-accepted after review**: out of scope for this change, no different from today's existing collaborator-removal handling for normal payouts.
- **Trial with no prize item** (pixels-only trials, if any exist): `trialPrizeFor` presumably already handles this for the owner; the collaborator path reuses the same function, so no new handling needed.
- **Multiple collaborators all clearing min_hours on a physical-prize Trial**: intentional, per the decision above - N prize items get created if N people clear it. This is a real cost/inventory implication worth the team being aware of, not a bug.

## Testing

- Unit/manual: two collaborators on a Trial-linked ship, one clears `min_hours`, one doesn't - verify the one who clears it gets held pixels + prize choice, the other gets immediate normal pixels, and both amounts are correct.
- Approval gate: owner below `min_hours`, one collaborator above - ship should now be approvable (previously blocked).
- Settlement: collaborator claims "item" vs "pixels" independently of the owner's choice on the same project.
- Re-review: overturn and re-approve a ship where a collaborator already settled their Trial choice - confirm it's not reopened.
