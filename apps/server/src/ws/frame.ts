export type ClientFrame = Record<string, unknown>;

function isPrimitive(value: unknown): boolean {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function primitiveFields(source: object): ClientFrame {
  const out: ClientFrame = Object.create(null);
  for (const [key, value] of Object.entries(source)) if (isPrimitive(value)) out[key] = value;
  return out;
}

export function sanitizeClientFrame(parsed: unknown): ClientFrame | null {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const frame = primitiveFields(parsed);
  const { npcs } = parsed as { npcs?: unknown };
  if (Array.isArray(npcs))
    frame.npcs = npcs.map((n) =>
      typeof n === "object" && n !== null && !Array.isArray(n) ? primitiveFields(n) : Object.create(null),
    );
  return frame;
}
