import { createHash, timingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { auditRequestThrottled } from "../audit.js";

// Service-to-server authentication. Each caller has its own key, sent as
// `x-pixl-service-key`. There is no shared admin key and no query-string key.
export const SERVICE_KEY_HEADER = "x-pixl-service-key";

export type ServiceName = "pixl-dashboard" | "internal-dashboard" | "pixo";

export const SERVICE_KEY_ENV: Readonly<Record<ServiceName, string>> = Object.freeze({
  "pixl-dashboard": "SERVICE_KEY_PIXL_DASHBOARD",
  "internal-dashboard": "SERVICE_KEY_INTERNAL_DASHBOARD",
  pixo: "SERVICE_KEY_PIXO",
});

// A key shorter than this is treated as unset, so a placeholder like "x" in
// an env file can never authenticate anything.
export const MIN_SERVICE_KEY_LENGTH = 32;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

// Compares sha256 digests so timingSafeEqual always sees equal-length
// buffers and the key length never leaks through timing.
function keyMatches(given: string, expected: string | undefined): boolean {
  if (!expected || expected.length < MIN_SERVICE_KEY_LENGTH) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

// Which service a key belongs to, or null. Checks every configured key
// (no early exit) so the answer's timing doesn't say which one matched.
export function matchServiceKey(
  given: string,
  env: Record<string, string | undefined> = process.env,
): ServiceName | null {
  if (!given) return null;
  let found: ServiceName | null = null;
  for (const name of Object.keys(SERVICE_KEY_ENV) as ServiceName[]) {
    if (keyMatches(given, env[SERVICE_KEY_ENV[name]]) && found === null) found = name;
  }
  return found;
}

export function serviceKeyHeader(req: Request): string {
  const raw = req.headers[SERVICE_KEY_HEADER];
  return typeof raw === "string" ? raw.trim() : "";
}

// Authenticates the caller as one of `allowed`, sets req.service and moves
// on. A missing or unknown key is 401, a valid key for a service that isn't
// allowed here is 403; both write auth.service_key_rejected.
export function requireServiceKey(
  allowed: (req: Request) => readonly ServiceName[],
  env: Record<string, string | undefined> = process.env,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const given = serviceKeyHeader(req);
    const service = matchServiceKey(given, env);
    if (!service) {
      auditRequestThrottled(req, {
        action: "auth.service_key_rejected",
        target: req.method,
        result: "denied",
        meta: { reason: given ? "unknown_key" : "missing_key" },
      });
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    if (!allowed(req).includes(service)) {
      auditRequestThrottled(req, {
        action: "auth.service_key_rejected",
        actorType: "service",
        actorId: service,
        target: req.method,
        result: "denied",
        meta: { reason: "not_permitted" },
      });
      res.status(403).json({ ok: false, error: "forbidden" });
      return;
    }
    req.service = service;
    next();
  };
}

// /api/admin/* routes Pixo is allowed to call, as "METHOD /path" (path as
// mounted under /api/admin). Pixo calls none of them today; add a route here
// only when Pixo actually starts using it.
export const PIXO_ADMIN_ROUTES: ReadonlySet<string> = new Set<string>();

// Routes the player-facing dashboard is allowed to call with its own service
// key. Currently just the aggregate review-queue stats it renders on /queue.
export const PIXL_DASHBOARD_ADMIN_ROUTES: ReadonlySet<string> = new Set<string>(["GET /queue"]);

export function adminCallers(req: Request): readonly ServiceName[] {
  const route = `${req.method.toUpperCase()} ${req.path.toLowerCase().replace(/\/+$/, "")}`;
  const callers: ServiceName[] = ["internal-dashboard"];
  if (PIXL_DASHBOARD_ADMIN_ROUTES.has(route)) callers.push("pixl-dashboard");
  if (PIXO_ADMIN_ROUTES.has(route)) callers.push("pixo");
  return callers;
}

// Mounted with app.use("/api/admin", ...) so it shares Express's own
// (case-insensitive) path matching with the admin routes it protects.
export function adminServiceGate(env: Record<string, string | undefined> = process.env) {
  return requireServiceKey(adminCallers, env);
}
