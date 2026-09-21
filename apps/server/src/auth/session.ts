import jwt from "jsonwebtoken";

const JWT_SECRET: string = (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return secret;
})();

export interface SessionPayload {
  userId: string;
  displayName: string;
}

export interface VerifiedSession extends SessionPayload {
  iat: number;
}

// revocable per user, see revocation.ts
export function issueSessionToken(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "14d" });
}

export function verifySessionToken(token: string): VerifiedSession | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (
      typeof decoded !== "object" ||
      typeof decoded.userId !== "string" ||
      typeof decoded.displayName !== "string"
    ) {
      return null;
    }
    return {
      userId: decoded.userId,
      displayName: decoded.displayName,
      iat: typeof decoded.iat === "number" ? decoded.iat : 0,
    };
  } catch {
    return null;
  }
}
