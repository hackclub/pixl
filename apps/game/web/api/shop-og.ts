// GET /api/shop-og?id=88 -> a 1200x630 branded card with that item's own
// photo inset, for the og:image the /shop/item preview points crawlers at.
// Classic Vercel Node.js function signature (req, res) rather than the
// newer Request/Response one, since this repo has no @vercel/node
// dependency to pull in the types for either - this form has worked
// unchanged since Vercel's very first Node runtime.
import { renderItemCard } from "./_lib/shopCard.ts";
import { fetchCardImage } from "./_lib/cardImage.ts";

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

    // image_url comes from the DB record, not a literal in this repo, so it
    // goes through the SSRF guard, size caps and fetch budget in
    // _lib/cardImage.ts.
    const image = await fetchCardImage(body.item.image_url, "shop-og");

    send(
      renderItemCard({ name: body.item.name, price: body.item.price, imageBytes: image.bytes, siteHost: SITE_HOST }),
      image.throttled ? 60 : 3600,
    );
  } catch (err) {
    console.error("[shop-og] failed", err);
    send(renderItemCard({ name: "Pixl Shop", price: 0, imageBytes: null, siteHost: SITE_HOST }), 60);
  }
}
