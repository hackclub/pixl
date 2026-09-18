import { db } from "../db/pgCompat.js";

export interface CdnUploadQuotaOptions {
  readonly windowMs: number;
  readonly maxRequests: number;
  readonly maxBytes: number;
}

export const CDN_UPLOAD_QUOTA: CdnUploadQuotaOptions = {
  windowMs: 24 * 60 * 60 * 1000,
  maxRequests: 60,
  maxBytes: 100 * 1024 * 1024,
};

export type CdnQuotaResult =
  | { ok: true; windowId: number }
  | { ok: false; reason: "quota_exceeded"; retryAfterSeconds: number }
  | { ok: false; reason: "quota_unavailable" };

// row-locked in Postgres, fails closed on error
export async function reserveCdnUploadQuota(
  opts: CdnUploadQuotaOptions,
  userId: string,
  bytes: number,
): Promise<CdnQuotaResult> {
  const { data, error } = await db.rpc<{
    ok: boolean;
    retry_after_seconds?: number;
    window_id?: number;
  }>("reserve_cdn_upload_quota", {
    p_user_id: userId,
    p_bytes: bytes,
    p_max_requests: opts.maxRequests,
    p_max_bytes: opts.maxBytes,
    p_window_seconds: Math.round(opts.windowMs / 1000),
  });
  if (error || !data) {
    console.error("[cdnQuota] reserve failed", error);
    return { ok: false, reason: "quota_unavailable" };
  }
  if (!data.ok) {
    return { ok: false, reason: "quota_exceeded", retryAfterSeconds: data.retry_after_seconds ?? 60 };
  }
  return { ok: true, windowId: data.window_id ?? 0 };
}

// Tied to the exact window reserve returned - an integer, not the window's
// timestamp, since a timestamptz round-tripped through JSON -> JS -> a bind
// parameter can lose sub-millisecond precision and silently stop matching.
// A release against a window that already rolled over is a no-op, never a
// newer window's usage.
export async function releaseCdnUploadQuota(
  userId: string,
  bytes: number,
  windowId: number,
): Promise<void> {
  const { error } = await db.rpc("release_cdn_upload_quota", {
    p_user_id: userId,
    p_bytes: bytes,
    p_window_id: windowId,
  });
  if (error) console.error("[cdnQuota] release failed", error);
}
