import "server-only";
import { serverFetch } from "./server-api-core";

/**
 * Aggregate review-queue stats for the public /queue page. apps/server exposes
 * them only on the service-key-gated /api/admin/queue, so anonymous queue
 * clones cannot poll them; this app's key stays server-side.
 */
export async function publicQueueStats<T>(): Promise<T | null> {
  const serviceKey = process.env.SERVICE_KEY_PIXL_DASHBOARD;
  if (!serviceKey) {
    console.error("SERVICE_KEY_PIXL_DASHBOARD is not set - /queue cannot load");
    return null;
  }
  const r = await serverFetch<T>("/api/admin/queue", { serviceKey });
  return r.ok ? r.data : null;
}
