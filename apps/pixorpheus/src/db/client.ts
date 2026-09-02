import { db as pg } from "./pgCompat.js";

export function db() {
  return pg;
}

/**
 * Slack timestamps must be strings. If a DB column ever returns them as
 * numbers (wrong column type in Supabase), buttons get a numeric `value`
 * (invalid_blocks, the ticket-channel forward silently fails) and
 * thread_ts becomes a float Slack can't match. Coerce at every DB read.
 */
export function tsStr(v: unknown): string | null {
  return v == null ? null : String(v);
}
