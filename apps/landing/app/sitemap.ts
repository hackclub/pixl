import type { MetadataRoute } from "next";
import { locales, defaultLocale } from "./[lang]/dictionaries";
import { config } from "./_generated/config";

export default function sitemap(): MetadataRoute.Sitemap {
  const languages = Object.fromEntries(
    locales.map((locale) => [locale, `${config.urls.site}/${locale}`]),
  );

  return [
    {
      url: `${config.urls.site}/${defaultLocale}`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
      alternates: { languages },
    },
  ];
}
