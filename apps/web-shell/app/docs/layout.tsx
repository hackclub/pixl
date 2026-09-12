import { getNav } from "@/lib/docs";
import { DocsShell } from "./docs-shell";
import "./docs.css";

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
  const nav = await getNav();
  return <DocsShell nav={nav}>{children}</DocsShell>;
}
