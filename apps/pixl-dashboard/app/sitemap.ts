import type { MetadataRoute } from "next";
import { getAllSlugs } from "@/lib/docs";
import { locales } from "./_landing/dictionaries";
import { config } from "./_generated/config";

// Only public routes that exist: the landing page in each locale, the docs,
// and the shop (browsable when signed out is not guaranteed, so it's left
// out). English is the bare root.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = config.urls.site;
  const localeUrl = (l: string) => (l === "en" ? site : `${site}/${l}`);
  const languages = Object.fromEntries(locales.map((l) => [l, localeUrl(l)]));
  const slugs = await getAllSlugs().catch(() => [] as string[]);
  return [
    ...locales.map((l) => ({
      url: localeUrl(l),
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: l === "en" ? 1 : 0.8,
      alternates: { languages },
    })),
    ...slugs.map((slug) => ({
      url: `${site}/docs/${slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    {
      url: `${site}/queue`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    },
  ];
}
