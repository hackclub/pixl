import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  // Traces the real runtime dependency graph into .next/standalone as
  // concrete files instead of relying on Bun's workspace symlinks, which is
  // what let the Docker runtime stage drop the ~900MB /repo/node_modules
  // copy the plain node_modules approach needed (see Dockerfile).
  output: "standalone",
};

export default nextConfig;
