import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  // Traces the real runtime dependency graph into .next/standalone as
  // concrete files instead of relying on Bun's workspace symlinks, which is
  // what let the Docker runtime stage drop the ~900MB /repo/node_modules
  // copy the plain node_modules approach needed (see Dockerfile).
  output: "standalone",
  // This is a Next.js "Multi Zone" (see the bundled docs at
  // node_modules/next/dist/docs/01-app/02-guides/multi-zones.md):
  // apps/landing and this app are two separate Next.js apps sharing one
  // domain via apps/landing's rewrites(). Without assetPrefix, both apps
  // generate their JS/CSS chunk URLs at the same bare /_next/static/...
  // path - apps/landing's own ingress owns that path outright, so this
  // app's chunks 404 behind the proxy and every page renders unstyled.
  // assetPrefix moves this app's asset URLs to a path apps/landing can
  // rewrite to this app specifically. This was silently true from the
  // start of the docs slice too (basePath: "/docs", removed in the
  // Foundation slice's Task 2, was accidentally serving as this exact
  // fix - /docs/_next/static/... happened to match the existing
  // /docs/:path* rewrite, so the collision never showed up until
  // basePath's removal took that accidental fix away with it).
  assetPrefix: "/web-shell-assets",
};

export default nextConfig;
