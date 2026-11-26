import type { RailStats } from "@/components/top-rail";
import { getNav } from "@/lib/docs";
import { serverApi, serverGet } from "@/lib/server-api";
import { getSession } from "@/lib/session";
import { DocsShell } from "./docs-shell";

// Deliberately above the [slug] segment, not inside it. Next keys each
// segment's rendered subtree by its cache key, and a dynamic segment's cache
// key includes the param value - so a layout living in [slug]/ gets a new key
// on every slug change and React remounts the whole thing. That remount is
// what made the sidebar visibly rebuild itself on every doc-to-doc
// navigation: scroll position lost, and the theme/open-groups state snapping
// back to its defaults for a frame until the localStorage effects re-ran.
// Up here the key is stable across every /docs/* page, so the shell mounts
// once per visit.
export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  const [nav, stats] = await Promise.all([getNav(), railStats()]);
  return (
    <DocsShell nav={nav} stats={stats}>
      {children}
    </DocsShell>
  );
}

// The docs are public: signed out (or a session apps/server has revoked)
// just means the top rail shows no currency chips.
async function railStats(): Promise<RailStats | null> {
  if (!(await getSession())) return null;
  const [wallet, events] = await Promise.all([
    serverGet<{ pixels: number; re: number }>("/api/profile/wallet"),
    serverApi<{ community_re: number }>("/api/events/active"),
  ]);
  if (!wallet.ok) return null;
  return {
    pixels: Math.round(wallet.data.pixels),
    re: Math.round(wallet.data.re),
    communityRe: events ? Math.round(events.community_re) : 0,
  };
}
