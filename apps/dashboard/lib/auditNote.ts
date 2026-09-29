// Structured internal audit note, per Hack Club's YSWS "override hours spent
// justification" guidance: a third party should be able to read this,
// follow the links, and reach the same conclusion the reviewer did. The
// review form builds one of these strings client-side and submits it under
// the existing `auditNote` field name; reviewProject (app/actions.ts) parses
// it back apart to validate the required sections. Shared here so both sides
// agree on the exact header text.
export const AUDIT_HEADERS = [
  "TECHNICAL FEATURES",
  "DEFLATION REASON",
  "AGE JUSTIFICATION",
  "NOTES",
] as const;

export type AuditHeader = (typeof AUDIT_HEADERS)[number];

export const TECHNICAL_FEATURES_MIN = 20;

export function buildAuditNote(sections: Partial<Record<AuditHeader, string>>): string {
  return AUDIT_HEADERS.map((h) => {
    const v = (sections[h] ?? "").trim();
    return v ? `${h}:\n${v}` : "";
  })
    .filter(Boolean)
    .join("\n\n");
}

export function parseAuditNote(auditNote: string): Record<AuditHeader, string> {
  const out = Object.fromEntries(AUDIT_HEADERS.map((h) => [h, ""])) as Record<
    AuditHeader,
    string
  >;
  const headerPattern = AUDIT_HEADERS.join("|");
  const re = new RegExp(`(${headerPattern}):\\s*([\\s\\S]*?)(?=(?:${headerPattern}):|$)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(auditNote))) {
    out[m[1] as AuditHeader] = m[2].trim();
  }
  return out;
}
