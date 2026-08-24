import { redirect } from "next/navigation";

// Nothing on the public internet points at this app's own "/" - apps/landing
// only rewrites specific path families (/docs, and eventually /dashboard,
// /shop, etc.) to this app, never the bare root. This only matters for local
// dev (`bun run --cwd apps/web-shell dev` then visiting localhost:4901/).
export default function RootPage() {
  redirect("/docs");
}
