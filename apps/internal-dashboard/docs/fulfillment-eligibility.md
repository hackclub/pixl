# Fulfillment eligibility engine

Advisory funding check shown on every order in the internal dashboard's `/fulfillment` queue. Code lives in `apps/internal-dashboard/lib/eligibility/`; the ledger migration is `apps/server/drizzle/0229_fulfillment_commitments.sql` (not applied by this change).

## Funding source

Policy `2026-10-22.3` funds each project from what the player was actually paid, not from a flat rate. The pixel payout already encodes the RE-derived rate (about $4 to $6 per hour) at the time of the ship. Per project and beneficiary the engine sums `pixel_transactions` rows with reason `project_approved` and `review_reverted` (net pixels), takes the hours from the latest `project_approved` row, adds back any funding withheld for a hardware grant (`projects.funding_deducted_px`, so the grant order or prior grant is counted once as spending), and converts pixels at the configured pixel value. The result is capped at credited hours times the $6.00 maximum payout, which treats referral boosts and community multipliers above that as bonuses; a capped project is flagged. If Ships verifies fewer hours than were paid, funding scales down proportionally. A verified project with no payout rows is shown as Unverified with the reason `payout_unestablished`; it is never assumed to be $4 or $6. Other pixel reasons do not enter project funding. Earlier policy versions keep the flat $4 rate. The current rate of the player is never applied retroactively.

Reviewer earnings are a separate funding source. The engine reads the player's own `pixel_transactions` rows for `review_payout` and `review_payout_backfill`, then subtracts signed `review_payout_voided` and `review_payout_cut` rows. It converts the net pixels at the configured pixel value and does not apply project hour rates or Ships checks. Only a complete, consistent ledger read counts; missing or malformed evidence is excluded, and sign mismatches or project-linked reviewer transactions require review. `review_payouts` is never added to the funding total: it is workflow bookkeeping without a transaction ID, and pending or failed rows do not prove wallet credit. If a reviewer has a voided settlement, the engine reconciles net standard payout ledger pixels to active `paid` and `credited` settlement totals; a mismatch excludes reviewer funding and requires review, catching failed clawbacks even if the settlement row's `credited` flag is stale. Ledger rows are keyed and deduplicated by transaction ID, so a payout row and its corresponding wallet transaction are never summed as two earnings sources.

The server's `EARNING_REASONS` list also recognizes `bounty`, `referral_reward`, `fulfillment_payout`, and `operation_blackout` as leaderboard earnings. Fulfillment eligibility still excludes those categories, manual pixel grants, shop refunds, and purchases; this change only adds reviewer payouts.

## Sources of truth, and their limits

| Fact | Source | Limit |
|---|---|---|
| Approved hours | `projects.approved_hours`, `project_collaborators.approved_hours` | Pixl's own number. Deflations rewrite it in place, so it is already post-clawback. The pre-deflation figure comes from `review_audits` (`verdict = 'hours_deflated'`) and is display only. |
| Airtable presence | `projects.airtable_record_id`, `project_collaborators.airtable_record_id`, read live with one GET | The base is a staging base, not Unified. A record existing proves nothing about Unified. |
| Submitted to Unified | Airtable checkbox `Automation - Submit to Unified YSWS` | Set by hand by a Hack Club teammate. Means "forwarded", not "accepted". |
| Approved in Ships | `GET https://ships.hackclub.com/api/v1/ysws_entries` (public, read-only, no credentials) | Evidence that an entry exists and carries `approved_at`. Not immunity from later deflation, deletion or clawback. See "Ships integration". |
| Confirmed in Unified | none | No Unified read API exists. `UnifiedVerifier` remains an injection point; Ships is the live verification source. |
| Project funding grants | `projects.needs_funding`, `funding_usd`, `funding_deducted_px`, and the shop order named `Hardware funding grant , <project name>` | `funding_usd` is the reviewer-editable **request**, not a payment. A grant is real once approval withheld pixels (`funding_deducted_px > 0`) and inserted that shop order. There is no foreign key; the link is the exact order name. |
| Previous fulfillment | `shop_orders` in `ordered / credited / shipped / done`, plus `fulfillment_commitments` | Orders claimed before the migration have no ledger row; their amount is derived from the order and labelled "not in ledger". |
| Real cost | `shop_orders.actual_cost_usd`, `hcb_link` | Entered by the fulfiller at the credited stage. |

Consequence: project hours are verified only when a Ships entry matches (below). Without a fresh Ships snapshot, project funding remains unverified; a player can still be `Covered` when verified reviewer ledger earnings cover the order and no independent review reason blocks it.

## Project funding grants (reconciliation)

Approving a hardware project with `needs_funding` withholds pixels and inserts a `pending` shop order that goes through the normal claim flow. That order is the record of the grant, so it is counted once, as an order, at face value `funding_usd` (the pixel price can be lower because the withheld pixels are clamped to the gross payout).

- Order found by exact name for the project: no separate prior grant; the order is counted at `funding_usd`. A cancelled order counts 0.
- Approved (`funding_deducted_px > 0`) but no order found: counted as a prior grant at `funding_usd`.
- Second order for the same project: `Review required` (duplicate funding order).
- Order named like a funding grant that matches no project (for example a renamed project) while a prior grant exists, or two projects sharing a name: the prior grant is marked ambiguous and the order is `Review required`, because it might be counted twice.
- Requests that were never approved (`funding_deducted_px = 0`) count nothing.

When face value differs from the recorded supplier cost or the shop budget, the amount is still the face value and the breakdown states the discrepancy.

## Ships integration

Code: `lib/eligibility/ships.ts` (provider and cache), `shipsMatch.ts` (matching), engine and `evidence.ts` (use).

Provider: server side only, one GET of the whole dataset (about 10.9 MB, 9.9k entries, roughly 87 PIXL). No query filtering is assumed; only entries whose `ysws` equals `pixl` (case-insensitive, exact) are kept, indexed by record id, repository and GitHub username. Other fields (description, name, screenshot) are dropped. Records are validated one by one (record id shape, finite non-negative hours, numeric or null `approved_at`); unusable ids are remembered so a match against them is `ambiguous`, never "not found". Duplicate record ids are removed and flagged ambiguous. A truncated body, bad JSON, non-array, oversize body (64 MB cap), HTTP error, timeout (25 s) or a dataset that shrinks below half of the last one is rejected and never replaces the snapshot. ETag revalidation is used (304 renews the timestamp).

Cache: per server process, TTL 5 minutes (`SHIPS_CACHE_TTL_MS`, clamped 1 to 60 minutes), one shared in-flight request, exponential backoff (30 s up to 15 min) after failures. It is not globally coherent: each dashboard replica keeps its own snapshot and shows its own sync time. That is acceptable because the source is public and idempotent and cost is one request per replica per TTL; a shared cache is not needed for correctness. `SHIPS_API_URL` may override the endpoint (https, or http on localhost, for tests). A failed refresh keeps the old snapshot with its true age and an error, never a new timestamp. Staff can force a refresh (`refreshShipsSnapshot`, fulfiller role, one refresh per minute across staff); the call is read-only.

Matching: the stored `airtable_record_id` is the Airtable staging record, whose id space differs from Ships. The staging record's field `Automation - YSWS Record ID` holds the Unified record id, which is the id Ships uses. That field is read with batched GETs (up to 40 ids per request, cached 5 minutes) and matched exactly against the Ships snapshot, then the normalized repository and, when Ships has one, the Slack id must agree. A project with no staging id falls back to repository plus a unique matching Slack id. Repository and hours alone never verify. An unreadable Airtable, a missing staging record, an empty mapping, or two projects mapping to one Unified record all stay Unverified or go to Review. A collaborator has their own staging record and so their own Unified record.

Freshness: `Covered` requires the snapshot to be at most 30 minutes old (`shipsMaxAgeMs` in the policy); older snapshots yield `Unverified` with reason `ships_stale`.

Hours: in the data seen, all Ships `hours` are integers and the rounding rule is not documented, so they are treated as unestablished. Per project, expected Ships hours are `approved_hours - prior_approved_hours` (an update ship gets a new Airtable row holding only new hours). Counted hours are the lower of Ships and that figure; the higher figure is also computed. If the order is affordable at the lower figure it is covered with a note. If it is affordable only at the higher figure it becomes `Review required` (`hours_discrepancy`). If neither pays it is `Insufficient`. When `prior_approved_hours > 0` only the record's own hours are verified; earlier-ship hours stay unverified and other Ships records for the repository are listed, not counted.

Order verification labels (separate from the funding verdict): Verified in Ships, Approval unconfirmed, Pending submission, Not found in Ships, Verification unavailable, Needs review.

## Formulas

All money is computed in integer cents.

```
projectVerifiedFunding = existing project payout-history calculation, with Ships/Unified verification, caps, and grant adjustments
reviewerCreditedPx     = sum actual positive reviewer credit ledger rows
reviewerCorrectionPx   = sum actual negative reviewer correction ledger rows
reviewerFunding        = verified reviewer net pixels * pixelValueUsd, rounded to cents; otherwise $0
verifiedEarnedFunding  = projectVerifiedFunding + reviewerFunding
committed              = sum(claimed other orders) + sum(relevant prior project grants)
remaining              = verifiedEarnedFunding - committed
after                  = remaining - orderAmount
```

`projectVerifiedFunding` keeps the current policy's payout-history conversion and verification rules (`ratePerHourUsd` applies only to older flat-rate policy versions). Reviewer credits use their actual pixel value and never use project hours, Ships, or the hourly cap. Unverified project funding remains an upper-bound display value and never enters `verifiedEarnedFunding`.

### Deduplication and exclusions

A project row is excluded (and the reason is shown) when it is a second row for the same project, not `approved`, banned, `removed` in Unified, a second project with the same repository, or has no approved hours. Owner rows are preferred over collaborator rows. A repository duplicate also forces `Review required`.

### Which dollar value counts against funding

Defined in `orderAmount()`, in this order:

1. **Face value**, if the item matches an `itemValueRules` entry. The HCB grant face value times quantity is what actually leaves the account. A 2x $10 Hardware Grant counts $20 even though the shop budget is $22.40 and even if a different `actual_cost_usd` was typed in.
2. **Recorded supplier cost** (`actual_cost_usd`), once a fulfiller has entered it.
3. **Shop budget** (`price * pixelValueUsd`), a ceiling used before the real cost is known.

Pixels paid by the player never change the counted amount. They fund the player's wallet, not Hack Club's grant budget. Cancelled orders count 0.

Supplier cost more than one cent above the shop budget forces `Review required`.

## Statuses

Evaluated in this precedence:

1. `Restricted`: any restriction (currently: the player has a banned project).
2. `Review required`: disputed hours (`projects.system_note`), a missing Airtable staging record, a duplicate repository, no project mapped to the player and no verified reviewer earnings, an inconsistent reviewer ledger, an over-budget flag, supplier cost above budget, or a zero-valued order.
3. `Unverified`: commitments could not be loaded, evidence is older than `evidenceMaxAgeMs` (6h), or verified funding does not cover the order but unverified hours might.
4. `Covered`: verified funding minus commitments covers the order, evidence is fresh.
5. `Insufficient`: verified funding is short and either no unverified hours remain, or even the upper bound is short.

## Commitment accounting

`claimOrder` now calls `claim_shop_order_with_commitment`, which in one transaction takes an advisory lock on the player, optionally enforces the cap, writes the ledger row (who, when, amount, basis, verdict, policy version, evidence snapshot with no personal data), and flips `pending -> ordered`. The ledger is keyed by order id, so a retry returns `already_claimed`. Cancelled orders stop counting by joining on `shop_orders.status`, so refunds need no write. `markOrderCredited` and `updateOrderFulfillmentInfo` refresh the ledger amount when the real cost is recorded.

Enforcement is off (`enforceOnClaim: false`). In that mode the claim always proceeds and the verdict is only recorded. Turning enforcement on is a policy change: bump the version in `policy.ts`. With enforcement on, a claim needs verdict `covered` and the lock-time cap check to pass.

No claim is accounted silently:

- Evidence cannot be loaded (advisory mode): the claim is still written to the ledger, as `unverified`, at the order's own amount, with evidence `{degraded: evidence_unavailable}`; the audit log says so. With enforcement on it is refused.
- Migration not applied (`42883` / `42P01`): the claim is refused with a "migration 0229" error because `allowUnledgeredClaim` is false in every shipped policy. Apply 0229 before claims are used. Setting the flag to true in a new policy version restores the old direct update, which is audit-logged as claimed WITHOUT a funding ledger entry.
- Anything else (permissions, runtime errors, a failed order lookup): the action throws and nothing is claimed.
- A failed ledger amount refresh after `markOrderCredited` or `updateOrderFulfillmentInfo` is written to the order audit log (`ledger_refresh_failed`).

## What is never done

The code never writes to Airtable (one GET helper, `fetchSubmissionState`, limited to one non-personal field), never approves, buys, ships, cancels or edits an order, and never sends a grant. A test greps the eligibility modules for mutating calls.

## Known limitations

- The queue badge uses cached Airtable state (5 min) and never calls Airtable per row; the selected order does a live read. A record deleted from Airtable shows as `Review required` only on the detail view until the cache turns over.
- `Restricted` is only derived from banned projects. Other compliance restrictions need a data source.
- `lib/eligibility/claim.db.test.ts` runs against a real Postgres when `PIXL_TEST_DATABASE_URL` is set (it replays every migration, then 0229) and is skipped otherwise. It was run against PostgreSQL 18; with the advisory lock removed its concurrency tests fail.
- Funding grants are linked to their order by name only; see reconciliation above. Historical grants approved before the order was inserted have no order and are counted as prior grants.
- Hours are not reduced for commitments made against hours that were later deflated; a deflation can leave a negative balance, which shows as Insufficient for the player's next order.
- `review_payouts` has no transaction ID or dedupe key. The engine therefore does not add its `paid_pixels` to wallet transactions. Repeated result rows with the same wallet transaction ID count once, but distinct transaction IDs that accidentally represent the same reviewer action cannot be correlated reliably from the current schema; there is no database-level uniqueness guarantee for reviewer wallet credits.

## First submissions, updates and re-ships

- First submission: `prior_approved_hours = 0`; the Airtable/Ships row holds all approved hours; expected Ships hours equal approved hours.
- Update (approved project shipped again): shipping freezes `approved_hours` into `prior_approved_hours` and clears `airtable_record_id`. While the update is in review the earlier approval still counts, as unverified hours (its record id is gone). After approval `approved_hours` is cumulative, the new Airtable row holds only `approved - prior`, so expected Ships hours are that delta. Verified hours are the delta; the prior hours stay provisional. Total considered hours always equal `approved_hours`; nothing is subtracted from Ships hours twice. A Ships row carrying the cumulative total is capped at the delta and flagged.
- Re-ship (needs changes, then shipped again): `prior_approved_hours` is kept, so it behaves like an update. A rejected project's frozen baseline is not counted.
- Collaborators follow the same rules with their own baseline.

## Read-only reconciliation script

`scripts/shipsReconcile.ts` does GET-only Airtable reads (four non-PII fields), one Ships fetch, and optionally a read-only SQL transaction for given Slack ids. Needs `AIRTABLE_PIXL_YSWS_UNIFIED_TOKEN`, and `DATABASE_URL` for player history. `AIRTABLE_VIEW` can select the `2-Submitted` view; otherwise records with the submit checkbox set are used. It prints record ids and hours, no personal fields.

## Ships limitations

- Ships approval is evidence, not a guarantee; later deflation or deletion is only seen on the next refresh.
- Only 18 of 87 PIXL entries carry a Slack id, so participant identity is usually confirmed by Unified record id plus repository, not by person.
- Airtable-staging counts (submitted versus missing) and hour comparisons for real players need Airtable and production data and were not run here (no credentials used).
- Per-process cache: replicas may differ by up to one TTL.
- Policy `2026-10-22.2` adds `shipsMaxAgeMs`; `enforceOnClaim` stays false.
