import crypto from "crypto";

// Proof-of-Slack-account-ownership for public, no-account forms (F-12).
// Knowing someone's Slack id is not proof you control that Slack account -
// this issues a short-lived, single-use, attempt-limited code that must be
// DMed back correctly before a submission naming that id is accepted.
// Pulled out of forms.ts as pure, DI-friendly state so it's testable without
// a real Postgres connection or real Slack calls.

export interface PendingCode {
  code: string;
  name: string;
  expiresAt: number;
  attempts: number;
  lastSentAt: number;
}

export interface VerificationStoreOptions {
  ttlMs?: number;
  resendCooldownMs?: number;
  maxAttempts?: number;
  now?: () => number;
  randomCode?: () => string;
}

export type VerifyResult = "ok" | "expired_or_missing" | "wrong_code" | "too_many_attempts";

function defaultRandomCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function createVerificationStore(opts: VerificationStoreOptions = {}) {
  const ttlMs = opts.ttlMs ?? 10 * 60_000;
  const resendCooldownMs = opts.resendCooldownMs ?? 60_000;
  const maxAttempts = opts.maxAttempts ?? 5;
  const now = opts.now ?? (() => Date.now());
  const randomCode = opts.randomCode ?? defaultRandomCode;

  const pending = new Map<string, PendingCode>();

  function sweep(): void {
    const t = now();
    for (const [k, v] of pending) if (v.expiresAt <= t) pending.delete(k);
  }

  const timer = setInterval(sweep, ttlMs);
  timer.unref?.();

  return {
    /**
     * Issues a new code for `key` unless one was already sent within the
     * resend cooldown, in which case this is a no-op. Returns the code only
     * when one was actually (re)issued, so the caller can decide whether to
     * send a DM - the caller must respond identically either way so this
     * can't be used to probe whether a code is already pending.
     */
    issue(key: string, name: string): string | null {
      const existing = pending.get(key);
      if (existing && now() - existing.lastSentAt < resendCooldownMs) return null;
      const code = randomCode();
      pending.set(key, { code, name, expiresAt: now() + ttlMs, attempts: 0, lastSentAt: now() });
      return code;
    },

    /** The cached display name for a still-pending code, if any. */
    peekName(key: string): string | null {
      return pending.get(key)?.name ?? null;
    },

    /**
     * Verifies `code` against the pending entry for `key`. Correct codes are
     * consumed (single use) on success. Wrong codes count against a capped
     * attempt budget; once exceeded the entry is discarded outright so a
     * fresh request-code is required.
     */
    verify(key: string, code: string): VerifyResult {
      const entry = pending.get(key);
      if (!entry || now() > entry.expiresAt) {
        pending.delete(key);
        return "expired_or_missing";
      }
      entry.attempts++;
      if (entry.attempts > maxAttempts) {
        pending.delete(key);
        return "too_many_attempts";
      }
      if (code !== entry.code) return "wrong_code";
      pending.delete(key);
      return "ok";
    },

    /** Test/shutdown helper - not used by the live route. */
    stopSweeping(): void {
      clearInterval(timer);
    },
  };
}
