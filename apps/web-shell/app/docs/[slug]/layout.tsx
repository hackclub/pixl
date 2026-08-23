import { notFound } from "next/navigation";
import { cachedGetDoc, getNav } from "@/lib/docs";
import { DocsShell } from "./docs-shell";
import "../docs.css";

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
