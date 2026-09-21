import type { NextFunction, Request, Response } from "express";
import { supabase } from "../db/client.js";
import { sql } from "../db/pgCompat.js";
import { verifySessionToken } from "./session.js";

const UNDEFINED_COLUMN = "42703";
const REVOCATION_CACHE_TTL_MS = 10_000;
const REVOCATION_CACHE_MAX = 50_000;

export type RevocationLookup = { ok: true; revokedAtMs: number | null } | { ok: false };
export type RevocationReader = (userId: string) => Promise<RevocationLookup>;
export type RevokeResult = "revoked" | "not_found" | "not_migrated" | "error";

export function isSessionRevoked(session: { iat: number }, revokedAtMs: number | null): boolean {
  return revokedAtMs !== null && session.iat <= Math.floor(revokedAtMs / 1000);
}

export function parseRevokedAt(raw: unknown): RevocationLookup {
  if (raw === null || raw === undefined) return { ok: true, revokedAtMs: null };
  const ms = new Date(raw as string | Date).getTime();
  return Number.isNaN(ms) ? { ok: false } : { ok: true, revokedAtMs: ms };
}

export async function lookupSessionRevokedAt(userId: string): Promise<RevocationLookup> {
  const { data, error } = await supabase
    .from("users")
    .select("sessions_revoked_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    if (error.code === UNDEFINED_COLUMN) return { ok: true, revokedAtMs: null };
    console.error("Failed to check session revocation", error.message);
    return { ok: false };
  }
  return parseRevokedAt((data as { sessions_revoked_at?: unknown } | null)?.sessions_revoked_at);
}

export async function revokeUserSessions(userId: string, nowMs = Date.now()): Promise<RevokeResult> {
  const at = new Date(nowMs).toISOString();
  try {
    const rows = await sql.unsafe(
      `update users
       set sessions_revoked_at = greatest(coalesce(sessions_revoked_at, $1::timestamptz), $1::timestamptz)
       where id = $2::uuid
       returning id`,
      [at, userId],
    );
    return rows.length > 0 ? "revoked" : "not_found";
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === UNDEFINED_COLUMN) return "not_migrated";
    console.error("Failed to revoke sessions", (err as Error).message);
    return "error";
  }
}

export function createRevocationCache(
  lookup: RevocationReader,
  ttlMs = REVOCATION_CACHE_TTL_MS,
  now: () => number = Date.now,
  maxEntries = REVOCATION_CACHE_MAX,
) {
  const cache = new Map<string, { revokedAtMs: number | null; at: number }>();

  async function get(userId: string): Promise<RevocationLookup> {
    const cached = cache.get(userId);
    if (cached && now() - cached.at < ttlMs) return { ok: true, revokedAtMs: cached.revokedAtMs };
    let fresh: RevocationLookup;
    try {
      fresh = await lookup(userId);
    } catch {
      return { ok: false };
    }
    if (!fresh.ok) return fresh;
    if (cache.size >= maxEntries) {
      for (const [id, entry] of cache) if (now() - entry.at >= ttlMs) cache.delete(id);
      for (const id of cache.keys()) {
        if (cache.size < maxEntries) break;
        cache.delete(id);
      }
    }
    cache.set(userId, { revokedAtMs: fresh.revokedAtMs, at: now() });
    return fresh;
  }

  return { get, forget: (userId: string) => void cache.delete(userId), size: () => cache.size };
}

const sharedCache = createRevocationCache(lookupSessionRevokedAt);

export const forgetCachedRevocation = sharedCache.forget;

export interface EnforceSessionRevocationDeps {
  revokedAt?: RevocationReader;
  verify?: (token: string) => ReturnType<typeof verifySessionToken>;
}

export function enforceSessionRevocation(deps: EnforceSessionRevocationDeps = {}) {
  const revokedAt = deps.revokedAt ?? sharedCache.get;
  const verify = deps.verify ?? verifySessionToken;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) return next();
    const session = verify(token);
    if (!session) return next();
    let state: RevocationLookup;
    try {
      state = await revokedAt(session.userId);
    } catch {
      state = { ok: false };
    }
    if (!state.ok) {
      res.setHeader("Retry-After", "5");
      res.status(503).json({ ok: false, error: "session_check_unavailable" });
      return;
    }
    if (isSessionRevoked(session, state.revokedAtMs)) {
      res.status(401).json({ ok: false, error: "session_revoked" });
      return;
    }
    next();
  };
}
