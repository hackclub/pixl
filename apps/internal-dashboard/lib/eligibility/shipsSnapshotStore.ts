import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { sql as defaultSql } from "../pgCompat";
import type { ShipsEntry, ShipsSnapshot } from "./ships";

type Sql = ReturnType<typeof postgres>;
type Transaction = postgres.TransactionSql;

export const SHIPS_REFRESH_LEASE_MS = 5 * 60_000;
export const SHIPS_RETRY_BASE_MS = 30_000;
export const SHIPS_RETRY_MAX_MS = 15 * 60_000;

export interface StoredShipsSnapshot {
  id: string;
  fetchedAt: number;
  etag: string | null;
  entries: ShipsEntry[];
  invalidIds: string[];
  ambiguousIds: string[];
  totalReturned: number;
  pixlCount: number;
  invalidCount: number;
  duplicateCount: number;
  bytes: number;
}

export interface StoredShipsState {
  snapshot: StoredShipsSnapshot | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  error: string | null;
  consecutiveFailures: number;
  nextRetryAt: number | null;
  lastDurationMs: number | null;
  refreshing: boolean;
}

export type AcquireRefreshResult =
  | { acquired: true }
  | { acquired: false; reason: "fresh" | "busy" | "backoff" };

export interface ShipsSnapshotStore {
  read(): Promise<StoredShipsState>;
  acquire(input: { token: string; now: number; ttlMs: number; leaseMs: number; force: boolean }): Promise<AcquireRefreshResult>;
  activate(input: { token: string; snapshot: ShipsSnapshot; etag: string | null; durationMs: number }): Promise<string>;
  notModified(input: { token: string; fetchedAt: number; etag: string | null; durationMs: number }): Promise<void>;
  fail(input: { token: string; now: number; error: string; durationMs: number }): Promise<{ nextRetryAt: number } | null>;
}

function asNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asStringArray(value: unknown): string[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function asEntry(row: Record<string, unknown>): ShipsEntry {
  return {
    id: String(row.record_id),
    approvedAt: asNumber(row.approved_at),
    hours: Number(row.hours),
    codeUrl: String(row.code_url),
    repoKey: typeof row.repo_key === "string" ? row.repo_key : null,
    githubUsername: String(row.github_username),
    slackId: typeof row.slack_id === "string" ? row.slack_id : null,
  };
}

export function createShipsSnapshotStore(client: Sql = defaultSql): ShipsSnapshotStore {
  async function read(): Promise<StoredShipsState> {
    // Keep the active pointer, snapshot metadata, and its records from one
    // committed generation even if another refresher activates while we read.
    return client.begin(async (tx) => {
      await tx`set transaction isolation level repeatable read`;
      const [row] = await tx`
      select
        st.active_snapshot_id,
        st.last_attempt_at_ms,
        st.last_success_at_ms,
        st.last_error,
        st.consecutive_failures,
        st.next_retry_at_ms,
        st.last_duration_ms,
        st.refresh_token,
        st.refresh_lease_until_ms,
        sn.fetched_at_ms,
        sn.etag,
        sn.total_returned,
        sn.pixl_count,
        sn.invalid_count,
        sn.duplicate_count,
        sn.response_bytes,
        sn.invalid_record_ids,
        sn.ambiguous_record_ids
      from ships_snapshot_state st
      left join ships_snapshots sn on sn.snapshot_id = st.active_snapshot_id
      where st.singleton = true`;

      if (!row) {
        return {
          snapshot: null,
          lastAttemptAt: null,
          lastSuccessAt: null,
          error: null,
          consecutiveFailures: 0,
          nextRetryAt: null,
          lastDurationMs: null,
          refreshing: false,
        };
      }

      let snapshot: StoredShipsSnapshot | null = null;
      const snapshotId = typeof row.active_snapshot_id === "string" ? row.active_snapshot_id : null;
      const fetchedAt = asNumber(row.fetched_at_ms);
      if (snapshotId && fetchedAt != null) {
        const records = await tx`
        select record_id, approved_at, hours, code_url, repo_key, github_username, slack_id
        from ships_snapshot_records
        where snapshot_id = ${snapshotId}::uuid
        order by record_id`;
        snapshot = {
          id: snapshotId,
          fetchedAt,
          etag: typeof row.etag === "string" ? row.etag : null,
          entries: records.map((record) => asEntry(record as Record<string, unknown>)),
          invalidIds: asStringArray(row.invalid_record_ids),
          ambiguousIds: asStringArray(row.ambiguous_record_ids),
          totalReturned: Number(row.total_returned) || 0,
          pixlCount: Number(row.pixl_count) || 0,
          invalidCount: Number(row.invalid_count) || 0,
          duplicateCount: Number(row.duplicate_count) || 0,
          bytes: Number(row.response_bytes) || 0,
        };
      }

      const leaseUntil = asNumber(row.refresh_lease_until_ms);
      return {
        snapshot,
        lastAttemptAt: asNumber(row.last_attempt_at_ms),
        lastSuccessAt: asNumber(row.last_success_at_ms),
        error: typeof row.last_error === "string" ? row.last_error : null,
        consecutiveFailures: Number(row.consecutive_failures) || 0,
        nextRetryAt: asNumber(row.next_retry_at_ms),
        lastDurationMs: asNumber(row.last_duration_ms),
        refreshing: !!row.refresh_token && leaseUntil != null && leaseUntil > Date.now(),
      };
    });
  }

  async function acquire(input: { token: string; now: number; ttlMs: number; leaseMs: number; force: boolean }): Promise<AcquireRefreshResult> {
    return client.begin(async (tx) => {
      await tx`insert into ships_snapshot_state (singleton) values (true) on conflict (singleton) do nothing`;
      const locked = await tx`
        update ships_snapshot_state st
        set refresh_token = ${input.token}::uuid,
            refresh_lease_until_ms = ${input.now + input.leaseMs},
            last_attempt_at_ms = ${input.now},
            updated_at = now()
        where st.singleton = true
          and (st.refresh_token is null or st.refresh_lease_until_ms is null or st.refresh_lease_until_ms <= ${input.now})
          and (${input.force} or st.next_retry_at_ms is null or st.next_retry_at_ms <= ${input.now})
          and (
            ${input.force}
            or st.active_snapshot_id is null
            or not exists (
              select 1 from ships_snapshots sn
              where sn.snapshot_id = st.active_snapshot_id
                and sn.fetched_at_ms > ${input.now - input.ttlMs}
            )
          )
        returning st.singleton`;
      if (locked.length > 0) return { acquired: true };

      const [state] = await tx`
        select
          st.refresh_token,
          st.refresh_lease_until_ms,
          st.next_retry_at_ms,
          sn.fetched_at_ms
        from ships_snapshot_state st
        left join ships_snapshots sn on sn.snapshot_id = st.active_snapshot_id
        where st.singleton = true`;
      if (state?.refresh_token && Number(state.refresh_lease_until_ms) > input.now) return { acquired: false, reason: "busy" };
      if (!input.force && state?.next_retry_at_ms != null && Number(state.next_retry_at_ms) > input.now)
        return { acquired: false, reason: "backoff" };
      if (!input.force && state?.fetched_at_ms != null && Number(state.fetched_at_ms) > input.now - input.ttlMs)
        return { acquired: false, reason: "fresh" };
      // A competing refresher can commit between the failed UPDATE and read.
      return { acquired: false, reason: "busy" };
    });
  }

  async function insertRecords(tx: Transaction, snapshotId: string, entries: ShipsEntry[]): Promise<void> {
    const BATCH_SIZE = 400;
    const COLUMNS = 8;
    for (let offset = 0; offset < entries.length; offset += BATCH_SIZE) {
      const batch = entries.slice(offset, offset + BATCH_SIZE);
      const params: unknown[] = [];
      const tuples = batch.map((entry, rowIndex) => {
        const base = rowIndex * COLUMNS;
        params.push(
          snapshotId,
          entry.id,
          entry.approvedAt,
          entry.hours,
          entry.codeUrl,
          entry.repoKey,
          entry.githubUsername,
          entry.slackId,
        );
        return `(${Array.from({ length: COLUMNS }, (_, i) => `$${base + i + 1}`).join(", ")})`;
      });
      await tx.unsafe(
        `insert into ships_snapshot_records (snapshot_id, record_id, approved_at, hours, code_url, repo_key, github_username, slack_id) values ${tuples.join(", ")}`,
        params as never[],
      );
    }
  }

  async function assertLease(tx: Transaction, token: string): Promise<void> {
    const rows = await tx`
      select 1 from ships_snapshot_state
      where singleton = true and refresh_token = ${token}::uuid
      for update`;
    if (rows.length === 0) throw new Error("Ships refresh lease was lost before activation");
  }

  async function activate(input: { token: string; snapshot: ShipsSnapshot; etag: string | null; durationMs: number }): Promise<string> {
    const snapshotId = randomUUID();
    await client.begin(async (tx) => {
      await assertLease(tx, input.token);
      await tx`
        insert into ships_snapshots (
          snapshot_id, fetched_at_ms, etag, total_returned, pixl_count,
          invalid_count, duplicate_count, response_bytes, invalid_record_ids, ambiguous_record_ids
        ) values (
          ${snapshotId}::uuid,
          ${input.snapshot.fetchedAt},
          ${input.etag},
          ${input.snapshot.totalReturned},
          ${input.snapshot.pixlCount},
          ${input.snapshot.invalidCount},
          ${input.snapshot.duplicateCount},
          ${input.snapshot.bytes},
          ${tx.json([...input.snapshot.invalidIds])},
          ${tx.json([...input.snapshot.ambiguousIds])}
        )`;
      await insertRecords(tx, snapshotId, [...input.snapshot.byId.values()]);
      const switched = await tx`
        update ships_snapshot_state
        set active_snapshot_id = ${snapshotId}::uuid,
            last_success_at_ms = ${input.snapshot.fetchedAt},
            last_error = null,
            consecutive_failures = 0,
            next_retry_at_ms = null,
            last_duration_ms = ${Math.max(0, Math.floor(input.durationMs))},
            refresh_token = null,
            refresh_lease_until_ms = null,
            updated_at = now()
        where singleton = true and refresh_token = ${input.token}::uuid
        returning singleton`;
      if (switched.length === 0) throw new Error("Ships refresh lease was lost during activation");

      // Keep the current and immediately previous complete generation. If this
      // transaction fails, both the active pointer and all prior rows roll back.
      await tx`
        delete from ships_snapshot_records
        where snapshot_id not in (
          select snapshot_id from ships_snapshots order by created_at desc, snapshot_id desc limit 2
        )`;
      await tx`
        delete from ships_snapshots
        where snapshot_id not in (
          select snapshot_id from ships_snapshots order by created_at desc, snapshot_id desc limit 2
        )`;
    });
    return snapshotId;
  }

  async function notModified(input: { token: string; fetchedAt: number; etag: string | null; durationMs: number }): Promise<void> {
    await client.begin(async (tx) => {
      await assertLease(tx, input.token);
      const touched = await tx`
        update ships_snapshots sn
        set fetched_at_ms = ${input.fetchedAt}, etag = coalesce(${input.etag}, sn.etag)
        where sn.snapshot_id = (select active_snapshot_id from ships_snapshot_state where singleton = true)
        returning sn.snapshot_id`;
      if (touched.length === 0) throw new Error("Ships returned 304 without an active snapshot");
      const switched = await tx`
        update ships_snapshot_state
        set last_success_at_ms = ${input.fetchedAt},
            last_error = null,
            consecutive_failures = 0,
            next_retry_at_ms = null,
            last_duration_ms = ${Math.max(0, Math.floor(input.durationMs))},
            refresh_token = null,
            refresh_lease_until_ms = null,
            updated_at = now()
        where singleton = true and refresh_token = ${input.token}::uuid
        returning singleton`;
      if (switched.length === 0) throw new Error("Ships refresh lease was lost after a 304 response");
    });
  }

  async function fail(input: { token: string; now: number; error: string; durationMs: number }): Promise<{ nextRetryAt: number } | null> {
    const [row] = await client`
      update ships_snapshot_state
      set last_error = ${input.error.slice(0, 1000)},
          consecutive_failures = consecutive_failures + 1,
          next_retry_at_ms = ${input.now} + least(${SHIPS_RETRY_MAX_MS}, ${SHIPS_RETRY_BASE_MS} * power(2, least(consecutive_failures, 20)))::bigint,
          last_duration_ms = ${Math.max(0, Math.floor(input.durationMs))},
          refresh_token = null,
          refresh_lease_until_ms = null,
          updated_at = now()
      where singleton = true and refresh_token = ${input.token}::uuid
      returning next_retry_at_ms`;
    const nextRetryAt = asNumber(row?.next_retry_at_ms);
    return nextRetryAt == null ? null : { nextRetryAt };
  }

  return { read, acquire, activate, notModified, fail };
}
