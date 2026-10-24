import { randomUUID } from "node:crypto";
import {
  createShipsSnapshotStore,
  SHIPS_REFRESH_LEASE_MS,
  type ShipsSnapshotStore,
  type StoredShipsSnapshot,
  type StoredShipsState,
} from "./shipsSnapshotStore";

// Ships defaults to only three months unless all=true; fulfillment needs full historical records.
export const SHIPS_URL = "https://api.ships.hackclub.com/api/v1/ysws_entries?all=true&boba=false";

const RECORD_ID = /^rec[A-Za-z0-9]{14}$/;
const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 60 * 60_000;
const DEFAULT_TTL_MS = 5 * 60_000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 15 * 60_000;
const SHRINK_GUARD = 0.5;
const MAX_INVALID_RATIO = 0.1;

export interface ShipsEntry {
  id: string;
  approvedAt: number | null;
  hours: number;
  codeUrl: string;
  repoKey: string | null;
  githubUsername: string;
  slackId: string | null;
}

export interface ShipsSnapshot {
  fetchedAt: number;
  byId: Map<string, ShipsEntry>;
  ambiguousIds: Set<string>;
  invalidIds: Set<string>;
  byRepo: Map<string, ShipsEntry[]>;
  byGithub: Map<string, ShipsEntry[]>;
  totalReturned: number;
  pixlCount: number;
  invalidCount: number;
  duplicateCount: number;
  bytes: number;
}

export interface ShipsView {
  snapshot: ShipsSnapshot | null;
  fetchedAt: number | null;
  ageMs: number | null;
  fresh: boolean;
  error: string | null;
  lastAttemptAt: number | null;
  nextRetryAt: number | null;
}

export interface ShipsProviderOptions {
  url?: string;
  ttlMs?: number;
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface PersistentShipsProviderOptions extends ShipsProviderOptions {
  store?: ShipsSnapshotStore;
}

export type ShipsRefreshOutcome = "refreshed" | "not_modified" | "skipped_fresh" | "skipped_busy" | "skipped_backoff" | "failed";

export interface ShipsRefreshResult {
  outcome: ShipsRefreshOutcome;
  view: ShipsView;
  error: string | null;
}

export interface ShipsProvider {
  get(): Promise<ShipsView>;
  refresh(force?: boolean): Promise<void>;
  view(): ShipsView;
  ttlMs: number;
}

export function repoKeyOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    const parts = u.pathname.replace(/\.git$/i, "").split("/").filter(Boolean).slice(0, 2);
    return parts.length === 2 ? `${u.hostname.toLowerCase()}/${parts.join("/").toLowerCase()}` : null;
  } catch {
    return null;
  }
}

export function normalizeGithub(name: string | null | undefined): string | null {
  const n = (name ?? "").trim().toLowerCase().replace(/^@/, "");
  return n && n !== "null" ? n : null;
}

interface ParsedEntry {
  entry: ShipsEntry | null;
  rawId: string | null;
}

function parseEntry(raw: unknown): ParsedEntry {
  if (!raw || typeof raw !== "object") return { entry: null, rawId: null };
  const r = raw as Record<string, unknown>;
  const rawId = typeof r.id === "string" ? r.id : null;
  const hours = r.hours;
  const approved = r.approved_at;
  const slack = typeof r.slack_id === "string" ? r.slack_id.trim() : "";
  const bad =
    !rawId ||
    !RECORD_ID.test(rawId) ||
    typeof hours !== "number" ||
    !Number.isFinite(hours) ||
    hours < 0 ||
    !(approved === null || approved === undefined || (typeof approved === "number" && Number.isFinite(approved) && approved >= 0)) ||
    typeof r.code_url !== "string" ||
    typeof r.github_username !== "string";
  if (bad) return { entry: null, rawId };
  return {
    rawId,
    entry: {
      id: rawId,
      approvedAt: typeof approved === "number" && approved > 0 ? approved : null,
      hours,
      codeUrl: r.code_url as string,
      repoKey: repoKeyOf(r.code_url as string),
      githubUsername: (r.github_username as string).trim(),
      slackId: slack && slack !== "null" ? slack : null,
    },
  };
}

export function buildSnapshot(data: unknown, fetchedAt: number, bytes = 0): ShipsSnapshot {
  if (!Array.isArray(data)) throw new Error("Ships response is not a JSON array");
  const byId = new Map<string, ShipsEntry>();
  const ambiguousIds = new Set<string>();
  const invalidIds = new Set<string>();
  const seen = new Set<string>();
  let pixlCount = 0;
  let invalidCount = 0;
  let duplicateCount = 0;
  for (const raw of data) {
    const ysws = (raw as { ysws?: unknown } | null)?.ysws;
    if (typeof ysws !== "string" || ysws.trim().toLowerCase() !== "pixl") continue;
    pixlCount++;
    const { entry, rawId } = parseEntry(raw);
    if (!entry) {
      invalidCount++;
      if (rawId) invalidIds.add(rawId);
      continue;
    }
    if (seen.has(entry.id)) {
      duplicateCount++;
      ambiguousIds.add(entry.id);
      continue;
    }
    seen.add(entry.id);
    byId.set(entry.id, entry);
  }
  for (const id of ambiguousIds) byId.delete(id);
  const byRepo = new Map<string, ShipsEntry[]>();
  const byGithub = new Map<string, ShipsEntry[]>();
  for (const e of byId.values()) {
    if (e.repoKey) byRepo.set(e.repoKey, [...(byRepo.get(e.repoKey) ?? []), e]);
    const g = normalizeGithub(e.githubUsername);
    if (g) byGithub.set(g, [...(byGithub.get(g) ?? []), e]);
  }
  return {
    fetchedAt,
    byId,
    ambiguousIds,
    invalidIds,
    byRepo,
    byGithub,
    totalReturned: data.length,
    pixlCount,
    invalidCount,
    duplicateCount,
    bytes,
  };
}

function validateSnapshotResponse(data: unknown, next: ShipsSnapshot, previous: ShipsSnapshot | null): void {
  if (!Array.isArray(data)) throw new Error("Ships response is not a JSON array");
  if (data.length === 0) throw new Error("Ships response was empty; keeping the previous snapshot");
  for (const raw of data) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof (raw as Record<string, unknown>).ysws !== "string") {
      throw new Error("Ships response contained a malformed archive record; keeping the previous snapshot");
    }
  }
  if (next.pixlCount === 0 || next.byId.size === 0) {
    throw new Error("Ships response contained no valid PIXL records; keeping the previous snapshot");
  }
  if (next.invalidCount / next.pixlCount > MAX_INVALID_RATIO) {
    throw new Error(`Ships response had too many malformed PIXL records (${next.invalidCount}/${next.pixlCount}); keeping the previous snapshot`);
  }
  if (previous && next.totalReturned < previous.totalReturned * SHRINK_GUARD) {
    throw new Error(`Ships dataset shrank from ${previous.totalReturned} to ${next.totalReturned} entries; keeping the previous snapshot`);
  }
  if (previous && next.pixlCount < previous.pixlCount * SHRINK_GUARD) {
    throw new Error(`PIXL Ships records shrank from ${previous.pixlCount} to ${next.pixlCount}; keeping the previous snapshot`);
  }
}

function snapshotFromStored(stored: StoredShipsSnapshot): ShipsSnapshot {
  const entries = stored.entries.map((entry) => ({ ...entry, repoKey: repoKeyOf(entry.codeUrl) }));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const byRepo = new Map<string, ShipsEntry[]>();
  const byGithub = new Map<string, ShipsEntry[]>();
  for (const entry of entries) {
    if (entry.repoKey) byRepo.set(entry.repoKey, [...(byRepo.get(entry.repoKey) ?? []), entry]);
    const github = normalizeGithub(entry.githubUsername);
    if (github) byGithub.set(github, [...(byGithub.get(github) ?? []), entry]);
  }
  return {
    fetchedAt: stored.fetchedAt,
    byId,
    byRepo,
    byGithub,
    invalidIds: new Set(stored.invalidIds),
    ambiguousIds: new Set(stored.ambiguousIds),
    totalReturned: stored.totalReturned,
    pixlCount: stored.pixlCount,
    invalidCount: stored.invalidCount,
    duplicateCount: stored.duplicateCount,
    bytes: stored.bytes,
  };
}

function emptyStoredState(): StoredShipsState {
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

async function readBody(res: Response, maxBytes: number): Promise<{ text: string; bytes: number }> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`Ships response too large (${declared} bytes)`);
  if (!res.body) throw new Error("Ships response had no body");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error("Ships response exceeded the size limit");
    }
    chunks.push(value);
  }
  if (Number.isFinite(declared) && declared > 0 && bytes < declared) {
    throw new Error(`Ships response truncated (${bytes} of ${declared} bytes)`);
  }
  const buf = new Uint8Array(bytes);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.byteLength;
  }
  return { text: new TextDecoder().decode(buf), bytes };
}

function clampTtl(ms: number): number {
  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, ms));
}

export function ttlFromEnv(raw: string | undefined): number {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? clampTtl(n) : DEFAULT_TTL_MS;
}

export function createShipsProvider(opts: ShipsProviderOptions = {}) {
  const url = opts.url ?? SHIPS_URL;
  const ttlMs = clampTtl(opts.ttlMs ?? DEFAULT_TTL_MS);
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const maxBytes = opts.maxBytes ?? 64 * 1024 * 1024;
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;

  let snapshot: ShipsSnapshot | null = null;
  let etag: string | null = null;
  let error: string | null = null;
  let lastAttemptAt: number | null = null;
  let nextRetryAt: number | null = null;
  let failures = 0;
  let inflight: Promise<void> | null = null;

  async function fetchOnce(): Promise<void> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (etag && snapshot) headers["If-None-Match"] = etag;
      const res = await doFetch(url, { method: "GET", headers, signal: ctl.signal, redirect: "error" });
      if (res.status === 304 && snapshot) {
        snapshot = { ...snapshot, fetchedAt: now() };
        return;
      }
      if (!res.ok) throw new Error(`Ships returned HTTP ${res.status}`);
      const { text, bytes } = await readBody(res, maxBytes);
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Ships response was not valid JSON");
      }
      const next = buildSnapshot(data, now(), bytes);
      validateSnapshotResponse(data, next, snapshot);
      snapshot = next;
      etag = res.headers.get("etag");
    } catch (e) {
      const err = e as Error;
      throw new Error(err.name === "AbortError" ? `Ships request timed out after ${timeoutMs}ms` : err.message);
    } finally {
      clearTimeout(timer);
    }
  }

  function refresh(force = false): Promise<void> {
    if (inflight) return inflight;
    const t = now();
    if (!force && nextRetryAt != null && t < nextRetryAt) return Promise.resolve();
    lastAttemptAt = t;
    inflight = fetchOnce()
      .then(() => {
        error = null;
        failures = 0;
        nextRetryAt = null;
      })
      .catch((e: Error) => {
        error = e.message;
        failures++;
        nextRetryAt = now() + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1));
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  function view(): ShipsView {
    const t = now();
    const fetchedAt = snapshot?.fetchedAt ?? null;
    const ageMs = fetchedAt == null ? null : Math.max(0, t - fetchedAt);
    return {
      snapshot,
      fetchedAt,
      ageMs,
      fresh: ageMs != null && ageMs < ttlMs && error === null,
      error,
      lastAttemptAt,
      nextRetryAt,
    };
  }

  async function get(): Promise<ShipsView> {
    const v = view();
    if (!v.snapshot || (v.ageMs ?? 0) >= ttlMs) await refresh(false);
    return view();
  }

  function reset(): void {
    snapshot = null;
    etag = null;
    error = null;
    lastAttemptAt = null;
    nextRetryAt = null;
    failures = 0;
    inflight = null;
  }

  return { get, refresh, view, reset, ttlMs };
}

export function createPersistentShipsProvider(opts: PersistentShipsProviderOptions = {}) {
  const url = opts.url ?? SHIPS_URL;
  const ttlMs = clampTtl(opts.ttlMs ?? DEFAULT_TTL_MS);
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const maxBytes = opts.maxBytes ?? 64 * 1024 * 1024;
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const store = opts.store ?? createShipsSnapshotStore();

  let state = emptyStoredState();
  let cachedSnapshot: ShipsSnapshot | null = null;
  let localError: string | null = null;
  let inflight: Promise<ShipsRefreshResult> | null = null;

  async function reload(): Promise<void> {
    try {
      state = await store.read();
      cachedSnapshot = state.snapshot ? snapshotFromStored(state.snapshot) : null;
      localError = null;
    } catch (e) {
      localError = `Ships snapshot storage unavailable: ${(e as Error).message}`;
    }
  }

  function view(): ShipsView {
    const fetchedAt = cachedSnapshot?.fetchedAt ?? null;
    const ageMs = fetchedAt == null ? null : Math.max(0, now() - fetchedAt);
    const error = localError ?? state.error;
    return {
      snapshot: cachedSnapshot,
      fetchedAt,
      ageMs,
      fresh: ageMs != null && ageMs < ttlMs && error === null,
      error,
      lastAttemptAt: state.lastAttemptAt,
      nextRetryAt: state.nextRetryAt,
    };
  }

  async function get(): Promise<ShipsView> {
    await reload();
    return view();
  }

  async function refreshDetailed(force = false): Promise<ShipsRefreshResult> {
    if (inflight) return inflight;
    const token = randomUUID();
    const startedAt = now();
    const current = (async (): Promise<ShipsRefreshResult> => {
      try {
        const acquired = await store.acquire({
          token,
          now: startedAt,
          ttlMs,
          leaseMs: SHIPS_REFRESH_LEASE_MS,
          force,
        });
        if (!acquired.acquired) {
          await reload();
          const outcome: ShipsRefreshOutcome =
            acquired.reason === "fresh" ? "skipped_fresh" : acquired.reason === "busy" ? "skipped_busy" : "skipped_backoff";
          return { outcome, view: view(), error: view().error };
        }

        try {
          const before = await store.read();
          const previous = before.snapshot ? snapshotFromStored(before.snapshot) : null;
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), timeoutMs);
          try {
            const headers: Record<string, string> = { Accept: "application/json" };
            if (before.snapshot?.etag) headers["If-None-Match"] = before.snapshot.etag;
            const response = await doFetch(url, {
              method: "GET",
              headers,
              signal: ctl.signal,
              redirect: "error",
            });
            if (response.status === 304) {
              if (!before.snapshot) throw new Error("Ships returned 304 without an active snapshot");
              await store.notModified({
                token,
                fetchedAt: now(),
                etag: response.headers.get("etag"),
                durationMs: now() - startedAt,
              });
              await reload();
              return { outcome: "not_modified", view: view(), error: null };
            }
            if (!response.ok) throw new Error(`Ships returned HTTP ${response.status}`);
            const { text, bytes } = await readBody(response, maxBytes);
            let data: unknown;
            try {
              data = JSON.parse(text);
            } catch {
              throw new Error("Ships response was not valid JSON");
            }
            const next = buildSnapshot(data, now(), bytes);
            validateSnapshotResponse(data, next, previous);
            await store.activate({
              token,
              snapshot: next,
              etag: response.headers.get("etag"),
              durationMs: now() - startedAt,
            });
            await reload();
            return { outcome: "refreshed", view: view(), error: null };
          } catch (e) {
            const error = e as Error;
            throw new Error(error.name === "AbortError" ? `Ships request timed out after ${timeoutMs}ms` : error.message);
          } finally {
            clearTimeout(timer);
          }
        } catch (e) {
          const error = (e as Error).message;
          let diagnosticError: string | null = null;
          try {
            await store.fail({ token, now: now(), error, durationMs: now() - startedAt });
          } catch (recordError) {
            diagnosticError = `${error}; unable to persist Ships refresh diagnostics: ${(recordError as Error).message}`;
          }
          await reload();
          // A storage error during fail() should remain visible even if the
          // following read succeeds and returns the previous diagnostic state.
          if (diagnosticError) localError = diagnosticError;
          return { outcome: "failed", view: view(), error: view().error ?? error };
        }
      } catch (e) {
        const error = (e as Error).message;
        await reload();
        localError = error;
        return { outcome: "failed", view: view(), error: view().error };
      }
    })().finally(() => {
      inflight = null;
    });
    inflight = current;
    return current;
  }

  async function refresh(force = false): Promise<void> {
    await refreshDetailed(force);
  }

  async function reset(): Promise<void> {
    state = emptyStoredState();
    cachedSnapshot = null;
    localError = null;
    inflight = null;
  }

  return { get, refresh, refreshDetailed, view, reset, ttlMs };
}

export function shipsUrlFromEnv(raw: string | undefined): string {
  if (!raw) return SHIPS_URL;
  try {
    const u = new URL(raw);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol === "https:" || (u.protocol === "http:" && local)) {
      // A production override must not accidentally fall back to Ships' three-month view.
      if (
        (u.hostname === "ships.hackclub.com" || u.hostname === "api.ships.hackclub.com") &&
        u.pathname === "/api/v1/ysws_entries"
      ) {
        u.searchParams.set("all", "true");
        u.searchParams.set("boba", "false");
      }
      return u.toString();
    }
  } catch {
    // fall through
  }
  console.error("SHIPS_API_URL ignored: must be https, or http on localhost");
  return SHIPS_URL;
}

// The reader only switches to DB-backed evidence after the schema is migrated
// and a first complete snapshot exists. Until explicitly enabled, the legacy
// provider remains available so a code deploy cannot interrupt fulfillment.
export function shipsSnapshotReaderEnabled(raw: string | undefined): boolean {
  return raw === "true";
}

let persistentShared: ReturnType<typeof createPersistentShipsProvider> | null = null;
let legacyShared: ReturnType<typeof createShipsProvider> | null = null;

function persistentShipsProvider(): ReturnType<typeof createPersistentShipsProvider> {
  if (!persistentShared)
    persistentShared = createPersistentShipsProvider({
      url: shipsUrlFromEnv(process.env.SHIPS_API_URL),
      ttlMs: ttlFromEnv(process.env.SHIPS_CACHE_TTL_MS),
    });
  return persistentShared;
}

export function shipsProvider(): ShipsProvider {
  if (shipsSnapshotReaderEnabled(process.env.SHIPS_SNAPSHOT_READER_ENABLED)) return persistentShipsProvider();
  if (!legacyShared)
    legacyShared = createShipsProvider({
      url: shipsUrlFromEnv(process.env.SHIPS_API_URL),
      ttlMs: ttlFromEnv(process.env.SHIPS_CACHE_TTL_MS),
    });
  return legacyShared;
}

export async function refreshShipsSnapshotForJob(): Promise<ShipsRefreshResult> {
  // Always populate the durable snapshot, even while the reader flag is off.
  return persistentShipsProvider().refreshDetailed(false);
}

const REFRESH_COOLDOWN_MS = 60_000;
const lastManual = new Map<string, number>();

export type ManualRefresh =
  | { ok: true; view: ShipsView }
  | { ok: false; reason: "rate_limited"; retryInMs: number }
  | { ok: false; reason: "failed"; error: string };

export async function manualShipsRefresh(
  actor: string,
  provider: ShipsProvider = shipsProvider(),
  now: number = Date.now(),
): Promise<ManualRefresh> {
  const last = Math.max(lastManual.get(actor) ?? 0, lastManual.get("*") ?? 0);
  if (now - last < REFRESH_COOLDOWN_MS) return { ok: false, reason: "rate_limited", retryInMs: REFRESH_COOLDOWN_MS - (now - last) };
  lastManual.set(actor, now);
  lastManual.set("*", now);
  await provider.refresh(true);
  const view = provider.view();
  if (view.error) return { ok: false, reason: "failed", error: view.error };
  return { ok: true, view };
}

export function resetManualRefreshLimits(): void {
  lastManual.clear();
}
