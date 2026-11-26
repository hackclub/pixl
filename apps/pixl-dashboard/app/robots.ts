import type { MetadataRoute } from "next";
import { config } from "./_generated/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/", "/login", "/journals/",
        "/dashboard", "/projects", "/shop", "/orders", "/trials", "/account", "/report",
        "/explore", "/ideas", "/vault", "/calc", "/show-n-tell", "/collectibles", "/refers",
      ],
    },
    sitemap: `${config.urls.site}/sitemap.xml`,
  };
}
