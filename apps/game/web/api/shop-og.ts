// GET /api/shop-og?id=88 -> a 1200x630 branded card with that item's own
// photo inset, for the og:image the /shop/item preview points crawlers at.
// Classic Vercel Node.js function signature (req, res) rather than the
// newer Request/Response one, since this repo has no @vercel/node
// dependency to pull in the types for either - this form has worked
// unchanged since Vercel's very first Node runtime.
import { renderItemCard } from "./_lib/shopCard.ts";
import { safeFetch } from "./_lib/safeFetch.ts";

import pixl from "../../pixl.json" with { type: "json" };

const SERVER = pixl.urls.server;
const SITE_HOST = pixl.urls.site.replace(/^https?:\/\//, "");

interface MinimalReq {
  url?: string;
}
interface MinimalRes {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: Uint8Array | string): void;
}

interface PublicItem {
  name: string;
  price: number;
  image_url?: string | null;
}

export default async function handler(req: MinimalReq, res: MinimalRes): Promise<void> {
  const url = new URL(req.url ?? "/", "http://internal");
  const id = url.searchParams.get("id");

  const send = (png: Uint8Array, cacheSeconds: number) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", `public, s-maxage=${cacheSeconds}, stale-while-revalidate=86400`);
    res.end(png);
  };

  if (!id || !/^\d+$/.test(id)) {
    return send(renderItemCard({ name: "Pixl Shop", price: 0, imageBytes: null, siteHost: SITE_HOST }), 3600);
  }

  try {
    const itemRes = await fetch(`${SERVER}/api/shop/item/${id}/public`);
    if (!itemRes.ok) {
      return send(renderItemCard({ name: "Pixl Shop", price: 0, imageBytes: null, siteHost: SITE_HOST }), 60);
    }
    const body = (await itemRes.json()) as { ok: boolean; item?: PublicItem };
    if (!body.ok || !body.item) {
      return send(renderItemCard({ name: "Pixl Shop", price: 0, imageBytes: null, siteHost: SITE_HOST }), 60);
    }

    let imageBytes: Uint8Array | null = null;
    if (body.item.image_url) {
      try {
        // image_url comes from the DB record, not a literal in this repo, so
        // it's validated against SSRF (private/loopback targets) before we
        // ever fetch it - see _lib/safeFetch.ts.
        const imgRes = await safeFetch(body.item.image_url);
        if (imgRes.ok) imageBytes = new Uint8Array(await imgRes.arrayBuffer());
      } catch (err) {
        console.error("[shop-og] image fetch failed", err);
      }
    }

    send(renderItemCard({ name: body.item.name, price: body.item.price, imageBytes, siteHost: SITE_HOST }), 3600);
  } catch (err) {
    console.error("[shop-og] failed", err);
    send(renderItemCard({ name: "Pixl Shop", price: 0, imageBytes: null, siteHost: SITE_HOST }), 60);
  }
}
