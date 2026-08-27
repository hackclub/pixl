import type { MetadataRoute } from "next";
import { config } from "./_generated/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/",
    },
    sitemap: `${config.urls.site}/sitemap.xml`,
  };
}
