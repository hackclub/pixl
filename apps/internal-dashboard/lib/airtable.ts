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

// Every Airtable call gives up after this, so a hung Airtable can't hold up a
// review or a page render.
const AIRTABLE_TIMEOUT_MS = 10_000;

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
  /** "name1 M/D/YYYY-M/D/YYYY, name2 M/D/YYYY-M/D/YYYY" for linked Hackatime
   * projects with tracked activity - empty string when there's nothing to
   * report (no linked projects, or no span data for any of them). */
  hackatimeProjectDateRanges: string;
  /** Hackatime's own numeric user id (HackatimeReport.hackatimeUserId), not
   * the Slack id. Empty string when unavailable. */
  submitterHackatimeId: string;
  /** Comma-separated Lapse playback URLs across the linked projects, if any. */
  lapseLinks: string;
  /** Public, no-login link to this project's journal entries (see
   * ensureJournalShareToken in lib/db.ts and apps/game/web/journals) - empty
   * string when the project has no journal entries to show. */
  journalShareUrl: string;
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
  | "Optional - Override Hours Spent"
  | "Screenshot"
  | "Optional - Override Duplicate Justification"
  | "Justification - Hackatime Project Name(s) + Date Range(s)"
  | "Justification - Submitter Hackatime ID"
  | "Justification - Lapse Links, comma-separated"
  | "Justification - Alternate Tracking Method";

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
  };
  if (input.approvedHours !== null) fields["Optional - Override Hours Spent"] = input.approvedHours;
  if (input.imageUrl) fields["Screenshot"] = [{ url: input.imageUrl }];
  if (input.systemNote) fields["Optional - Override Duplicate Justification"] = input.systemNote;
  if (input.hackatimeProjectDateRanges)
    fields["Justification - Hackatime Project Name(s) + Date Range(s)"] = input.hackatimeProjectDateRanges;
  if (input.submitterHackatimeId) fields["Justification - Submitter Hackatime ID"] = input.submitterHackatimeId;
  if (input.lapseLinks) fields["Justification - Lapse Links, comma-separated"] = input.lapseLinks;
  if (input.journalShareUrl)
    fields["Justification - Alternate Tracking Method"] = input.journalShareUrl;
  return fields;
}

// "Ada", "Ada and Bo", "Ada, Bo and Cy". Blank and repeated names are dropped.
function joinNames(names: string[]): string {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (unique.length <= 1) return unique[0] ?? "";
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

// projects.approved_hours is the CUMULATIVE credited total (pixel payout is a
// delta against what the project already paid), but an update ship gets its own
// Airtable row and YSWS rules count only the hours not already approved on the
// earlier row. prior is the approved total frozen when the update was shipped
// (prior_approved_hours, 0 for a first ship).
export function newHoursOnly(approved: number | null, prior: number | string | null | undefined): number | null {
  if (approved === null) return null;
  const delta = Number(approved) - (Number(prior) || 0);
  return Math.max(Math.round(delta * 10) / 10, 0);
}

// For a project with collaborators, every person gets their own Airtable row
// (see pushProjectToAirtable), so the same project shows up once per person and
// Airtable's duplicate check would flag it. This sentence goes in the "Override
// Duplicate Justification" field to say why that's expected. Empty for a solo
// project, where there is nothing to explain.
export function groupProjectNote(submitterNames: string[]): string {
  const names = joinNames(submitterNames);
  const count = new Set(submitterNames.map((n) => n.trim()).filter(Boolean)).size;
  if (count < 2) return "";
  return `This is a group project, submitted separately by each member (one row per person, with their own hours). Submitters: ${names}.`;
}

// What goes in "Optional - Override Duplicate Justification": the group-project
// sentence (if any) followed by the duplicate-detection note Pixl already
// stored on the project (projects.system_note), so neither one is lost.
export function duplicateOverrideNote(systemNote: string, submitterNames: string[]): string {
  return [groupProjectNote(submitterNames), systemNote.trim()].filter(Boolean).join(" ");
}

export type PushResult =
  | { ok: true; recordId: string }
  | { ok: false; error: string };

// Field names worth showing a staffer deciding whether (and how much) to
// deflate an already-approved project's hours - HQ's own justification text
// plus their hours override, never the PII fields (name/address/birthday/
// email) also on this record. "Optional - Override Hours Spent" isn't itself
// a "Justification - *" field but belongs here: it's the number a staffer is
// comparing Pixl's own approved_hours against.
export const JUSTIFICATION_DISPLAY_FIELDS: AirtableFieldName[] = [
  "Optional - Override Hours Spent",
  "Justification - Specific Technical Features",
  "Justification - Deflation Justification",
  "Optional - Override Age Justification",
  "Justification - Additional Justification",
  "Optional - Override Duplicate Justification",
  "Justification - Hackatime Project Name(s) + Date Range(s)",
  "Justification - Submitter Hackatime ID",
  "Justification - Lapse Links, comma-separated",
  "Justification - Alternate Tracking Method",
];

export type FetchRecordResult =
  | { ok: true; fields: Partial<Record<AirtableFieldName, unknown>> }
  | { ok: false; error: string };

// Reads back the record a project was pushed to (see pushProjectRecord) - so
// the project page can show what's actually sitting in Airtable right now,
// including any "Optional - Override Hours Spent" value HQ has set on their
// end after their own audit, before a staffer decides whether to deflate.
export async function fetchAirtableRecord(recordId: string): Promise<FetchRecordResult> {
  const token = process.env.AIRTABLE_PIXL_YSWS_UNIFIED_TOKEN;
  if (!token) return { ok: false, error: "AIRTABLE_PIXL_YSWS_UNIFIED_TOKEN is not set" };

  let res: Response;
  try {
    res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${recordId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(AIRTABLE_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, error: `Airtable request failed: ${(err as Error).message}` };
  }

  const body = (await res.json().catch(() => null)) as
    | { fields?: Partial<Record<AirtableFieldName, unknown>>; error?: { message?: string } }
    | null;
  if (!res.ok || !body?.fields) {
    return { ok: false, error: body?.error?.message ?? `Airtable returned ${res.status}` };
  }
  return { ok: true, fields: body.fields };
}

const RECORD_ID_PATTERN = /^rec[A-Za-z0-9]{14}$/;

export function airtableRecordUrl(recordId: string): string | null {
  return RECORD_ID_PATTERN.test(recordId) ? `https://airtable.com/${BASE_ID}/${TABLE_ID}/${recordId}` : null;
}

export interface SubmissionInfo {
  submitted: boolean;
  unifiedId: string | null;
}

export type SubmissionLookup =
  | { kind: "found"; info: SubmissionInfo }
  | { kind: "missing" }
  | { kind: "error"; error: string };

export const STATUS_FIELD = "Automation - Status";
export const SUBMITTED_STATUS = "2\u2013Submitted";
const UNIFIED_ID_FIELD = "Automation - YSWS Record ID";
const LOOKUP_CHUNK = 40;

export function parseUnifiedId(value: unknown): string | null {
  const v = Array.isArray(value) && value.length === 1 ? value[0] : value;
  return typeof v === "string" && RECORD_ID_PATTERN.test(v.trim()) ? v.trim() : null;
}

async function lookupChunk(token: string, ids: string[], out: Map<string, SubmissionLookup>): Promise<void> {
  const formula = `OR(${ids.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
  const q = new URLSearchParams({ filterByFormula: formula, pageSize: "100" });
  q.append("fields[]", STATUS_FIELD);
  q.append("fields[]", UNIFIED_ID_FIELD);
  let error: string | null = null;
  try {
    const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?${q}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(AIRTABLE_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as
      | { records?: { id: string; fields?: Record<string, unknown> }[]; offset?: string; error?: { message?: string } }
      | null;
    if (!res.ok || !body?.records) {
      error = body?.error?.message ?? `Airtable returned ${res.status}`;
    } else if (body.offset) {
      error = "Airtable returned more records than requested";
    } else {
      const seen = new Set<string>();
      for (const r of body.records) {
        seen.add(r.id);
        const f = r.fields ?? {};
        out.set(r.id, { kind: "found", info: { submitted: f[STATUS_FIELD] === SUBMITTED_STATUS, unifiedId: parseUnifiedId(f[UNIFIED_ID_FIELD]) } });
      }
      for (const id of ids) if (!seen.has(id)) out.set(id, { kind: "missing" });
    }
  } catch (err) {
    error = `Airtable request failed: ${(err as Error).message}`;
  }
  if (error) for (const id of ids) out.set(id, { kind: "error", error });
}

// GET only, two non-PII fields, batched. Feeds the fulfillment eligibility
// view, which must never write to this base.
export async function fetchSubmissionStates(recordIds: string[]): Promise<Map<string, SubmissionLookup>> {
  const out = new Map<string, SubmissionLookup>();
  const token = process.env.AIRTABLE_PIXL_YSWS_UNIFIED_TOKEN;
  const valid: string[] = [];
  for (const id of new Set(recordIds)) {
    if (!RECORD_ID_PATTERN.test(id)) out.set(id, { kind: "missing" });
    else if (!token) out.set(id, { kind: "error", error: "AIRTABLE_PIXL_YSWS_UNIFIED_TOKEN is not set" });
    else valid.push(id);
  }
  if (!token) return out;
  for (let i = 0; i < valid.length; i += LOOKUP_CHUNK * 3) {
    await Promise.all(
      [0, 1, 2].map((k) => {
        const chunk = valid.slice(i + k * LOOKUP_CHUNK, i + (k + 1) * LOOKUP_CHUNK);
        return chunk.length ? lookupChunk(token, chunk, out) : Promise.resolve();
      }),
    );
  }
  return out;
}

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
      signal: AbortSignal.timeout(AIRTABLE_TIMEOUT_MS),
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

export interface DeleteRecordsResult {
  deleted: string[];
  failed: string[];
  error?: string;
}

// Deletes records from the staging base, one request each so one bad id can't
// sink the rest. A 404 counts as deleted: the record is already gone. Used by
// the player erasure (lib/erasure.ts); records already forwarded to Hack Club's
// Unified YSWS DB are out of reach and have to be removed on their side.
export async function deleteAirtableRecords(
  recordIds: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<DeleteRecordsResult> {
  const ids = [...new Set(recordIds.filter((id) => /^rec[A-Za-z0-9]{14}$/.test(id)))];
  const invalid = recordIds.filter((id) => !ids.includes(id));
  if (ids.length === 0) return { deleted: [], failed: invalid };

  const token = process.env.AIRTABLE_PIXL_YSWS_UNIFIED_TOKEN;
  if (!token) {
    return { deleted: [], failed: [...ids, ...invalid], error: "AIRTABLE_PIXL_YSWS_UNIFIED_TOKEN is not set" };
  }

  const deleted: string[] = [];
  const failed: string[] = [...invalid];
  for (const id of ids) {
    try {
      const res = await fetchImpl(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(AIRTABLE_TIMEOUT_MS),
      });
      if (res.ok || res.status === 404) deleted.push(id);
      else failed.push(id);
    } catch {
      failed.push(id);
    }
  }
  return { deleted, failed };
}
