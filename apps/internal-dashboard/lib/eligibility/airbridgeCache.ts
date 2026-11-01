// Fast local read model + bounded background reconciliation for fulfillment.
// Normal dashboard requests do not call Airtable, Airbridge, Otter or Ships.
import { randomUUID } from "node:crypto";
import { sql } from "../pgCompat";
import { fetchSubmissionStates, type SubmissionLookup } from "../airtable";
import { getApprovals, getOtterSlack, githubRepo, type Approval, type OtterSlackResult } from "./airbridgeApi";
import type { ShipsEntry, ShipsProvider, ShipsSnapshot, ShipsView } from "./ships";

const MAX_AGE_MS = 30 * 60_000;
interface CacheRow {
  staging_id: string; mapping_state: string; unified_id: string | null;
  unified_state: string; code_url: string | null; approved_hours: number | string | null;
  approved_at_s: number | string | null; program: string | null; otter_slack_id: string | null;
  otter_checked_ms: number | string;
  otter_identity_blocked: boolean;
  last_attempt_ms: number | string;
  mapping_checked_ms: number | string; verified_at_ms: number | string;
  error: string | null;
}
export function lookupFromCache(
  ids: string[], rows: CacheRow[], now: number = Date.now(),
): Map<string, SubmissionLookup> {
  const byStaging = new Map(rows.map(r => [r.staging_id, r]));
  return new Map(ids.map(id => {
    const row = byStaging.get(id);
    if (!row || now - Number(row.mapping_checked_ms) > MAX_AGE_MS || row.mapping_state === "error")
      return [id, { kind: "error", error: "Staging mapping not verified recently" } as SubmissionLookup];
    if (row.mapping_state === "missing") return [id, { kind: "missing" } as SubmissionLookup];
    if (row.mapping_state === "empty")
      return [id, { kind: "found", info: { submitted: false, unifiedId: null } } as SubmissionLookup];
    return [id, { kind: "found", info: { submitted: true, unifiedId: row.unified_id } } as SubmissionLookup];
  }));
}
export async function readCachedStaging(ids: string[]): Promise<Map<string, SubmissionLookup>> {
  if (!ids.length) return new Map();
  const rows = await sql<CacheRow[]>`
    select * from fulfillment_unified_cache where staging_id in ${sql(ids)}`;
  return lookupFromCache(ids, rows);
}
export interface CachedOtterIdentity {
  slackId: string | null;
  checkedAt: number;
  blocked: boolean;
}

/** Never downgrade a previously established identity to an unguarded null.
 * A negative lookup after an observed identity requires human reconciliation.
 */
export function resolveOtterIdentity(
  previous: CachedOtterIdentity, result: OtterSlackResult, now: number,
): CachedOtterIdentity {
  if (result.state === "verified")
    return { slackId: result.slackId, checkedAt: now, blocked: false };
  if (result.state === "not_found")
    return { slackId: null, checkedAt: now, blocked: previous.blocked || !!previous.slackId };
  return previous; // outage: no successful timestamp or identity state update
}

export function viewFromCache(rows: CacheRow[], now: number, expectedIds: string[] = rows.map(r => r.staging_id)): ShipsView {
  const byId = new Map<string, ShipsEntry>(), byRepo = new Map<string, ShipsEntry[]>(),
    byGithub = new Map<string, ShipsEntry[]>();
  const ambiguousIds = new Set<string>();
  const cached = new Map(rows.map(r => [r.staging_id, r]));
  const health = { total: 0, current: 0, unsynced: 0, stale: 0, errors: 0, identityReview: 0 };
  // Determine completeness from active approved owners/collaborators, not from
  // whatever portion of the cache has happened to be populated.
  for (const id of new Set(expectedIds)) {
    health.total++;
    const row = cached.get(id);
    if (!row) { health.unsynced++; continue; }
    const mappingFresh = Number(row.mapping_checked_ms) > 0 &&
      now >= Number(row.mapping_checked_ms) && now - Number(row.mapping_checked_ms) < MAX_AGE_MS;
    const approvalFresh = row.mapping_state !== "mapped" ||
      (Number(row.verified_at_ms) > 0 &&
        now >= Number(row.verified_at_ms) && now - Number(row.verified_at_ms) < MAX_AGE_MS);
    const failed = !!row.error || row.mapping_state === "error" ||
      row.unified_state === "error" ||
      (row.mapping_state === "mapped" && row.unified_state === "pending");
    if (failed) health.errors++;
    if (row.otter_identity_blocked && row.mapping_state === "mapped" && row.unified_state === "approved")
      health.identityReview++;
    if (!mappingFresh || !approvalFresh || failed) health.stale++;
    else if (!row.otter_identity_blocked) health.current++;
  }
  const mappingUse = new Map<string, number>();
  // Check every mapped staging record, including pending/missing approvals.
  // Filtering to approved entries first would hide cross-record conflicts.
  for (const row of rows) {
    if (row.mapping_state === "mapped" && row.unified_id)
      mappingUse.set(row.unified_id, (mappingUse.get(row.unified_id) ?? 0) + 1);
  }
  for (const [id, count] of mappingUse) if (count > 1) ambiguousIds.add(id);
  let newest = 0;
  for (const row of rows) {
    if (row.mapping_state !== "mapped" || row.unified_state !== "approved" ||
        !row.unified_id || !row.code_url || row.approved_hours == null ||
        Number(row.verified_at_ms) <= 0) continue;
    const repoKey = githubRepo(row.code_url);
    if (!repoKey) continue;
    newest = Math.max(newest, Number(row.verified_at_ms));
    const entry: ShipsEntry = {
      id: row.unified_id, repoKey, codeUrl: row.code_url,
      hours: Number(row.approved_hours), approvedAt: Number(row.approved_at_s),
      githubUsername: repoKey.split("/")[1] ?? "",
      slackId: row.otter_slack_id, identityBlocked: row.otter_identity_blocked,
      checkedAt: Number(row.verified_at_ms),
    };
    if (ambiguousIds.has(entry.id)) continue;
    byId.set(entry.id, entry);
  }
  for (const entry of byId.values()) {
    if (entry.repoKey) byRepo.set(entry.repoKey, [...(byRepo.get(entry.repoKey) ?? []), entry]);
    const key = entry.githubUsername.toLowerCase();
    byGithub.set(key, [...(byGithub.get(key) ?? []), entry]);
  }
  const snapshot: ShipsSnapshot = {
    source: "airbridge", fetchedAt: newest, byId, byRepo, byGithub, ambiguousIds,
    invalidIds: new Set(), totalReturned: rows.length, pixlCount: byId.size,
    invalidCount: 0, duplicateCount: ambiguousIds.size, bytes: 0,
    syncHealth: health,
  };
  const ageMs = newest > 0 ? Math.max(0, now - newest) : null;
  return { snapshot, fetchedAt: newest || null, ageMs,
    fresh: health.total > 0 && health.current === health.total && health.identityReview === 0,
    error: health.errors ? `${health.errors} upstream verification record(s) failed` : null,
    lastAttemptAt: null, nextRetryAt: null };
}
export async function readAirbridgeCache(): Promise<ShipsView> {
  try {
    // Fetch exactly the active approved cohort and the matching cache state
    // in one local PostgreSQL query. Unsynced records appear via LEFT JOIN.
    const cohort = await sql<(CacheRow & { eligible_id: string })[]>`with eligible as (
      select airtable_record_id id from projects
        where status = 'approved' and banned_at is null and airtable_record_id is not null
      union
      select c.airtable_record_id id from project_collaborators c
        join projects p on p.id = c.project_id
        where p.status = 'approved' and p.banned_at is null
          and c.status = 'accepted' and c.airtable_record_id is not null
    )
    select e.id as eligible_id, c.* from eligible e
    left join fulfillment_unified_cache c on c.staging_id = e.id`;
    const rows = cohort.filter(r => r.staging_id !== null) as CacheRow[];
    return viewFromCache(rows, Date.now(), cohort.map(r => r.eligible_id));
  } catch (e) {
    return { snapshot: null, fetchedAt: null, ageMs: null, fresh: false,
      error: "Local verification cache unavailable: " + (e as Error).message,
      lastAttemptAt: null, nextRetryAt: null };
  }
}
async function save(
  stagingId: string, mapping: SubmissionLookup, approval: Approval | null,
  identity: CachedOtterIdentity, now: number, error: string | null,
): Promise<void> {
  if (mapping.kind === "error" || error) {
    // On a failed fetch, leave old evidence timestamp untouched: it must age out.
    const message = (error ?? (mapping.kind === "error" ? mapping.error : "")).slice(0, 250);
    // Record the attempted refresh even on failure, without extending the
    // validity of previously verified evidence. New failures need a row too,
    // otherwise they permanently occupy the front of the refresh queue.
    await sql`insert into fulfillment_unified_cache
      (staging_id, mapping_state, unified_state, last_attempt_ms, error)
      values (${stagingId}, 'error', 'error', ${now}, ${message})
      on conflict (staging_id) do update set
        last_attempt_ms = excluded.last_attempt_ms, error = excluded.error,
        updated_at = now()`;
    return;
  }
  const state = mapping.kind === "missing" ? "missing" :
    mapping.info.unifiedId ? "mapped" : "empty";
  const unifiedId = mapping.kind === "found" ? mapping.info.unifiedId : null;
  const verified = state === "mapped" ? (approval ? "approved" : "missing") : "pending";
  await sql`insert into fulfillment_unified_cache
    (staging_id, mapping_state, unified_id, unified_state, code_url, approved_hours,
     approved_at_s, program, otter_slack_id, otter_identity_blocked, otter_checked_ms,
     last_attempt_ms, mapping_checked_ms, verified_at_ms, error)
    values (${stagingId}, ${state}, ${unifiedId}, ${verified},
      ${approval?.repoUrl ?? null}, ${approval?.hours ?? null},
      ${approval?.approvedAt ?? null}, ${approval ? "Pixl" : null},
      ${identity.slackId}, ${identity.blocked}, ${identity.checkedAt},
      ${now}, ${now}, ${now}, null)
    on conflict (staging_id) do update set
      mapping_state = excluded.mapping_state, unified_id = excluded.unified_id,
      unified_state = excluded.unified_state, code_url = excluded.code_url,
      approved_hours = excluded.approved_hours, approved_at_s = excluded.approved_at_s,
      program = excluded.program, otter_slack_id = excluded.otter_slack_id,
      otter_identity_blocked = excluded.otter_identity_blocked,
      otter_checked_ms = excluded.otter_checked_ms,
      last_attempt_ms = excluded.last_attempt_ms,
      mapping_checked_ms = excluded.mapping_checked_ms,
      verified_at_ms = excluded.verified_at_ms, error = null, updated_at = now()`;
}
export type SyncResult = {
  outcome: "refreshed" | "busy" | "empty";
  checked: number; approved: number; errors: number;
};
export async function refreshAirbridgeCache(limit = 30): Promise<SyncResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Error("Invalid batch size");
  const token = randomUUID(), now = Date.now();
  const lease = await sql<{ token: string }[]>`
    update fulfillment_unified_sync_lease
    set token = ${token}, lease_until_ms = ${now + 120000}, updated_at = now()
    where id = 1 and lease_until_ms < ${now}
    returning token`;
  if (!lease.length) return { outcome: "busy", checked: 0, approved: 0, errors: 0 };
  let checked = 0, approved = 0, errors = 0;
  try {
    const projects = await sql<{ id: string }[]>`with eligible as (
      select airtable_record_id id from projects where status = 'approved'
        and banned_at is null and airtable_record_id is not null
      union
      select c.airtable_record_id id from project_collaborators c
        join projects p on p.id = c.project_id where p.status = 'approved'
        and p.banned_at is null and c.status = 'accepted'
        and c.airtable_record_id is not null
    )
    select e.id from eligible e
    left join fulfillment_unified_cache c on c.staging_id = e.id
    where e.id ~ '^rec[A-Za-z0-9]{14}$'
    -- Fair round-robin: failures must not starve otherwise healthy records.
    order by coalesce(c.last_attempt_ms, 0), e.id
    limit ${limit}`;
    if (!projects.length) return { outcome: "empty", checked: 0, approved: 0, errors: 0 };
    const ids = projects.map(row => row.id);
    const mappings = await fetchSubmissionStates(ids);
    const unifiedIds = [...new Set([...mappings.values()]
      .flatMap(m => m.kind === "found" && m.info.unifiedId ? [m.info.unifiedId] : []))];
    const lookups = new Map<string, Approval | null>();
    const lookupErrors = new Map<string, string>();
    for (let i = 0; i < unifiedIds.length; i += 25) {
      const batch = unifiedIds.slice(i, i + 25);
      try {
        const found = await getApprovals(batch);
        for (const [key, value] of found) lookups.set(key, value);
      } catch (e) {
        // A failing batch does not erase approvals verified by other batches.
        for (const id of batch) lookupErrors.set(id, (e as Error).message);
      }
    }
    // Preserve previously verified Slack identity across an Otter outage.
    // Recheck external enrichment only once every 12h per record, reducing
    // background network fanout by orders of magnitude.
    const prior = await sql<CacheRow[]>`select * from fulfillment_unified_cache
      where staging_id in ${sql(ids)}`;
    const oldById = new Map(prior.filter(row => !!row.unified_id).map(row => [row.unified_id!, row]));
    const identities = new Map<string, CachedOtterIdentity>();
    const approvals = [...lookups.values()].filter((v): v is Approval => !!v);
    const toCheck = approvals.filter(a => {
      const old = oldById.get(a.id);
      const sameRepo = !!old && githubRepo(old.code_url) === githubRepo(a.repoUrl);
      // A repo change cannot reuse its old identity proof. Keep a review
      // block until an exact new Otter match establishes the new identity.
      identities.set(a.id, {
        slackId: sameRepo ? old?.otter_slack_id ?? null : null,
        checkedAt: sameRepo ? Number(old?.otter_checked_ms ?? 0) : 0,
        blocked: !!old?.otter_identity_blocked || (!sameRepo && !!old?.otter_slack_id),
      });
      return !sameRepo || !old?.otter_checked_ms ||
        now - Number(old.otter_checked_ms) > 12 * 60 * 60_000;
    });
    for (let i = 0; i < toCheck.length; i += 6) {
      const block = toCheck.slice(i, i + 6);
      const values = await Promise.all(block.map(a => getOtterSlack(a)));
      block.forEach((a, j) => {
        const previous = identities.get(a.id)!;
        identities.set(a.id, resolveOtterIdentity(previous, values[j]!, now));
      });
    }
    for (const id of ids) {
      const mapping = mappings.get(id) ?? { kind: "error" as const, error: "No staging result" };
      const unified = mapping.kind === "found" ? mapping.info.unifiedId : null;
      const error = unified ? lookupErrors.get(unified) ?? null : null;
      const approval = unified && !error ? lookups.get(unified) ?? null : null;
      await save(id, mapping, approval,
        approval ? identities.get(approval.id) ?? { slackId: null, checkedAt: 0, blocked: false }
          : { slackId: null, checkedAt: 0, blocked: false },
        now, error);
      checked++;
      if (error || mapping.kind === "error") errors++;
      if (approval) approved++;
    }
    return { outcome: "refreshed", checked, approved, errors };
  } finally {
    await sql`update fulfillment_unified_sync_lease set token = null,
      lease_until_ms = 0, updated_at = now() where id = 1 and token = ${token}`;
  }
}
export function createAirbridgeProvider(): ShipsProvider {
  let last: ShipsView = { snapshot: null, fetchedAt: null, ageMs: null,
    fresh: false, error: null, lastAttemptAt: null, nextRetryAt: null };
  return {
    ttlMs: MAX_AGE_MS,
    view: () => last,
    get: async () => { last = await readAirbridgeCache(); return last; },
    refresh: async () => { await refreshAirbridgeCache(20); last = await readAirbridgeCache(); },
  };
}
