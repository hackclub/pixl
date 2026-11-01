// Public, targeted Unified Approved Projects lookup. No full Ships archive.
// Otter enriches identities, but can NEVER authorize a funding decision.
export const AIRBRIDGE_API = "https://api2.hackclub.com/v0.1/Unified%20YSWS%20Projects%20DB/Approved%20Projects";
const OTTER_SEARCH = "https://otter.shymike.dev/api/v1/search";
const ID = /^rec[A-Za-z0-9]{14}$/;
const MAX_BYTES = 512_000;

export interface Approval {
  id: string;
  repoUrl: string;
  hours: number;
  approvedAt: number;
}
export function githubRepo(value: string | null): string | null {
  try {
    const u = new URL(value ?? "");
    const path = u.pathname.replace(/\.git$/i, "").split("/").filter(Boolean);
    const host = u.hostname.toLowerCase();
    // The official Pixl approvals include GitLab and Codeberg repositories.
    // Keep the host allowlist narrow; exact staging-repo matching still applies.
    const allowed = host === "github.com" || host === "gitlab.com" || host === "codeberg.org";
    const validDepth = host === "github.com" ? path.length >= 2 : path.length === 2;
    return u.protocol === "https:" && !u.username && !u.password && allowed &&
      validDepth && path.slice(0, 2).every(v => /^[a-z0-9_.-]+$/i.test(v))
      ? host + "/" + path[0]!.toLowerCase() + "/" + path[1]!.toLowerCase() : null;
  } catch { return null; }
}
export function parseApproval(value: unknown, id: string): Approval {
  if (!ID.test(id) || !value || typeof value !== "object") throw Error("Malformed approval");
  const row = value as { id?: unknown; fields?: Record<string, unknown> };
  const f = row.fields ?? {};
  if (row.id !== id || f["Record ID"] !== id) throw Error("Unified record ID mismatch");
  const programs = Array.isArray(f["YSWS–Name"]) ? f["YSWS–Name"] : [f["YSWS–Name"]];
  if (!programs.some(v => typeof v === "string" && v.trim().toLowerCase() === "pixl"))
    throw Error("Approval belongs to another YSWS");
  const hours = f["Hours Spent"], repoUrl = f["Code URL"], date = f["Approved At"];
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours < 0 ||
      typeof repoUrl !== "string" || !githubRepo(repoUrl) ||
      typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw Error("Approval missing valid hours, repository or date");
  const approvedAt = Date.parse(date + "T12:00:00Z") / 1000;
  if (!Number.isFinite(approvedAt) || approvedAt <= 0 ||
      approvedAt > Date.now() / 1000 + 86400) throw Error("Invalid approval time");
  return { id, hours, repoUrl, approvedAt };
}
async function limitedJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > MAX_BYTES)
    throw Error("Unified response too large");
  const reader = response.body?.getReader();
  if (!reader) throw Error("No response body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BYTES) throw Error("Unified response exceeded limit");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(body)) as unknown;
}
export function airbridgeLookupUrl(ids: string[]): string {
  if (!ids.length || ids.length > 25 || ids.some(id => !ID.test(id)) ||
      new Set(ids).size !== ids.length) throw Error("Invalid Unified ID batch");
  const query = {
    fields: ["Record ID", "Code URL", "Hours Spent", "Approved At", "YSWS–Name"],
    maxRecords: ids.length + 1,
    filterByFormula: "OR(" + ids.map(id => "{Record ID}='" + id + "'").join(",") + ")",
  };
  return AIRBRIDGE_API + "?select=" + encodeURIComponent(JSON.stringify(query));
}
// Parse one exact-ID query. The public endpoint returns a bare array, so a
// short response alone cannot prove whether an omitted ID was really removed.
/** Domain validation errors can be isolated without retrying network outages. */
export class InvalidApprovalError extends Error {
  constructor(public readonly recordId: string, message: string) {
    super(message);
    this.name = "InvalidApprovalError";
  }
}

async function fetchApprovalBatch(ids: string[], fetchImpl: typeof fetch):
  Promise<Map<string, Approval | null>> {
  const res = await fetchImpl(airbridgeLookupUrl(ids), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000), redirect: "error",
  });
  if (!res.ok) throw Error("Airbridge HTTP " + res.status);
  const data = await limitedJson(res);
  if (!Array.isArray(data) || data.length > ids.length)
    throw Error("Airbridge returned an incomplete or unexpected envelope");
  const found = new Map(ids.map(id => [id, null as Approval | null]));
  const seen = new Set<string>();
  for (const value of data) {
    const id = (value as { id?: unknown })?.id;
    if (typeof id !== "string" || !found.has(id) || seen.has(id))
      throw Error("Airbridge returned unexpected or duplicate IDs");
    seen.add(id);
    try { found.set(id, parseApproval(value, id)); }
    catch (e) { throw new InvalidApprovalError(id, (e as Error).message); }
  }
  return found;
}

/** Recheck every omitted bulk ID with its own exact query before calling it missing.
 * A single-ID absence is itself checked twice to guard against transient empty
 * responses. Any failed confirmation rejects the entire batch (fail closed).
 */
export async function getApprovals(ids: string[], fetchImpl: typeof fetch = fetch):
  Promise<Map<string, Approval | null>> {
  const found = await fetchApprovalBatch(ids, fetchImpl);
  const missing = ids.filter(id => !found.get(id));
  if (missing.length === 0) return found;
  for (let i = 0; i < missing.length; i += 6) {
    const chunk = missing.slice(i, i + 6);
    const confirmations = await Promise.all(chunk.map(async id => {
      // For a single-ID first query, retry once; for a bulk omission, obtain
      // an independent single-ID response rather than trusting pagination.
      const result = await fetchApprovalBatch([id], fetchImpl);
      return [id, result.get(id) ?? null] as const;
    }));
    for (const [id, approval] of confirmations) found.set(id, approval);
  }
  return found;
}

/** Split only malformed-record errors. Network/HTTP failures stay bounded. */
export async function getApprovalsIsolated(
  ids: string[], fetchImpl: typeof fetch = fetch,
): Promise<{ approvals: Map<string, Approval | null>; errors: Map<string, string> }> {
  const approvals = new Map<string, Approval | null>();
  const errors = new Map<string, string>();
  async function visit(batch: string[]): Promise<void> {
    try {
      const found = await getApprovals(batch, fetchImpl);
      for (const [id, approval] of found) approvals.set(id, approval);
    } catch (e) {
      if (e instanceof InvalidApprovalError && batch.length > 1) {
        const mid = Math.floor(batch.length / 2);
        await visit(batch.slice(0, mid));
        await visit(batch.slice(mid));
      } else {
        for (const id of batch) errors.set(id, (e as Error).message);
      }
    }
  }
  if (ids.length) await visit(ids);
  return { approvals, errors };
}

export type OtterSlackResult =
  | { state: "verified"; slackId: string }
  | { state: "not_found" }
  | { state: "unavailable" };

export async function getOtterSlack(approval: Approval, fetchImpl: typeof fetch = fetch):
  Promise<OtterSlackResult> {
  try {
    const res = await fetchImpl(OTTER_SEARCH + "?q=" + encodeURIComponent(approval.repoUrl), {
      signal: AbortSignal.timeout(5_000), redirect: "error",
    });
    if (!res.ok) return { state: "unavailable" };
    const data = await limitedJson(res) as { data?: unknown };
    if (!data || !Array.isArray(data.data)) return { state: "unavailable" };
    const matches = data.data.filter((r: unknown) => {
      if (!r || typeof r !== "object") return false;
      const row = r as Record<string, unknown>;
      return row.airtable_id === approval.id && row.ysws === "Pixl" &&
        typeof row.code_url === "string" && githubRepo(row.code_url) === githubRepo(approval.repoUrl);
    });
    if (matches.length !== 1) return { state: "not_found" };
    const slack = (matches[0] as { slack_id?: unknown }).slack_id;
    return typeof slack === "string" && /^[UW][A-Z0-9]{8,}$/.test(slack)
      ? { state: "verified", slackId: slack } : { state: "not_found" };
  } catch { return { state: "unavailable" }; }
}
