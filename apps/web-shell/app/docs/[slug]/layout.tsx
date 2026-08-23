import { cache } from "react";
import { notFound } from "next/navigation";
import { getDoc, getNav } from "@/lib/docs";
import { DocsShell } from "./docs-shell";

// React's cache() dedupes this call within one request/render pass, so the
// layout and page.tsx (Step 4) both calling getDoc(slug) only reads the file
// off disk once.
export const cachedGetDoc = cache(getDoc);

export default async function DocsSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [entry, nav] = await Promise.all([cachedGetDoc(slug), getNav()]);
  if (!entry) notFound();

  return (
    <DocsShell nav={nav} activeSlug={slug} headings={entry.doc.headings}>
      {children}
    </DocsShell>
  );
}
