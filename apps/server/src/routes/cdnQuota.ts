interface QuotaBucket {
  requests: number;
  bytes: number;
  resetAt: number;
}

export interface CdnUploadQuotaOptions {
  readonly windowMs: number;
  readonly maxRequests: number;
  readonly maxBytes: number;
  readonly name: string;
}

export const CDN_UPLOAD_QUOTA: CdnUploadQuotaOptions = {
  windowMs: 24 * 60 * 60 * 1000,
  maxRequests: 60,
  maxBytes: 100 * 1024 * 1024,
  name: "cdn_upload",
};

const quotaBuckets = new Map<string, QuotaBucket>();

setInterval(
  () => {
    const now = Date.now();
    for (const [k, b] of quotaBuckets) if (b.resetAt <= now) quotaBuckets.delete(k);
  },
  60_000,
).unref();

function bucketFor(opts: CdnUploadQuotaOptions, userId: string): QuotaBucket {
  const key = `${opts.name}:${userId}`;
  const now = Date.now();
  let bucket = quotaBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { requests: 0, bytes: 0, resetAt: now + opts.windowMs };
    quotaBuckets.set(key, bucket);
  }
  return bucket;
}

export type CdnQuotaResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export function reserveCdnUploadQuota(
  opts: CdnUploadQuotaOptions,
  userId: string,
  bytes: number,
): CdnQuotaResult {
  const bucket = bucketFor(opts, userId);
  if (bucket.requests + 1 > opts.maxRequests || bucket.bytes + bytes > opts.maxBytes) {
    return { ok: false, retryAfterSeconds: Math.ceil((bucket.resetAt - Date.now()) / 1000) };
  }
  bucket.requests++;
  bucket.bytes += bytes;
  return { ok: true };
}

export function releaseCdnUploadQuota(
  opts: CdnUploadQuotaOptions,
  userId: string,
  bytes: number,
): void {
  const bucket = quotaBuckets.get(`${opts.name}:${userId}`);
  if (!bucket) return;
  bucket.requests = Math.max(0, bucket.requests - 1);
  bucket.bytes = Math.max(0, bucket.bytes - bytes);
}
