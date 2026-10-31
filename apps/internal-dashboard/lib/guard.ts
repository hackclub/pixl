import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getSession } from "./session";
import { getAccessFacts } from "./db";
import { audit } from "./audit";
import { errorCode, fieldNamesFromArgs, isNavigationSignal, targetFromArgs } from "./auditTarget";
import { csrfRejection, type CsrfOptions } from "./requestGuards";
import {
  describeRequirement,
  idsFromEnv,
  resolveAccess,
  satisfies,
  type AdminAccess,
  type Requirement,
} from "./roles";

// Every guard on the internal dashboard lives in this file. Role rules are in
// lib/roles.ts; this wires them to the session cookie, the DB and the audit log.
//
// - Pages:       const access = await requirePage("reviewer");
// - Actions:     export const foo = guardedAction("foo", "owner", async (access, formData) => {...});
// - API routes:  export const GET = guardedRoute("api.foo", "helper", async (access, req) => {...});

export * from "./roles";

export function ownerSlackIds(): string[] {
  return idsFromEnv(process.env.ADMIN_SLACK_IDS);
}

export function secondPassSlackIds(): string[] {
  return idsFromEnv(process.env.SECOND_PASS_SLACK_IDS);
}

// Role lookup for a session (login gate, and getAccess below).
export async function accessFor(session: { slackId: string; name: string; exp: number }): Promise<AdminAccess | null> {
  const facts = await getAccessFacts(session.slackId);
  return resolveAccess(session, {
    ownerIds: ownerSlackIds(),
    secondPassIds: secondPassSlackIds(),
    adminPermissions: facts.permissions,
    isHelper: facts.isHelper,
    isFulfiller: facts.isFulfiller,
  });
}

// Once per request (React cache), however many components ask.
export const getAccess = cache(async (): Promise<AdminAccess | null> => {
  const session = await getSession();
  if (!session) return null;
  return accessFor(session);
});

export function can(access: AdminAccess | null | undefined, req: Requirement): boolean {
  return !!access && satisfies(access, req);
}

async function pathname(): Promise<string | null> {
  try {
    return (await headers()).get("x-pixl-pathname");
  } catch {
    return null;
  }
}

// One page.view row per request, even if several components call a guard.
const logPageView = cache(async (slackId: string | null, result: "ok" | "denied", required: string) => {
  await audit({ action: "page.view", result, slackId, target: await pathname(), meta: { required } });
});

// Where someone lands when they open a page they can't see.
export function landingFor(access: AdminAccess): string {
  if (access.isOwner) return "/";
  if (access.isReviewer) return "/review";
  if (access.isHelper) return "/tickets";
  if (access.isFulfiller) return "/fulfillment";
  if (access.canFraudReview) return "/review/fraud-reviews";
  return "/removed";
}

// Page gate. Not signed in -> /login; signed in but no role (removed from the
// team) -> /removed; has a role but not this one -> their own landing page.
export async function requirePage(req: Requirement = "staff"): Promise<AdminAccess> {
  const access = await getAccess();
  if (access && satisfies(access, req)) {
    await logPageView(access.session.slackId, "ok", describeRequirement(req));
    return access;
  }
  const session = await getSession();
  await logPageView(session?.slackId ?? null, "denied", describeRequirement(req));
  if (!session) redirect("/login");
  redirect(access ? landingFor(access) : "/removed");
}

// First-time gate for the review queue: a reviewer must have acknowledged the
// current YSWS guidelines version before any /review/* page renders. Call right
// after requirePage("reviewer") in each review page - but NOT on the
// guidelines page itself, or it would redirect to itself forever.
export async function requireGuidelinesAck(access: AdminAccess): Promise<void> {
  const { getGuidelinesAck } = await import("./db");
  const { GUIDELINES_VERSION } = await import("./guidelines");
  const acked = await getGuidelinesAck(access.session.slackId);
  if (acked === null || acked < GUIDELINES_VERSION) redirect("/review/guidelines");
}

// Wraps every exported server action. Checks the role, runs the action, and
// writes one audit_log row: ok (incl. a redirect()), denied, or error.
// Denied throws, same as the old requirePerm did.
export function guardedAction<A extends unknown[], R>(
  name: string,
  req: Requirement,
  fn: (access: AdminAccess, ...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    const target = targetFromArgs(args);
    const fields = fieldNamesFromArgs(args);
    const access = await getAccess();
    if (!access || !satisfies(access, req)) {
      const session = await getSession();
      await audit({
        action: name,
        result: "denied",
        slackId: session?.slackId ?? null,
        target,
        meta: { required: describeRequirement(req), fields },
      });
      throw new Error(session ? `You need the ${describeRequirement(req)} role for that.` : "Not signed in");
    }
    const slackId = access.session.slackId;
    try {
      const out = await fn(access, ...args);
      await audit({ action: name, result: "ok", slackId, target, meta: { fields } });
      return out;
    } catch (e) {
      const ok = isNavigationSignal(e);
      await audit({
        action: name,
        result: ok ? "ok" : "error",
        slackId,
        target,
        meta: ok ? { fields } : { fields, error: errorCode(e) },
      });
      throw e;
    }
  };
}

// Same contract for app/api/* route handlers. Denied -> 401/403 JSON.
// Non-GET requests must come from our own origin (CSRF, see
// lib/requestGuards.ts); pass { requireJson: true } when the handler parses a
// JSON body.
export function guardedRoute<C = unknown>(
  name: string,
  req: Requirement,
  fn: (access: AdminAccess, request: Request, ctx: C) => Promise<Response>,
  opts: CsrfOptions = {},
): (request: Request, ctx: C) => Promise<Response> {
  return async (request: Request, ctx: C): Promise<Response> => {
    const target = new URL(request.url).pathname;
    const csrf = csrfRejection(request.method, (n) => request.headers.get(n), process.env.BASE_URL, opts);
    if (csrf) {
      const session = await getSession();
      await audit(
        { action: name, result: "denied", slackId: session?.slackId ?? null, target, meta: { csrf } },
        request,
      );
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const access = await getAccess();
    if (!access || !satisfies(access, req)) {
      const session = await getSession();
      await audit(
        { action: name, result: "denied", slackId: session?.slackId ?? null, target, meta: { required: describeRequirement(req) } },
        request,
      );
      return NextResponse.json({ error: "forbidden" }, { status: session ? 403 : 401 });
    }
    const slackId = access.session.slackId;
    try {
      const res = await fn(access, request, ctx);
      await audit({ action: name, result: res.ok ? "ok" : "error", slackId, target, meta: { status: res.status } }, request);
      return res;
    } catch (e) {
      await audit({ action: name, result: "error", slackId, target, meta: { error: errorCode(e) } }, request);
      throw e;
    }
  };
}
