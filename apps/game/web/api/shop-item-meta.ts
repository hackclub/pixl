// Serves /shop/<id> (see the rewrite in ../../vercel.json) so a shared link
// shows that item's own name/photo instead of the generic "Pixl · Shop" card
// every crawler used to see - crawlers don't run the page's JS, so the fix has
// to live in the actual HTML response, not the client-side fetch the page
// already does for real visitors.
//
// The old form was /shop/item?id=88. Both still reach this handler: Vercel
// rewrites to a query param either way, and the container passes the original
// path through.
//
// This fetches the same static index.html the site always served (the
// client-side page is untouched - identical JS/CSS/markup, same interactive
// detail view) and only patches the <!-- <pixl-preview> --> meta block
// build-previews.ts also writes, using the item's public data when `id`
// resolves to one. No id, or a lookup miss, falls through to the original
// generic meta block untouched.
import pixl from "../../pixl.json" with { type: "json" };

const SERVER = pixl.urls.server;

// Canonical host off packages/config rather than a literal - this was pinned
// to pixl.rsvp and kept emitting URLs there after the move to
// pixl.hackclub.com, same fix as build.ts / build-previews.ts.
const SITE: string = pixl.urls.site;
const SITE_HOST = SITE.replace(/^https?:\/\//, "");

const OPEN = "<!-- <pixl-preview> -->";
const CLOSE = "<!-- <pixl-preview:end> -->";

interface MinimalReq {
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
}
interface MinimalRes {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}

interface PublicItem {
  name: string;
  description?: string | null;
  price: number;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export default async function handler(req: MinimalReq, res: MinimalRes): Promise<void> {
  const url = new URL(req.url ?? "/", "http://internal");
  // Vercel rewrites /shop/<id> to ?id=<id>; the container (serve.ts) passes
  // the original path through, and ?id= also still arrives on old links.
  const id = url.searchParams.get("id") ?? url.pathname.match(/^\/shop\/(\d+)\/?$/)?.[1] ?? null;

  const proto = (req.headers?.["x-forwarded-proto"] as string) || "https";
  const host = (req.headers?.host as string) || SITE_HOST;
  let html = await fetch(`${proto}://${host}/shop/item/index.html`).then((r) => r.text());

  if (id && /^\d+$/.test(id)) {
    try {
      const itemRes = await fetch(`${SERVER}/api/shop/item/${id}/public`);
      if (itemRes.ok) {
        const body = (await itemRes.json()) as { ok: boolean; item?: PublicItem };
        if (body.ok && body.item) {
          const { item } = body;
          const title = `Pixl · ${item.name}`;
          const description = item.description
            ? item.description.slice(0, 200)
            : `${item.name}: ${Math.round(item.price).toLocaleString()} px in the Pixl shop.`;
          const pageUrl = `${SITE}/shop/${id}`;
          const image = `${SITE}/api/shop-og?id=${id}`;

          const block = [
            OPEN,
            `<meta name="description" content="${esc(description)}">`,
            `<link rel="canonical" href="${pageUrl}">`,
            `<meta property="og:type" content="website">`,
            `<meta property="og:site_name" content="Pixl">`,
            `<meta property="og:title" content="${esc(title)}">`,
            `<meta property="og:description" content="${esc(description)}">`,
            `<meta property="og:url" content="${pageUrl}">`,
            `<meta property="og:image" content="${image}">`,
            `<meta property="og:image:width" content="1200">`,
            `<meta property="og:image:height" content="630">`,
            `<meta name="twitter:card" content="summary_large_image">`,
            `<meta name="twitter:title" content="${esc(title)}">`,
            `<meta name="twitter:description" content="${esc(description)}">`,
            `<meta name="twitter:image" content="${image}">`,
            CLOSE,
          ].join("\n    ");

          html = html.replace(new RegExp(`${OPEN}[\\s\\S]*?${CLOSE}`), block);
          // The <title> is what a Slack unfurl falls back to and what the tab
          // shows while the page boots, so it tracks the item too.
          html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
        }
      }
    } catch (err) {
      console.error("[shop-item-meta] item lookup failed", err);
      // fall through - template's original generic meta block stays as-is
    }
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
  res.end(html);
}
