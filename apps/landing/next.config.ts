import path from "node:path";
import type { NextConfig } from "next";

// The game and its shell pages are served by a separate app on its own host.
// On Vercel the apex proxies them through vercel.json; Orchard has no equivalent,
// so without these the "Play the game" link and every shell path 404 on the apex.
// Keep this in sync with vercel.json for as long as both deploys exist.
const GAME_ORIGIN = "https://play.pixl.hackclub.com";

// pixl-web-shell has no public hostname of its own - both this app and it run
// as Orchard deployments in the same "ysws-pixl" k8s namespace, so the proxy
// reaches it over the cluster's internal service DNS instead of round-tripping
// through the public internet for a same-cluster hop. No DNS record needed.
const WEB_SHELL_ORIGIN = "http://pixl-web-shell.ysws-pixl.svc.cluster.local:3000";

// Shell pages, mounted at the same path on the apex as on the game host.
// "docs" and "dashboard" moved to WEB_SHELL_ORIGIN as the React migration's
// first two slices - everything else here still serves off the old static site.
const SHELL_PATHS = [
  "shop", "orders", "collectibles", "vault", "explore", "ideas", "quests",
  "trials", "timeline", "projects", "report", "hackatime",
  "refers", "account", "calc",
];

// The Godot export and the shell request these by absolute path, so they have to
// resolve at the apex too or /play loads its HTML and nothing else.
const ASSET_PATHS = [
  "pixl.css", "pixl.js", "index.js", "index.wasm", "index.pck",
  "index.side.wasm", "index.audio.worklet.js", "index.audio.position.worklet.js",
  "index.icon.png", "index.apple-touch-icon.png", "index.png",
];

// The Godot wasm needs SharedArrayBuffer, which only exists under cross-origin
// isolation. Shell pages deliberately don't get these - they embed third-party
// images that require-corp would block.
const CROSS_ORIGIN_ISOLATION = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(import.meta.dirname, "..", ".."),
  },
  async rewrites() {
    return [
      { source: "/play", destination: `${GAME_ORIGIN}/` },
      { source: "/play/:path*", destination: `${GAME_ORIGIN}/:path*` },
      { source: "/docs", destination: `${WEB_SHELL_ORIGIN}/docs` },
      { source: "/docs/:path*", destination: `${WEB_SHELL_ORIGIN}/docs/:path*` },
      { source: "/dashboard", destination: `${WEB_SHELL_ORIGIN}/dashboard` },
      { source: "/dashboard/:path*", destination: `${WEB_SHELL_ORIGIN}/dashboard/:path*` },
      ...SHELL_PATHS.flatMap((p) => [
        { source: `/${p}`, destination: `${GAME_ORIGIN}/${p}/` },
        { source: `/${p}/:path*`, destination: `${GAME_ORIGIN}/${p}/:path*` },
      ]),
      ...ASSET_PATHS.map((f) => ({
        source: `/${f}`,
        destination: `${GAME_ORIGIN}/${f}`,
      })),
      { source: "/img/:path*", destination: `${GAME_ORIGIN}/img/:path*` },
      { source: "/fonts/:path*", destination: `${GAME_ORIGIN}/fonts/:path*` },
    ];
  },
  async headers() {
    return [
      { source: "/play", headers: CROSS_ORIGIN_ISOLATION },
      { source: "/play/:path*", headers: CROSS_ORIGIN_ISOLATION },
      ...ASSET_PATHS.filter((f) => f.startsWith("index.")).map((f) => ({
        source: `/${f}`,
        headers: CROSS_ORIGIN_ISOLATION,
      })),
    ];
  },
};

export default nextConfig;
