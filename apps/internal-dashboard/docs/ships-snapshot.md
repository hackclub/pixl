# PIXL Ships snapshot operations

The fulfillment eligibility reader uses a durable snapshot of the public Ships archive. Fulfillment page requests only read the active snapshot from Postgres; the scheduled job and the fulfiller-only manual refresh are the only paths that fetch Ships.

## Enable the scheduled refresh

1. Apply `apps/server/drizzle/0231_ships_snapshot.sql` to the database used by the internal dashboard. Migrations in this repository are applied explicitly; this file is not run by a dashboard request.
2. Set `CRON_SECRET` on the dashboard deployment.
3. Add repository Actions secret `SHIPS_SNAPSHOT_CRON_SECRET` with the same value as the deployment's `CRON_SECRET`.
4. Deploy with `SHIPS_SNAPSHOT_READER_ENABLED=false` (the default). The existing Ships reader remains active until the durable snapshot is ready.
5. Once this workflow is on the default branch, GitHub Actions calls `/api/cron/ships-snapshot` every ten minutes. The first successful call creates the active generation. Check the authenticated cron response for `snapshot.indexedPixlCount > 0`, a fresh timestamp, and no errors.
6. **Only after verifying the persisted generation**, set `SHIPS_SNAPSHOT_READER_ENABLED=true` and redeploy the dashboard. If the new reader fails unexpectedly, set it back to `false` while investigating.

The route returns only aggregate counts, timestamps, and the last error. It requires `Authorization: Bearer <CRON_SECRET>`. An absent or wrong secret fails closed. The workflow serializes its own runs; the database lease also prevents overlap with a manual refresh or another caller.

## Refresh behavior

- The source is `https://api.ships.hackclub.com/api/v1/ysws_entries?all=true&boba=false` so all historical active entries are included (Ships otherwise returns only the last three months). Real Ships host overrides are normalized to keep these query parameters.
- Each response is read with a timeout and a 64 MB limit, then validated as the complete archive array.
- Only exact, case-insensitive `ysws = "PIXL"` rows are persisted. Descriptions, display names, screenshots, and other program rows are never written.
- Candidate entries are indexed and checked before a transaction inserts the generation and changes the active pointer. The current and immediately previous generations are retained.
- A failed fetch, validation, or transaction leaves the active pointer and its rows unchanged. The attempt and bounded error are recorded, and exponential retry delay grows from 30 seconds to 15 minutes.
- A snapshot older than `SHIPS_CACHE_TTL_MS` is due for refresh; eligibility remains Unverified when a relied-on snapshot exceeds policy freshness (`shipsMaxAgeMs`, currently 30 minutes).
- An HTTP 304 renews the active snapshot timestamp only when an active generation already exists.

## Diagnostics

The authenticated route reports `outcome`, `snapshot.fetchedAt`, age, counts, bytes, `lastAttemptAt`, `nextRetryAt`, and the last error. Outcomes are `refreshed`, `not_modified`, `skipped_fresh`, `skipped_busy`, `skipped_backoff`, or `failed`. Failed refreshes and an active retry backoff return HTTP 503 so GitHub Actions records the run as failed; a busy/fresh skip returns HTTP 200.

No Sainath-specific record data is persisted separately. The matcher regression test uses the three public PIXL Unified record IDs and checks exact ID plus repository matching, wrong-repository rejection, and refusal to match by repository alone when Ships has no Slack ID.
