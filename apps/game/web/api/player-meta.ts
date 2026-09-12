// Serves /players/<id> - the canonical, shareable URL for one player's
// profile, the same treatment ./project-meta.ts gives a project.
//
// Before this a profile was only reachable as /explore/#player=<id>. A hash
// fragment never reaches the server, so no crawler could tell whose profile a
// link pointed at and every share unfurled as the generic "Pixl · Explore"
// card.
//
// This hands back the players page with only its <!-- <pixl-preview> --> meta
// block patched. Unlike a project, a profile is the same page for everybody
// (there's nothing to edit here, that lives on /account), so the directory and
// one profile share a page rather than needing two.
import pixl from "../../pixl.json" with { type: "json" };

const SERVER = pixl.urls.server;
const SITE: string = pixl.urls.site;
const SITE_HOST = SITE.replace(/^https?:\/\//, "");

const OPEN = "<!-- <pixl-preview> -->";
const CLOSE = "<!-- <pixl-preview:end> -->";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MinimalReq {
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
}
interface MinimalRes {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}

interface PublicPlayer {
  display_name?: string | null;
  created_at?: string | null;
  level?: number | null;
  xp_hours?: number | null;
}

interface PlayerResponse {
  ok: boolean;
  player?: PublicPlayer;
  projects?: unknown[];
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function summarise(player: PublicPlayer, ships: number): string {
  const hours = Math.round(Number(player.xp_hours ?? 0));
  const bits = [`Level ${player.level ?? 1}`];
  if (hours > 0) bits.push(`${hours}h shipped`);
  bits.push(`${ships} project${ships === 1 ? "" : "s"}`);
  return `${player.display_name || "A Pixl builder"} on Pixl · ${bits.join(" · ")}`;
}

export default async function handler(req: MinimalReq, res: MinimalRes): Promise<void> {
  const url = new URL(req.url ?? "/", "http://internal");
  // Two deploys reach this differently: the container (serve.ts) passes the
  // original /players/<id> path through, while Vercel rewrites to
  // /api/player-meta?id=<id> and the original path is gone by then.
  const queryId = url.searchParams.get("id");
  const pathId = url.pathname.match(/^\/players\/([^/]+)\/?$/)?.[1] ?? null;
  const raw = queryId ?? pathId;
  const id = raw && UUID.test(raw) ? raw : null;

  const proto = (req.headers?.["x-forwarded-proto"] as string) || "https";
  const host = (req.headers?.host as string) || SITE_HOST;
  let html = await fetch(`${proto}://${host}/players/index.html`).then((r) => r.text());

  if (id) {
    try {
      const playerRes = await fetch(`${SERVER}/api/explore/players/${id}/public`);
      if (playerRes.ok) {
        const body = (await playerRes.json()) as PlayerResponse;
        if (body.ok && body.player) {
          const ships = (body.projects ?? []).length;
          const name = body.player.display_name || "A Pixl builder";
          const title = `Pixl · ${name}`;
          const description = summarise(body.player, ships);
          const pageUrl = `${SITE}/players/${id}`;
          const image = `${SITE}/api/player-og?id=${id}`;

          const block = [
            OPEN,
            `<meta name="description" content="${esc(description)}">`,
            `<link rel="canonical" href="${pageUrl}">`,
            `<meta property="og:type" content="profile">`,
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
          html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
        }
      }
    } catch (err) {
      console.error("[player-meta] player lookup failed", err);
      // fall through - the template's generic meta block stays as-is
    }
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
  res.end(html);
}
