// Fraudy (fraudy.hackclub.com) AI-usage check for the final-pass review page.
// POST /api/v1/check-ai returns Hackatime's human/AI split for one project and
// how much the "AI / 3" rule takes off. Every call is logged by Fraudy under
// the key's owner, so results are cached for a few minutes (a reviewer reloads
// the page a lot) and the call never throws into the page: no key, a timeout
// or an error from Fraudy all just mean "no numbers".
//
// FRAUDY_API_KEY is an Orchard secret env var; it is never logged or returned.

const FRAUDY_CHECK_AI_URL = "https://fraudy.hackclub.com/api/v1/check-ai";
const TIMEOUT_MS = 15000;
const CACHE_MS = 5 * 60 * 1000;

export interface FraudyAiCheck {
  humanSeconds: number;
  aiSeconds: number;
  /** How much less than the raw total the AI / 3 rule recommends. */
  deflationSeconds: number;
}

export interface FraudyDeps {
  readonly apiKey?: string | undefined;
  readonly fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
  readonly now?: () => number;
}

const cache = new Map<string, { at: number; value: FraudyAiCheck | null }>();

export function clearFraudyCache(): void {
  cache.clear();
}

export function fraudyHours(seconds: number): string {
  return (Math.round((seconds / 3600) * 10) / 10).toString();
}

/** Key for a Fraudy result: two people can have a same-named Hackatime project. */
export function fraudyCheckKey(hackatimeId: string | number, project: string): string {
  return `${hackatimeId}:${project}`;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function fraudyCheckAi(
  hackatimeId: string | number,
  project: string,
  deps: FraudyDeps = {},
): Promise<FraudyAiCheck | null> {
  const apiKey = "apiKey" in deps ? deps.apiKey : process.env.FRAUDY_API_KEY;
  const id = Number(hackatimeId);
  if (!apiKey || !Number.isInteger(id) || id <= 0 || !project) return null;

  const now = deps.now ?? Date.now;
  const cacheKey = `${id}:${project}`;
  const hit = cache.get(cacheKey);
  if (hit && now() - hit.at < CACHE_MS) return hit.value;

  const fetchImpl = deps.fetchImpl ?? ((u: string, i: RequestInit) => fetch(u, i));
  let value: FraudyAiCheck | null = null;
  try {
    const res = await fetchImpl(FRAUDY_CHECK_AI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ hackatime_id: id, project }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.ok) {
      const json = (await res.json()) as Record<string, unknown>;
      value = {
        humanSeconds: num(json.human_seconds),
        aiSeconds: num(json.ai_seconds),
        deflationSeconds: num(json.recommended_deflation_seconds),
      };
    } else {
      // Only the status and Fraudy's error code, never the request or key.
      const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      console.error(`fraudy check-ai ${res.status} ${body?.error?.code ?? ""}`.trim());
    }
  } catch (e) {
    console.error("fraudy check-ai failed", (e as Error).message);
  }
  // Failures are cached too, so a down Fraudy isn't hit on every reload.
  cache.set(cacheKey, { at: now(), value });
  return value;
}
