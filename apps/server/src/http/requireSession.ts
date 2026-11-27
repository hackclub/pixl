import type { NextFunction, Request, RequestHandler, Response } from "express";
import { verifySessionToken, type SessionClient, type VerifiedSession } from "../auth/session.js";
import { enforceSessionRevocation, type RevocationReader } from "../auth/revocation.js";
import { enforceActiveBans, type BanState } from "../moderation.js";
import { auditRequestThrottled } from "../audit.js";
import type { ServiceName } from "./serviceKeys.js";
import { bearerToken } from "./bearer.js";

export interface RequestSession {
  userId: string;
  displayName: string;
  // Which app the token was issued to. Both the game and the Pixl Dashboard
  // call the HTTP API; handlers and audit use this to tell them apart.
  client: SessionClient;
  slackId?: string;
  iat: number;
  // Token expiry (unix seconds); a re-issued token keeps it (profile rename).
  exp?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // Set only by requireSession, from a verified Bearer token. The one
      // identity a handler may act on.
      session?: RequestSession;
      // Set only by requireServiceKey.
      service?: ServiceName;
    }
  }
}

export { bearerToken };

export interface RequireSessionDeps {
  verify?: (token: string) => VerifiedSession | null;
  revokedAt?: RevocationReader;
  banState?: (userId: string) => Promise<BanState>;
}

function rejectSession(req: Request, res: Response, reason: string): void {
  auditRequestThrottled(req, {
    action: "auth.session_rejected",
    target: req.method,
    result: "denied",
    meta: { reason },
  });
  res.status(401).json({ ok: false, error: "unauthorized" });
}

function attachSession(req: Request, session: VerifiedSession): void {
  req.session = {
    userId: session.userId,
    displayName: session.displayName,
    client: session.client,
    ...(session.slackId ? { slackId: session.slackId } : {}),
    iat: session.iat,
    ...(session.exp !== undefined ? { exp: session.exp } : {}),
  };
}

export function verifyBearer(deps: RequireSessionDeps = {}): RequestHandler {
  const verify = deps.verify ?? verifySessionToken;
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = bearerToken(req);
    if (!token) return rejectSession(req, res, "missing_token");
    const session = verify(token);
    if (!session) return rejectSession(req, res, "invalid_token");
    attachSession(req, session);
    next();
  };
}

/**
 * For public, read-only routes that personalize when a session is present but
 * must keep working without one. Unlike requireSession, a missing or invalid
 * token is simply anonymous; it does not run the revocation/ban lookups
 * because the route is already safe for anyone.
 */
export function optionalSession(deps: RequireSessionDeps = {}): RequestHandler {
  const verify = deps.verify ?? verifySessionToken;
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = bearerToken(req);
    if (!token) return next();
    const session = verify(token);
    if (session) attachSession(req, session);
    next();
  };
}

export function chain(...handlers: RequestHandler[]): RequestHandler {
  return (req, res, next) => {
    let i = 0;
    const step = (err?: unknown): void => {
      if (err !== undefined && err !== null) return next(err);
      const handler = handlers[i++];
      if (!handler) return next();
      try {
        const out = handler(req, res, step) as unknown;
        if (out && typeof (out as Promise<unknown>).catch === "function") (out as Promise<unknown>).catch(next);
      } catch (e) {
        next(e);
      }
    };
    step();
  };
}

// Bearer token -> req.session, then the same revocation and ban checks that
// used to run globally off ?token=.
export function requireSession(deps: RequireSessionDeps = {}): RequestHandler {
  return chain(
    verifyBearer(deps),
    enforceSessionRevocation({ revokedAt: deps.revokedAt }),
    enforceActiveBans({ banState: deps.banState }),
  );
}
