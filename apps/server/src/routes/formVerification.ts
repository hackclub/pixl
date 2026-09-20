import crypto from "crypto";
import { sql } from "../db/pgCompat.js";

export type VerifyResult = "ok" | "expired_or_missing" | "wrong_code" | "too_many_attempts";

export type QueryFn = (text: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

export interface VerificationStoreOptions {
  ttlMs?: number;
  resendCooldownMs?: number;
  maxAttempts?: number;
  sendWindowMs?: number;
  maxSendsPerWindow?: number;
  now?: () => number;
  randomCode?: () => string;
  query?: QueryFn;
  secret?: string;
  sweepIntervalMs?: number;
}

const defaultQuery: QueryFn = async (text, params) =>
  (await sql.unsafe(text, params as never[])) as unknown as Record<string, unknown>[];

function defaultRandomCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function createVerificationStore(opts: VerificationStoreOptions = {}) {
  const ttlMs = opts.ttlMs ?? 10 * 60_000;
  const resendCooldownMs = opts.resendCooldownMs ?? 60_000;
  const maxAttempts = opts.maxAttempts ?? 5;
  const sendWindowMs = opts.sendWindowMs ?? 24 * 60 * 60_000;
  const maxSendsPerWindow = opts.maxSendsPerWindow ?? 10;
  const now = opts.now ?? (() => Date.now());
  const randomCode = opts.randomCode ?? defaultRandomCode;
  const query = opts.query ?? defaultQuery;

  function hashCode(key: string, code: string): string {
    const secret = opts.secret ?? process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET is not set");
    return crypto.createHmac("sha256", secret).update(`form-code:${key}:${code}`).digest("hex");
  }

  const at = (ms: number) => new Date(ms).toISOString();

  async function sweep(): Promise<void> {
    try {
      await query("delete from form_verifications where window_started_at <= $1::timestamptz", [
        at(now() - 2 * sendWindowMs),
      ]);
    } catch (err) {
      console.error("[forms] verification sweep failed", (err as Error).message);
    }
  }

  const timer = setInterval(() => void sweep(), opts.sweepIntervalMs ?? 60 * 60_000);
  timer.unref?.();

  return {
    async issue(key: string, name: string): Promise<string | null> {
      const code = randomCode();
      const t = now();
      const rows = await query(
        `insert into form_verifications as fv
           (key, code_hash, name, expires_at, attempts, last_sent_at, window_started_at, sends_in_window)
         values ($1, $2, $3, $4::timestamptz, 0, $5::timestamptz, $5::timestamptz, 1)
         on conflict (key) do update set
           code_hash = excluded.code_hash,
           name = excluded.name,
           expires_at = excluded.expires_at,
           attempts = 0,
           last_sent_at = excluded.last_sent_at,
           window_started_at = case when fv.window_started_at <= $6::timestamptz
             then excluded.window_started_at else fv.window_started_at end,
           sends_in_window = case when fv.window_started_at <= $6::timestamptz
             then 1 else fv.sends_in_window + 1 end
         where fv.last_sent_at <= $7::timestamptz
           and (fv.window_started_at <= $6::timestamptz or fv.sends_in_window < $8::int)
         returning key`,
        [key, hashCode(key, code), name, at(t + ttlMs), at(t), at(t - sendWindowMs), at(t - resendCooldownMs), maxSendsPerWindow],
      );
      return rows.length > 0 ? code : null;
    },

    async peekName(key: string): Promise<string | null> {
      const rows = await query(
        "select name from form_verifications where key = $1 and code_hash is not null and expires_at > $2::timestamptz",
        [key, at(now())],
      );
      return rows.length > 0 ? String(rows[0].name) : null;
    },

    async verify(key: string, code: string): Promise<VerifyResult> {
      const rows = await query(
        `update form_verifications set attempts = attempts + 1
         where key = $1 and code_hash is not null and expires_at > $2::timestamptz
         returning code_hash, attempts`,
        [key, at(now())],
      );
      if (rows.length === 0) return "expired_or_missing";
      const stored = String(rows[0].code_hash);
      const attempts = Number(rows[0].attempts);
      if (attempts > maxAttempts) {
        await query("update form_verifications set code_hash = null, name = '' where key = $1", [key]);
        return "too_many_attempts";
      }
      const given = Buffer.from(hashCode(key, code), "hex");
      const expected = Buffer.from(stored, "hex");
      if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return "wrong_code";
      const consumed = await query(
        "update form_verifications set code_hash = null, name = '' where key = $1 and code_hash = $2 returning key",
        [key, stored],
      );
      return consumed.length > 0 ? "ok" : "expired_or_missing";
    },

    stopSweeping(): void {
      clearInterval(timer);
    },
  };
}
