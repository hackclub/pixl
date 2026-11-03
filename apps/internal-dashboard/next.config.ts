import { existsSync, readFileSync } from "node:fs";
import type { NextConfig } from "next";

// Written by the Dockerfile once per build. With a deploymentId set, a tab
// left open across a deploy does a full reload on its next navigation instead
// of calling Server Actions that no longer exist ("Failed to find Server
// Action"). Absent locally, which turns the check off in dev.
const deploymentId = existsSync(".deployment-id") ? readFileSync(".deployment-id", "utf8").trim() : undefined;

const nextConfig: NextConfig = {
  deploymentId,
  devIndicators: false,
  poweredByHeader: false,
  // Server Actions cap request bodies at 1MB by default, which is well under
  // the "max 4 MB" image-upload checks this app's own actions already
  // enforce (updateProject/updateShopItem in app/actions.ts) - a photo
  // between 1-4MB hit Next's framework-level cap first, crashing with a raw
  // "Body exceeded 1 MB limit" 500 instead of the app's friendlier message.
  // A bit of headroom above 4MB for multipart boundary/field overhead.
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // This admin panel shows moderation reports and PII, never
          // embeddable in a third-party frame (clickjacking).
          { key: "X-Frame-Options", value: "DENY" },
          // Restrict executable scripts to this app while allowing Next's
          // inline hydration bootstrap. A nonce policy is a separate rollout.
          { key: "Content-Security-Policy", value: "script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
