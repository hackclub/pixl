// Serves /project/<id> - the canonical, shareable URL for one project.
//
// Before this, sharing a project meant handing someone
// /explore/#project=<id>. A hash fragment never reaches the server, so no
// crawler could ever see which project the link pointed at and every share
// unfurled as the same generic "Pixl · Explore" card. Fixing that needs a
// real path, which is what this handler answers.
//
// Same trick as ./shop-item-meta.ts: fetch the static explore/index.html the
// site already serves and patch only the <!-- <pixl-preview> --> meta block
// build-previews.ts writes. The page itself is untouched - explore's router
// recognises this pathname and opens the project detail view directly (see
// route() in web/explore/index.html), so real visitors get the full
// interactive page and crawlers get the project's own card.
import pixl from "../../pixl.json" with { type: "json" };

const SERVER = pixl.urls.server;
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

interface PublicProject {
  name: string;
  description?: string | null;
  status: string;
  hackatime_seconds?: number | null;
}

interface ProjectResponse {
  ok: boolean;
  project?: PublicProject;
  owner?: { display_name?: string | null } | null;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// "shipped" here means the player submitted it for review, not that it cleared
// one - "approved" is the cleared state. The description says what actually
// happened rather than overclaiming on someone's behalf.
function summarise(project: PublicProject, owner: string): string {
  const hours = Number(project.hackatime_seconds ?? 0) / 3600;
  const time = hours >= 0.1 ? `${hours.toFixed(1)}h tracked` : "just getting started";
  const verb = project.status === "approved" ? "shipped" : "is building";
  return `${owner} ${verb} ${project.name} on Pixl · ${time}`;
}

export default async function handler(req: MinimalReq, res: MinimalRes): Promise<void> {
  const url = new URL(req.url ?? "/", "http://internal");
  // Two deploys reach this handler differently: the container (serve.ts)
  // passes the original /project/42 path straight through, while Vercel
  // rewrites to /api/project-meta?id=42 and the original path is gone by
  // then. Read whichever one is present. Anything else leaves id null and
  // the generic explore preview stands.
  const queryId = url.searchParams.get("id");
  const id =
    (queryId && /^\d+$/.test(queryId) ? queryId : null) ??
    url.pathname.match(/^\/project\/(\d+)\/?$/)?.[1] ??
    null;

  const proto = (req.headers?.["x-forwarded-proto"] as string) || "https";
  const host = (req.headers?.host as string) || SITE_HOST;
  let html = await fetch(`${proto}://${host}/explore/index.html`).then((r) => r.text());

  if (id) {
    try {
      const projectRes = await fetch(`${SERVER}/api/explore/projects/${id}`);
      if (projectRes.ok) {
        const body = (await projectRes.json()) as ProjectResponse;
        if (body.ok && body.project) {
          const { project } = body;
          const owner = body.owner?.display_name || "A Pixl builder";
          const title = `Pixl · ${project.name}`;
          // Descriptions are free-text and routinely contain newlines, which
          // would split the meta tag across lines and render as a ragged
          // multi-line blurb in an unfurl. Collapse to a single line first.
          const blurb = project.description?.replace(/\s+/g, " ").trim();
          const description = blurb ? blurb.slice(0, 200) : summarise(project, owner);
          const pageUrl = `${SITE}/project/${id}`;
          const image = `${SITE}/api/project-og?id=${id}`;

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
          // The <title> is what a Slack link preview falls back to and what
          // the tab shows while the page boots, so it tracks the project too.
          html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
        }
      }
    } catch (err) {
      console.error("[project-meta] project lookup failed", err);
      // fall through - template's original generic meta block stays as-is
    }
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
  res.end(html);
}
