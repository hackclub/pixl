// Pushes one approved Pixl project into the intermediate "YSWS Project
// Submission" Airtable base. This is NOT Hack Club's real Unified YSWS
// database - it's a staging base a teammate reviews by eye before manually
// checking that base's own "Automation - Submit to Unified YSWS" checkbox,
// which is what actually forwards a record on. buildAirtableFields must
// never emit that field or any other "Automation - *" field; those belong
// exclusively to that manual step and to Airtable's own automation writing
// its results back, never to this code. See airtable.test.ts for the
// regression test that pins this down.
//
// Base/table IDs are fixed constants rather than env vars on purpose: a
// typo'd env var could silently redirect a push at the wrong base, which is
// a worse failure mode than needing a code change to point elsewhere.
const BASE_ID = "app80yzut0bdMNdHJ";
const TABLE_ID = "tbl8UpMm6gsLPKEN0";

export function githubUsernameFromRepoUrl(repoUrl: string): string {
  let u: URL;
  try {
    u = new URL(repoUrl);
  } catch {
    return "";
  }
  if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return "";
  const [owner] = u.pathname.split("/").filter(Boolean);
  return owner ?? "";
}

export interface AuditSections {
  "TECHNICAL FEATURES": string;
  "HACKATIME EVIDENCE": string;
  "DEFLATION REASON": string;
  "AGE JUSTIFICATION": string;
  NOTES: string;
}

export interface AirtableProjectInput {
  repoUrl: string;
  demoUrl: string;
  firstName: string;
  lastName: string;
  email: string;
  /** Empty string when the project has no image - Screenshot is omitted, not sent blank. */
  imageUrl: string;
  description: string;
  approvedHours: number | null;
  /** projects.system_note - set by buildDoubleDip() when this ship matches another YSWS submission. */
  systemNote: string;
  /** Already decrypted by the caller (decryptPII from lib/crypto.ts) - this function never touches encryption. */
  birthday: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  country: string;
  zip: string;
  auditSections: AuditSections;
}

// Every field name buildAirtableFields is allowed to set. Deliberately a
// closed literal union, not `string` - adding an "Automation - *" key (or
// any other key) requires editing this type, which a reviewer will see in
// the diff, rather than being one silent line change away.
type AirtableFieldName =
  | "Code URL"
  | "Playable URL"
  | "First Name"
  | "Last Name"
  | "Email"
  | "Description"
  | "GitHub Username"
  | "Address (Line 1)"
  | "Address (Line 2)"
  | "City"
  | "State / Province"
  | "Country"
  | "ZIP / Postal Code"
  | "Birthday"
  | "Justification - Specific Technical Features"
  | "Justification - Deflation Justification"
  | "Optional - Override Age Justification"
  | "Justification - Additional Justification"
  | "Optional - Override Hours Spent Justification"
  | "Optional - Override Hours Spent"
  | "Screenshot"
  | "Optional - Override Duplicate Justification";

// Airtable's create/update API takes field NAMES as keys (not the fld...
// IDs), matching exactly what /v0/meta/bases/{base}/tables returns.
export function buildAirtableFields(
  input: AirtableProjectInput,
): Partial<Record<AirtableFieldName, unknown>> {
  const fields: Partial<Record<AirtableFieldName, unknown>> = {
    "Code URL": input.repoUrl,
    "Playable URL": input.demoUrl,
    "First Name": input.firstName,
    "Last Name": input.lastName,
    Email: input.email,
    Description: input.description,
    "GitHub Username": githubUsernameFromRepoUrl(input.repoUrl),
    "Address (Line 1)": input.addressLine1,
    "Address (Line 2)": input.addressLine2,
    City: input.city,
    "State / Province": input.state,
    Country: input.country,
    "ZIP / Postal Code": input.zip,
    Birthday: input.birthday,
    "Justification - Specific Technical Features": input.auditSections["TECHNICAL FEATURES"],
    "Justification - Deflation Justification": input.auditSections["DEFLATION REASON"],
    "Optional - Override Age Justification": input.auditSections["AGE JUSTIFICATION"],
    "Justification - Additional Justification": input.auditSections.NOTES,
    // Closest match for Pixl's freeform Hackatime evidence prose - the three
    // more granular Airtable fields (project names+dates, submitter
    // Hackatime ID, lapse links) have no distinct home in Pixl's data and
    // are deliberately left unset below rather than force-split with regex.
    "Optional - Override Hours Spent Justification": input.auditSections["HACKATIME EVIDENCE"],
  };
  if (input.approvedHours !== null) fields["Optional - Override Hours Spent"] = input.approvedHours;
  if (input.imageUrl) fields["Screenshot"] = [{ url: input.imageUrl }];
  if (input.systemNote) fields["Optional - Override Duplicate Justification"] = input.systemNote;
  return fields;
}

export type PushResult =
  | { ok: true; recordId: string }
  | { ok: false; error: string };

// Creates a new record, or PATCHes an existing one when existingRecordId is
// given (the caller looks this up from projects.airtable_record_id - see
// Task 4). Never include "Automation - Submit to Unified YSWS" in `fields`.
export async function pushProjectRecord(
  fields: Record<string, unknown>,
  existingRecordId: string | null,
): Promise<PushResult> {
  const token = process.env.AIRTABLE_PIXL_YSWS_UNIFIED_TOKEN;
  if (!token) return { ok: false, error: "AIRTABLE_PIXL_YSWS_UNIFIED_TOKEN is not set" };

  const url = existingRecordId
    ? `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${existingRecordId}`
    : `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`;
  const method = existingRecordId ? "PATCH" : "POST";

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
    });
  } catch (err) {
    return { ok: false, error: `Airtable request failed: ${(err as Error).message}` };
  }

  const body = (await res.json().catch(() => null)) as
    | { id?: string; error?: { message?: string } }
    | null;
  if (!res.ok || !body?.id) {
    return {
      ok: false,
      error: body?.error?.message ?? `Airtable returned ${res.status}`,
    };
  }
  return { ok: true, recordId: body.id };
}
