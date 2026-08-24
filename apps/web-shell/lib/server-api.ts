import { config } from "@/app/_generated/config";
import { getToken } from "./session";

// For Server Components / layouts only - reads the session cookie directly
// via next/headers (through getToken()) and calls apps/server with it as
// the query param it already expects. Returns null on any failure (no
// session, non-2xx, bad JSON) rather than throwing, since most call sites
// just want to render "no data yet" instead of crashing the page.
export async function serverApi<T>(path: string): Promise<T | null> {
  const token = await getToken();
  if (!token) return null;
  const sep = path.includes("?") ? "&" : "?";
  // no-store: this is always per-user data (wallet, projects, ...) - Next's
  // default fetch caching must never be allowed to serve one player's
  // response to another.
  const res = await fetch(`${config.urls.server}${path}${sep}token=${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
