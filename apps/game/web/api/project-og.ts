// GET /api/project-og?id=42 -> the 1200x630 "ship receipt" card that the
// /project/<id> preview points crawlers at. Same shape and runtime contract
// as ./shop-og.ts: classic Vercel Node.js (req, res) function signature, since
// this repo has no @vercel/node dependency for the newer one, and apps/game's
// serve.ts adapts it for the container deploy.
import { renderProjectCard } from "./_lib/projectCard.ts";
import { safeFetch } from "./_lib/safeFetch.ts";

import pixl from "../../pixl.json" with { type: "json" };

const SERVER = pixl.urls.server;
const SITE_HOST: string = pixl.urls.site.replace(/^https?:\/\//, "");

interface MinimalReq {
  url?: string;
}
interface MinimalRes {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: Uint8Array | string): void;
}

interface PublicProject {
  name: string;
  status: string;
  image_url?: string | null;
  hackatime_seconds?: number | null;
  is_peak?: boolean | null;
}

interface ProjectResponse {
  ok: boolean;
  project?: PublicProject;
  owner?: { display_name?: string | null } | null;
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

  // Any miss still renders a card rather than a 404 - a broken og:image shows
  // up as a blank box in every chat client, a generic card at least reads.
  const fallback = (cacheSeconds: number) =>
    send(
      renderProjectCard({
        name: "Pixl",
        owner: "a Pixl builder",
        seconds: 0,
        status: "building",
        siteHost: SITE_HOST,
        imageBytes: null,
      }),
      cacheSeconds,
    );

  if (!id || !/^\d+$/.test(id)) return fallback(3600);

  try {
    const projectRes = await fetch(`${SERVER}/api/explore/projects/${id}`);
    if (!projectRes.ok) return fallback(60);
    const body = (await projectRes.json()) as ProjectResponse;
    if (!body.ok || !body.project) return fallback(60);
    const { project } = body;

    let imageBytes: Uint8Array | null = null;
    if (project.image_url) {
      try {
        // image_url is DB-sourced, not a literal in this repo, so it goes
        // through the SSRF guard before we fetch it - see _lib/safeFetch.ts.
        const imgRes = await safeFetch(project.image_url);
        if (imgRes.ok) imageBytes = new Uint8Array(await imgRes.arrayBuffer());
      } catch (err) {
        console.error("[project-og] image fetch failed", err);
      }
    }

    send(
      renderProjectCard({
        name: project.name,
        owner: body.owner?.display_name || "a Pixl builder",
        seconds: Number(project.hackatime_seconds ?? 0),
        status: project.status,
        isPeak: !!project.is_peak,
        siteHost: SITE_HOST,
        imageBytes,
      }),
      3600,
    );
  } catch (err) {
    console.error("[project-og] failed", err);
    fallback(60);
  }
}
