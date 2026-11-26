import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllSlugs, cachedGetDoc } from "@/lib/docs";
import { config } from "@/app/_generated/config";
import { cn } from "@/lib/cn";
import { CodeBlocks } from "./code-blocks";
import { DocToc } from "./doc-toc";
import { docProse } from "./doc-prose";

export async function generateStaticParams() {
  const slugs = await getAllSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const entry = await cachedGetDoc(slug);
  if (!entry) return {};
  const { doc } = entry;
  const url = `${config.urls.site}/docs/${slug}`;
  const image = `${url}/og.png`;
  return {
    title: `Pixl · ${doc.meta.title}`,
    description: doc.meta.description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      siteName: "Pixl",
      title: doc.meta.title,
      description: doc.meta.description,
      url,
      images: [{ url: image, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: doc.meta.title,
      description: doc.meta.description,
      images: [image],
    },
  };
}

const footLink = cn(
  "flex-1 border-2 border-stroke bg-panel px-[18px] py-[14px] no-underline shadow-drop",
  "transition-[box-shadow,transform] duration-[130ms] ease-[ease]",
  "hover:-translate-x-[2px] hover:-translate-y-[2px] hover:bg-panel hover:shadow-drop-lg",
);
const footDir = "mb-[4px] block text-[11px] uppercase tracking-[.5px] text-dim";
const footTitle = "text-[15px] font-semibold text-ink";

const SIGN_GROUPS = ["Start here", "Resources", "Guides", "Setup"];

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const entry = await cachedGetDoc(slug);
  if (!entry) notFound();
  const { doc, prev, next } = entry;

  return (
    <>
      <main className="px-[60px] pt-[100px] pb-[100px] max-[820px]:px-[20px] max-[820px]:pt-[30px] max-[820px]:pb-[72px]">
        <article>
          {/* the landing's "01" step badge: a filled block, not tinted text */}
          <div className="mb-[14px] inline-block border-2 border-stroke bg-accent px-[9px] py-[3px] font-pixel text-[12px] font-semibold uppercase tracking-[1px] text-panel-deep">
            {doc.meta.group}
          </div>
          <div data-doc-body className={docProse} dangerouslySetInnerHTML={{ __html: doc.body }} />
          <div className="mt-[52px] flex gap-[14px]">
            {prev && (
              <Link className={footLink} href={`/docs/${prev.slug}`}>
                <span className={footDir}>Previous</span>
                <span className={footTitle}>{prev.title}</span>
              </Link>
            )}
            {next && (
              <Link className={cn(footLink, "text-right")} href={`/docs/${next.slug}`}>
                <span className={footDir}>Next</span>
                <span className={footTitle}>{next.title}</span>
              </Link>
            )}
          </div>
          <div className="mt-[28px] text-center text-[12px] text-dim">
            {SIGN_GROUPS.includes(doc.meta.group) ? "Built by alexx" : "Built by the Pixl team"}
          </div>
          <CodeBlocks slug={slug} />
        </article>
      </main>
      <DocToc headings={doc.headings} />
    </>
  );
}
