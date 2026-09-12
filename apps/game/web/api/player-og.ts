// GET /api/player-og?id=<uuid> -> the 1200x630 card that the /players/<id>
// preview points crawlers at. Same shape and runtime contract as
// ./project-og.ts and ./shop-og.ts: classic Vercel Node.js (req, res) function
// signature, adapted by apps/game's serve.ts for the container deploy.
import { renderPlayerCard } from "./_lib/playerCard.ts";
import { safeFetch } from "./_lib/safeFetch.ts";

import pixl from "../../pixl.json" with { type: "json" };

const SERVER = pixl.urls.server;
const SITE_HOST: string = pixl.urls.site.replace(/^https?:\/\//, "");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MinimalReq {
  url?: string;
}
interface MinimalRes {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: Uint8Array | string): void;
}

interface PublicPlayer {
  display_name?: string | null;
  avatar_url?: string | null;
  created_at?: string | null;
  level?: number | null;
  xp_hours?: number | null;
}

interface PlayerResponse {
  ok: boolean;
  player?: PublicPlayer;
  projects?: unknown[];
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

  // A miss still renders a card rather than a 404 - a broken og:image shows up
  // as a blank box in every chat client, a generic card at least reads.
  const fallback = (cacheSeconds: number) =>
    send(
      renderPlayerCard({
        name: "Pixl",
        level: 1,
        hours: 0,
        projects: 0,
        joined: null,
        siteHost: SITE_HOST,
        avatarBytes: null,
      }),
      cacheSeconds,
    );

  if (!id || !UUID.test(id)) return fallback(3600);

  try {
    const playerRes = await fetch(`${SERVER}/api/explore/players/${id}/public`);
    if (!playerRes.ok) return fallback(60);
    const body = (await playerRes.json()) as PlayerResponse;
    if (!body.ok || !body.player) return fallback(60);
    const { player } = body;

    let avatarBytes: Uint8Array | null = null;
    if (player.avatar_url) {
      try {
        // avatar_url is DB-sourced (Slack/gravatar), not a literal in this
        // repo, so it goes through the SSRF guard first - see _lib/safeFetch.ts.
        const imgRes = await safeFetch(player.avatar_url);
        if (imgRes.ok) avatarBytes = new Uint8Array(await imgRes.arrayBuffer());
      } catch (err) {
        console.error("[player-og] avatar fetch failed", err);
      }
    }

    send(
      renderPlayerCard({
        name: player.display_name || "A Pixl builder",
        level: Number(player.level ?? 1),
        hours: Number(player.xp_hours ?? 0),
        projects: (body.projects ?? []).length,
        joined: player.created_at ?? null,
        siteHost: SITE_HOST,
        avatarBytes,
      }),
      3600,
    );
  } catch (err) {
    console.error("[player-og] failed", err);
    fallback(60);
  }
}
