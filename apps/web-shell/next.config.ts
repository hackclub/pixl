import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  // apps/landing proxies /docs/:path* to this app (no public hostname of its
  // own - see apps/landing/next.config.ts). Without basePath, this app's own
  // route tree has "docs" baked in as a literal segment (app/[slug]/...
  // matches "/welcome", not "/docs/welcome"), which is fine for pages
  // themselves but leaves every Next-generated asset URL (_next/static/*,
  // etc.) unprefixed - those requests never went through the /docs rewrite
  // rule and 404'd behind the proxy. basePath fixes both: it strips /docs
  // from incoming requests before route matching, and prefixes every
  // Next-generated URL (next/link, _next/static) with /docs to match.
  // Plain <a>/<img> tags and CSS url() are NOT auto-prefixed - those are
  // written with an explicit /docs/ by hand where they appear.
  basePath: "/docs",
  // Traces the real runtime dependency graph into .next/standalone as
  // concrete files instead of relying on Bun's workspace symlinks, which is
  // what let the Docker runtime stage drop the ~900MB /repo/node_modules
  // copy the plain node_modules approach needed (see Dockerfile).
  output: "standalone",
};

export default nextConfig;
