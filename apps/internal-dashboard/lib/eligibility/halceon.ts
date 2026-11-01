// Optional replacement for the bulk Ships API used by fulfillment.
// Halceon currently exposes HTML, not a versioned JSON API or Unified record IDs.
// Fail closed on missing identity, ambiguous results and malformed/truncated HTML.
import { createHash } from "node:crypto";
import type { ShipsEntry, ShipsProvider, ShipsSnapshot, ShipsView } from "./ships";

export const HALCEON_PIXL_URL =
  "https://lin6bu84s73ya069zkua89ny.halceon.dev/u?q=ysws%3Apixl";
const TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 20_000;
const MAX_HTML_BYTES = 4 * 1024 * 1024;

type ProviderOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  ttlMs?: number;
};

function unescapeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt|nbsp);/gi, (_full, entity: string) => {
    const e = entity.toLowerCase();
    if (e[0] === "#") {
      const isHex = e[1] === "x";
      const cp = Number.parseInt(e.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    }
    return ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " } as Record<string, string>)[e] ?? "";
  });
}

function textOf(html: string): string {
  return unescapeHtml(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].map((m) => unescapeHtml(m[1]!));
}

function githubRepo(hrefsInRow: string[]): { key: string; url: string; owner: string } | null {
  for (const href of hrefsInRow) {
    let url: URL;
    try { url = new URL(href); } catch { continue; }
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") continue;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) continue;
    const owner = parts[0]!;
    const name = parts[1]!.replace(/\.git$/i, "");
    if (!/^[a-z0-9_.-]+$/i.test(owner) || !/^[a-z0-9_.-]+$/i.test(name)) continue;
    return { key: "github.com/" + owner.toLowerCase() + "/" + name.toLowerCase(), url: "https://github.com/" + owner + "/" + name, owner };
  }
  return null;
}

function slackIdForRow(hrefsInRow: string[]): string | null {
  const ids = new Set<string>();
  for (const href of hrefsInRow) {
    let url: URL;
    try { url = new URL(href, HALCEON_PIXL_URL); } catch { continue; }
    if (url.hostname !== "lin6bu84s73ya069zkua89ny.halceon.dev") continue;
    const match = /^\/p\/([UW][A-Z0-9]{8,})\/?$/.exec(url.pathname);
    if (match) ids.add(match[1]!);
  }
  return ids.size === 1 ? [...ids][0]! : null;
}

/** Accept only exact Pixl rows, with a real GitHub repo and parseable approval metadata. */
export function parseHalceonPixlHtml(html: string, fetchedAt: number): ShipsSnapshot {
  if (!/<table\b/i.test(html) || !/<\/table\s*>/i.test(html) ||
      !/<\/html\s*>/i.test(html) || !/<th\b[^>]*>\s*Program\s*<\/th>/i.test(html))
    throw new Error("Halceon returned no recognizable submissions table");

  const byId = new Map<string, ShipsEntry>();
  const byRepo = new Map<string, ShipsEntry[]>();
  const byGithub = new Map<string, ShipsEntry[]>();
  let pixlCount = 0;
  let invalidCount = 0;
  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]!);
    if (cells.length < 8 || textOf(cells[1]!).toLowerCase() !== "pixl") continue;
    pixlCount++;
    const links = hrefs(tr[1]!);
    // Only the dedicated Links cell can establish the repository. Profile
    // links and descriptions are not authoritative project URLs.
    const repo = githubRepo(hrefs(cells[7]!));
    const hours = Number(textOf(cells[3]!));
    const date = textOf(cells[6]!);
    const approvedAt = /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? Date.parse(date + "T12:00:00Z") / 1000 : NaN;
    if (!repo || !Number.isFinite(hours) || hours < 0 || !Number.isFinite(approvedAt)) {
      invalidCount++;
      continue;
    }
    // Synthetic ID is strictly internal. It must NOT be represented as a Unified record ID.
    const identity = repo.key + "|" + (slackIdForRow(links) ?? "") + "|" + date + "|" + hours;
    const id = "halceon:" + createHash("sha256").update(identity + "|" + pixlCount).digest("hex").slice(0, 24);
    const entry: ShipsEntry = {
      id,
      approvedAt,
      hours,
      codeUrl: repo.url,
      repoKey: repo.key,
      githubUsername: repo.owner,
      slackId: slackIdForRow(links),
    };
    byId.set(id, entry);
    byRepo.set(repo.key, [...(byRepo.get(repo.key) ?? []), entry]);
    const ownerKey = repo.owner.toLowerCase();
    byGithub.set(ownerKey, [...(byGithub.get(ownerKey) ?? []), entry]);
  }

  if (!pixlCount || !byId.size)
    throw new Error("Halceon returned no usable Pixl approvals");
  if (invalidCount / pixlCount > 0.1)
    throw new Error("Halceon changed its layout or has too many incomplete rows");

  return {
    source: "halceon",
    fetchedAt,
    byId,
    byRepo,
    byGithub,
    ambiguousIds: new Set(),
    invalidIds: new Set(),
    totalReturned: pixlCount,
    pixlCount,
    invalidCount,
    duplicateCount: 0,
    bytes: new TextEncoder().encode(html).byteLength,
  };
}

async function limitedBody(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length")) > MAX_HTML_BYTES)
    throw new Error("Halceon response exceeds size limit");
  if (!response.body) throw new Error("Halceon response body is empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let count = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    count += value.byteLength;
    if (count > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error("Halceon response exceeds size limit");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(all);
}

export function createHalceonProvider(options: ProviderOptions = {}): ShipsProvider {
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;
  const ttlMs = options.ttlMs ?? TTL_MS;
  let snapshot: ShipsSnapshot | null = null;
  let error: string | null = null;
  let lastAttemptAt: number | null = null;
  let nextRetryAt: number | null = null;
  let failures = 0;
  let inflight: Promise<void> | null = null;

  function view(): ShipsView {
    const ageMs = snapshot ? Math.max(0, now() - snapshot.fetchedAt) : null;
    return {
      snapshot, fetchedAt: snapshot?.fetchedAt ?? null, ageMs,
      fresh: ageMs !== null && ageMs < ttlMs && error === null,
      error, lastAttemptAt, nextRetryAt,
    };
  }

  function refresh(force = false): Promise<void> {
    if (inflight) return inflight;
    if (!force && nextRetryAt !== null && now() < nextRetryAt) return Promise.resolve();
    lastAttemptAt = now();
    inflight = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetchImpl(HALCEON_PIXL_URL, {
          method: "GET", headers: { Accept: "text/html" },
          signal: controller.signal, redirect: "error",
        });
        if (!response.ok) throw new Error("Halceon HTTP " + response.status);
        const html = await limitedBody(response);
        const next = parseHalceonPixlHtml(html, now());
        // A large unexpected decrease is not considered a complete snapshot.
        if (snapshot && next.pixlCount < snapshot.pixlCount * 0.5)
          throw new Error("Halceon results shrank unexpectedly");
        snapshot = next;
        error = null;
        failures = 0;
        nextRetryAt = null;
      } catch (e) {
        error = e instanceof Error ? e.message : "Halceon fetch failed";
        failures++;
        nextRetryAt = now() + Math.min(15 * 60_000, 30_000 * 2 ** Math.min(failures - 1, 5));
      } finally {
        clearTimeout(timeout);
      }
    })().finally(() => { inflight = null; });
    return inflight;
  }

  async function get(): Promise<ShipsView> {
    const state = view();
    if (!state.snapshot || (state.ageMs ?? 0) >= ttlMs) await refresh();
    return view();
  }

  return { get, refresh, view, ttlMs };
}
