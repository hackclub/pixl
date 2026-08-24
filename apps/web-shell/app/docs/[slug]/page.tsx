import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAllSlugs, cachedGetDoc } from "@/lib/docs";
import { config } from "@/app/_generated/config";
import { CodeBlocks } from "./code-blocks";

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
  const url = `${config.urls.site}/docs/${slug}/`;
  const image = `${url}og.png`;
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
    <article className="doc">
      <div className="eyebrow">{doc.meta.group}</div>
      <div dangerouslySetInnerHTML={{ __html: doc.body }} />
      <div className="doc-foot">
        {prev && (
          <a className="prev" href={`/docs/${prev.slug}/`}>
            <span className="dir">Previous</span>
            <span className="ttl">{prev.title}</span>
          </a>
        )}
        {next && (
          <a className="next" href={`/docs/${next.slug}/`}>
            <span className="dir">Next</span>
            <span className="ttl">{next.title}</span>
          </a>
        )}
      </div>
      <div className="doc-sign">
        {SIGN_GROUPS.includes(doc.meta.group) ? "Built by alexx" : "Built by the Pixl team"}
      </div>
      <CodeBlocks slug={slug} />
    </article>
  );
}
