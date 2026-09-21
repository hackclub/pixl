import type { Request, Response, NextFunction } from "express";
import { requestIpKey } from "./clientIp.js";

// fixed window, per IP
interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  readonly windowMs: number;
  readonly max: number;
  readonly name: string;
  readonly key?: (req: Request) => string;
}

export const RATE_LIMIT_MAX_BUCKETS = 100_000;
const FULL_SWEEP_MIN_GAP_MS = 1_000;
const EVICT_BATCH = RATE_LIMIT_MAX_BUCKETS / 10;

const buckets = new Map<string, Bucket>();
let lastFullSweepAt = 0;

export function sweepRateLimitBuckets(now = Date.now()): void {
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

export function rateLimitBucketCount(): number {
  return buckets.size;
}

setInterval(() => sweepRateLimitBuckets(), 60_000).unref();

function makeRoom(now: number): void {
  if (buckets.size < RATE_LIMIT_MAX_BUCKETS) return;
  if (now - lastFullSweepAt >= FULL_SWEEP_MIN_GAP_MS) {
    lastFullSweepAt = now;
    sweepRateLimitBuckets(now);
  }
  if (buckets.size < RATE_LIMIT_MAX_BUCKETS) return;
  let drop = EVICT_BATCH;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    if (--drop <= 0) break;
  }
}

export function peekRateLimit(opts: RateLimitOptions, key: string): number | null {
  const bucket = buckets.get(`${opts.name}:${key}`);
  const now = Date.now();
  if (!bucket || bucket.resetAt <= now || bucket.count < opts.max) return null;
  return Math.ceil((bucket.resetAt - now) / 1000);
}

export function consumeRateLimit(opts: RateLimitOptions, key: string): number | null {
  const bucketKey = `${opts.name}:${key}`;
  const now = Date.now();
  let bucket = buckets.get(bucketKey);
  if (!bucket || bucket.resetAt <= now) {
    makeRoom(now);
    bucket = { count: 0, resetAt: now + opts.windowMs };
    buckets.set(bucketKey, bucket);
  }
  bucket.count++;
  return bucket.count > opts.max ? Math.ceil((bucket.resetAt - now) / 1000) : null;
}

export function rateLimit(opts: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "OPTIONS") return next();
    const retryAfter = consumeRateLimit(opts, opts.key?.(req) ?? requestIpKey(req));
    if (retryAfter !== null) {
      res.setHeader("Retry-After", retryAfter);
      return res.status(429).json({ ok: false, error: "rate_limited" });
    }
    next();
  };
}
