import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
          // This admin panel shows moderation reports and PII — never
          // embeddable in a third-party frame (clickjacking).
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
