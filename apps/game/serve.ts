// Serves the container build of the game the way apps/game/vercel.json served
// it on Vercel: the same two rewrites, the same cross-origin isolation rule,
// and the two web/api handlers that were serverless functions there.
//
// Keep this in sync with vercel.json for as long as both deploys exist.
import { resolve, sep } from "node:path";
import shopItemMeta from "./web/api/shop-item-meta.ts";
import shopOg from "./web/api/shop-og.ts";

const ROOT = resolve(process.env.SITE_ROOT ?? "/srv/site");
const PORT = Number(process.env.PORT ?? 3000);

// The Godot wasm needs SharedArrayBuffer, which requires cross-origin
// isolation, but the shell pages embed third-party images that require-corp
// would block. Same split as the negative lookahead in vercel.json.
const NO_ISOLATION =
  /^\/(shop|orders|collectibles|vault|explore|quests|timeline|projects|report|hackatime|fonts|img|pixl)/;

function withIsolation(headers: Headers, pathname: string): Headers {
  if (!NO_ISOLATION.test(pathname)) {
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  }
  return headers;
}

interface NodeStyleHandler {
  (
    req: { url?: string; headers?: Record<string, string | string[] | undefined> },
    res: {
      statusCode: number;
      setHeader(name: string, value: string): void;
      end(chunk?: Uint8Array | string): void;
    },
  ): Promise<void>;
}

// The handlers speak the old Vercel (req, res) shape, so adapt it rather than
// rewrite them - they still have to run unchanged on Vercel.
async function runHandler(handler: NodeStyleHandler, url: URL): Promise<Response> {
  let statusCode = 200;
  const headers = new Headers();
  let body: Uint8Array | string | undefined;

  await handler(
    {
      url: url.pathname + url.search,
      headers: {
        // shop-item-meta re-fetches `${proto}://${host}/shop/item/index.html`.
        // Point that back at this process instead of out through the ingress
        // and back in, which a pod can't generally do.
        host: `127.0.0.1:${PORT}`,
        "x-forwarded-proto": "http",
      },
    },
    {
      get statusCode() {
        return statusCode;
      },
      set statusCode(value: number) {
        statusCode = value;
      },
      setHeader: (name, value) => headers.set(name, value),
      end: (chunk) => {
        body = chunk;
      },
    },
  );

  return new Response(body ?? null, { status: statusCode, headers });
}

async function serveStatic(
  pathname: string,
  ifNoneMatch?: string | null,
): Promise<Response | null> {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const candidates = rel.endsWith("/")
    ? [`${rel}index.html`]
    : [rel, `${rel}/index.html`];

  for (const candidate of candidates) {
    const path = resolve(ROOT, `.${candidate}`);
    if (path !== ROOT && !path.startsWith(ROOT + sep)) continue;

    const file = Bun.file(path);
    if (await file.exists()) {
      // Nothing here is content-hashed: pixl.css, the shell pages and the Godot
      // bundle all keep their names across deploys. Without this Cloudflare
      // hands out the previous build for hours after a deploy. no-cache still
      // caches, it just revalidates, and the size+mtime ETag turns that into a
      // 304 rather than a re-download.
      const etag = `W/"${file.size.toString(16)}-${Math.floor(file.lastModified).toString(16)}"`;
      const headers = withIsolation(
        new Headers({ "Content-Type": file.type }),
        pathname,
      );
      headers.set("Cache-Control", "no-cache");
      headers.set("ETag", etag);
      if (ifNoneMatch === etag) {
        return new Response(null, { status: 304, headers });
      }
      return new Response(file, { headers });
    }
  }

  return null;
}

Bun.serve({
  port: PORT,
  idleTimeout: 60,
  async fetch(request) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/shop-og") return runHandler(shopOg, url);

    // vercel.json rewrite: /shop/item -> /api/shop-item-meta
    if (pathname === "/shop/item" || pathname === "/shop/item/") {
      return runHandler(shopItemMeta, url);
    }

    const ifNoneMatch = request.headers.get("if-none-match");

    const direct = await serveStatic(pathname, ifNoneMatch);
    if (direct) return direct;

    // vercel.json rewrite: /docs/:slug -> /docs/index.html, so the docs shell
    // renders client-side for every page built out of docs/*.md.
    if (/^\/docs\/[^/]+\/?$/.test(pathname)) {
      const docs = await serveStatic("/docs/index.html", ifNoneMatch);
      if (docs) return docs;
    }

    return new Response("Not found", {
      status: 404,
      headers: withIsolation(new Headers({ "Content-Type": "text/plain" }), pathname),
    });
  },
});

console.log(`Serving ${ROOT} on :${PORT}`);
