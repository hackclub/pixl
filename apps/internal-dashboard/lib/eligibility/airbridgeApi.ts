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
    return u.protocol === "https:" && u.hostname.toLowerCase() === "github.com" &&
      path.length >= 2 && path.slice(0, 2).every(v => /^[a-z0-9_.-]+$/i.test(v))
      ? "github.com/" + path[0]!.toLowerCase() + "/" + path[1]!.toLowerCase() : null;
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
export async function getApprovals(ids: string[], fetchImpl: typeof fetch = fetch):
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
    found.set(id, parseApproval(value, id));
  }
  return found;
}
export async function getOtterSlack(approval: Approval, fetchImpl: typeof fetch = fetch):
  Promise<string | null> {
  try {
    const res = await fetchImpl(OTTER_SEARCH + "?q=" + encodeURIComponent(approval.repoUrl), {
      signal: AbortSignal.timeout(5_000), redirect: "error",
    });
    if (!res.ok) return null;
    const data = await limitedJson(res) as { data?: unknown };
    const matches = Array.isArray(data.data) ? data.data.filter((r: unknown) => {
      if (!r || typeof r !== "object") return false;
      const row = r as Record<string, unknown>;
      return row.airtable_id === approval.id && row.ysws === "Pixl" &&
        typeof row.code_url === "string" && githubRepo(row.code_url) === githubRepo(approval.repoUrl);
    }) : [];
    if (matches.length !== 1) return null;
    const slack = (matches[0] as { slack_id?: unknown }).slack_id;
    return typeof slack === "string" && /^[UW][A-Z0-9]{8,}$/.test(slack) ? slack : null;
  } catch { return null; }
}
