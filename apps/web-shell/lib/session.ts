// The cookie holds apps/server's own JWT (see the proxy.ts handoff) -
// this must decode with the exact same secret and payload shape as
// apps/server/src/auth/session.ts's verifySessionToken, or a legitimate
// session reads as signed out. The secret is read lazily inside the
// function (apps/server's version reads it once at module load) so tests
// can set JWT_SECRET before the first call rather than before import.
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./session-cookie";

export interface SessionPayload {
  userId: string;
  displayName: string;
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) {
    console.error("JWT_SECRET is not set - all sessions will read as signed out");
    throw new Error("JWT_SECRET is not set");
  }
  return s;
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, secret());
    if (
      typeof decoded !== "object" ||
      typeof decoded.userId !== "string" ||
      typeof decoded.displayName !== "string"
    ) {
      return null;
    }
    return { userId: decoded.userId, displayName: decoded.displayName };
  } catch {
    return null;
  }
}

export async function getToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = await getToken();
  return token ? verifySessionToken(token) : null;
}
