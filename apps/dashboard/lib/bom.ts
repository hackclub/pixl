import { assertSafeExternalUrl } from "@/lib/urlSafety";
import { parseCsv } from "@/lib/csv";

const MAX_BOM_BYTES = 512 * 1024;
const MAX_BOM_ROWS = 500;

// Fetches and parses a project's BOM CSV for inline display on the review
// dash, so a reviewer doesn't have to download the file to see it. Returns
// null on any failure (unreachable, not CSV-shaped, too big) - callers fall
// back to just the download link.
export async function fetchBomRows(url: string): Promise<string[][] | null> {
  try {
    await assertSafeExternalUrl(url);
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const len = res.headers.get("content-length");
    if (len && Number(len) > MAX_BOM_BYTES) return null;
    const text = await res.text();
    if (text.length > MAX_BOM_BYTES) return null;
    const rows = parseCsv(text);
    return rows.length ? rows.slice(0, MAX_BOM_ROWS) : null;
  } catch {
    return null;
  }
}
