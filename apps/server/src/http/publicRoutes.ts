// The complete list of routes that answer without a session. Everything not
// listed here needs `Authorization: Bearer <jwt>` (or, under /api/admin, a
// service key). Adding a route here is a security decision: keep it short.
//
// Pattern syntax: `:name` matches exactly one non-empty path segment, a
// trailing `*` matches one or more segments. Method "GET" also covers HEAD;
// "*" is any method.

export interface PublicRoute {
  readonly method: "GET" | "*";
  readonly pattern: string;
}

export const PUBLIC_ROUTES: readonly PublicRoute[] = Object.freeze([
  { method: "GET", pattern: "/" },
  { method: "GET", pattern: "/health" },
  // The OAuth endpoints themselves. The few /auth routes that act on an
  // existing session (logout, /auth/flow/:name) require one explicitly.
  { method: "*", pattern: "/auth/*" },
  { method: "GET", pattern: "/hackatime/callback" },
  { method: "GET", pattern: "/api/news" },
  { method: "GET", pattern: "/api/journals/public/:projectId/:token" },
  { method: "GET", pattern: "/api/shop/item/:id/public" },
  { method: "GET", pattern: "/api/explore/players" },
  { method: "GET", pattern: "/api/explore/players/:id/public" },
  // The project list and a single project's page, read-only. Both return only
  // PUBLIC_PROJECT_COLUMNS plus the owner's display name (routes/explore.ts);
  // a session, when there is one, only fills in has_upvoted.
  { method: "GET", pattern: "/api/explore/projects" },
  { method: "GET", pattern: "/api/explore/projects/:id" },
  { method: "*", pattern: "/api/forms/*" },
] as const);

// "/api/news" -> ["api", "news"]; empty segments ("//") are kept so they
// never match anything.
function segments(path: string): string[] {
  if (!path.startsWith("/")) return [""];
  return path === "/" ? [] : path.split("/").slice(1);
}

function matches(pattern: string, path: string): boolean {
  const want = segments(pattern);
  const have = segments(path);
  for (let i = 0; i < want.length; i++) {
    const w = want[i];
    if (w === "*" && i === want.length - 1) {
      return have.length > i && have.slice(i).every((s) => s !== "");
    }
    const h = have[i];
    if (h === undefined || h === "") return false;
    if (w.startsWith(":")) continue;
    if (w !== h) return false;
  }
  return have.length === want.length;
}

// Express routes case-insensitively and ignores one trailing slash, so the
// path is normalized the same way here: a route is public exactly when the
// handler Express would pick for this path is a public one.
export function normalizePath(path: string): string {
  const lower = path.toLowerCase();
  return lower.length > 1 && lower.endsWith("/") ? lower.slice(0, -1) : lower;
}

export function isPublicRoute(method: string, path: string): boolean {
  const m = method.toUpperCase();
  const p = normalizePath(path);
  return PUBLIC_ROUTES.some(
    (r) => (r.method === "*" || r.method === m || (r.method === "GET" && m === "HEAD")) && matches(r.pattern, p),
  );
}
