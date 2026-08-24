# Web Shell Foundation (auth + shared shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `apps/web-shell` httpOnly-cookie auth and the shared sidebar/topbar shell chrome every future page depends on, proven end-to-end with one real signed-in page: `/dashboard`.

**Architecture:** A `proxy.ts` catches the `?token=` Hack Club Auth hands back on any page, stores it in an httpOnly cookie, and strips it from the URL. `lib/session.ts` verifies that JWT locally (same secret and payload shape as `apps/server`). Server Components read the session via `next/headers` and call `apps/server` directly for their own data; a generic `app/api/proxy/[...path]/route.ts` exists for the Client Components later slices will need for mutations, since the browser can no longer read the token itself. A `(shell)` route group renders the sidebar/topbar chrome (ported from `pixl.js`'s `mountTopbar`) around every signed-in page, starting with `/dashboard`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Bun (install/build/test), `jsonwebtoken`, `bun:test`.

---

## Corrections to the approved design doc

`docs/superpowers/specs/2026-08-23-react-migration-design.md`'s addendum
(2026-08-24) decided the slice order and the auth mechanics but didn't
catch one thing: `apps/web-shell/next.config.ts` currently sets
`basePath: "/docs"`, chosen when this app only ever served docs pages
(see that file's own comment: "this app's own route tree has no literal
`docs` segment"). `basePath` prefixes **every** route in the app, not just
the ones that need it — so the moment this plan adds `/dashboard` as a
second, non-`/docs` route, `basePath` would silently serve it at
`/docs/dashboard` instead. That was never a live problem before because
docs was the *only* content this app had. Task 2 below removes `basePath`
entirely and gives docs pages their real `/docs/...` path segment
literally instead, matching every other page family from here on. This is
a mechanical fix, not a design change — nothing about the docs *content*
or its cutover in `apps/landing/next.config.ts` (already live) is affected.

---

## File Structure

Moved:
- `apps/web-shell/app/[slug]/page.tsx` → `apps/web-shell/app/docs/[slug]/page.tsx`
- `apps/web-shell/app/[slug]/layout.tsx` → `apps/web-shell/app/docs/[slug]/layout.tsx`
- `apps/web-shell/app/[slug]/docs-shell.tsx` → `apps/web-shell/app/docs/[slug]/docs-shell.tsx`
- `apps/web-shell/app/[slug]/code-blocks.tsx` → `apps/web-shell/app/docs/[slug]/code-blocks.tsx`
- `apps/web-shell/app/docs.css` → `apps/web-shell/app/docs/docs.css`
- `apps/web-shell/public/icon.svg` → `apps/web-shell/public/docs/icon.svg`

Deleted:
- `apps/web-shell/public/img/cursor/` (both PNGs) — becomes a dead duplicate once the cursor rule points at the always-available `/img/cursor/...` path (see Task 2)

New:
- `apps/web-shell/app/docs/page.tsx` — the real `/docs` index redirect (was the root `app/page.tsx`, relying on `basePath`)
- `apps/web-shell/.env.example`
- `apps/web-shell/lib/session.ts` + `lib/session.test.ts`
- `apps/web-shell/lib/server-api.ts`
- `apps/web-shell/proxy.ts`
- `apps/web-shell/app/api/proxy/[...path]/route.ts` + `route.test.ts`
- `apps/web-shell/lib/urls.ts`
- `apps/web-shell/app/(shell)/layout.tsx`
- `apps/web-shell/app/(shell)/nav-data.ts`
- `apps/web-shell/app/(shell)/shell-nav.tsx`
- `apps/web-shell/app/(shell)/dashboard/page.tsx`
- `apps/web-shell/app/(shell)/dashboard/lib.ts` + `lib.test.ts`
- `apps/web-shell/app/(shell)/dashboard/dashboard.css`
- `apps/web-shell/public/dashboard/og.png` (copied from `apps/game/web/dashboard/og.png`)

Modified:
- `apps/web-shell/next.config.ts` — remove `basePath`
- `apps/web-shell/app/page.tsx` — now redirects to `/docs` (was redirecting to the first slug directly, relying on `basePath` to add the `/docs` prefix)
- `apps/web-shell/app/docs/[slug]/layout.tsx` — fix the `docs.css` import path, now that it moved alongside instead of one level up
- `apps/web-shell/app/docs/[slug]/docs-shell.tsx` — fix nav `Link` hrefs to include the literal `/docs/` prefix
- `apps/web-shell/app/globals.css` — fix the cursor rule's asset path, append the shared shell/component CSS
- `apps/web-shell/package.json` — add `jsonwebtoken` + `@types/jsonwebtoken`
- `CLAUDE.md` — describe the new route structure, auth, and shell layout

---

### Task 1: Read the Next 16 docs for middleware/proxy, route handlers, and Server Component params

**Files:** none (research only — already done once while writing this plan; documented here so the finding is on record and Task 4 reflects it)

- [x] **Step 1: Confirm the App Router APIs this plan assumes**

Read from `apps/web-shell/node_modules/next/dist/docs/`:
- Route `params` in a page/layout/route handler are `Promise`-typed
  (`params: Promise<{ slug: string }>`, `await params`) — confirmed both
  for pages (already true for this app since the docs slice) and for
  Route Handlers specifically
  (`01-app/03-api-reference/03-file-conventions/route.md`: `{ params }:
  { params: Promise<{ team: string }> }`). Task 5's proxy route uses this
  shape.
- **Finding that changes Task 4 below:** Next.js 16 deprecated the
  `middleware.ts` convention and renamed it to `proxy.ts`
  (`01-app/01-getting-started/16-proxy.md`: "Starting with Next.js 16,
  Middleware is now called Proxy... The functionality remains the same,"
  and `03-file-conventions/proxy.md`: "The `middleware` file convention is
  deprecated and has been renamed to `proxy`"). The exported function is
  now named `proxy` (or a default export), not `middleware`; everything
  else — `NextResponse.redirect`/`.next()`/`.json()`, `res.cookies.set()`,
  the `matcher` config shape — is unchanged. `apps/dashboard/middleware.ts`
  predates this rename and keeps working (deprecated, not removed) — that
  file is unrelated to this plan and out of scope to update. Task 4 below
  is written as `proxy.ts`/`export function proxy`, the current
  convention, since this is new code in a new app with no reason to
  start on a deprecated name.

---

### Task 2: Fix the basePath conflict — give docs pages a literal `/docs` route

**Files:**
- Move: `app/[slug]/page.tsx` → `app/docs/[slug]/page.tsx`
- Move: `app/[slug]/layout.tsx` → `app/docs/[slug]/layout.tsx`
- Move: `app/[slug]/docs-shell.tsx` → `app/docs/[slug]/docs-shell.tsx`
- Move: `app/[slug]/code-blocks.tsx` → `app/docs/[slug]/code-blocks.tsx`
- Move: `app/docs.css` → `app/docs/docs.css`
- Move: `public/icon.svg` → `public/docs/icon.svg`
- Create: `app/docs/page.tsx`
- Modify: `next.config.ts`, `app/page.tsx`, `app/docs/[slug]/layout.tsx`, `app/docs/[slug]/docs-shell.tsx`, `app/globals.css`
- Delete: `public/img/cursor/cursor-arrow.png`, `public/img/cursor/cursor-pointer.png`

- [ ] **Step 1: Move the docs route tree under a literal `app/docs/` segment**

```bash
cd apps/web-shell
mkdir -p app/docs
git mv "app/[slug]" "app/docs/[slug]"
git mv app/docs.css app/docs/docs.css
mkdir -p public/docs
git mv public/icon.svg public/docs/icon.svg
```

- [ ] **Step 2: Remove `basePath` from `next.config.ts`**

**Modify** `apps/web-shell/next.config.ts` — replace the whole file:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  // Traces the real runtime dependency graph into .next/standalone as
  // concrete files instead of relying on Bun's workspace symlinks, which is
  // what let the Docker runtime stage drop the ~900MB /repo/node_modules
  // copy the plain node_modules approach needed (see Dockerfile).
  output: "standalone",
};

export default nextConfig;
```

`basePath: "/docs"` is gone — every route now lives at its own literal
path segment (`app/docs/...` for docs, `app/(shell)/dashboard` for
dashboard, and so on for future slices), same as every other app in this
repo. No app-wide prefix to reason about.

- [ ] **Step 3: Split the root page into a dev-convenience redirect, and add the real `/docs` index redirect**

**Modify** `apps/web-shell/app/page.tsx` — replace the whole file:

```tsx
import { redirect } from "next/navigation";

// Nothing on the public internet points at this app's own "/" - apps/landing
// only rewrites specific path families (/docs, and eventually /dashboard,
// /shop, etc.) to this app, never the bare root. This only matters for local
// dev (`bun run --cwd apps/web-shell dev` then visiting localhost:4901/).
export default function RootPage() {
  redirect("/docs");
}
```

**Create** `apps/web-shell/app/docs/page.tsx` (this is the redirect logic
that used to live in the root page, before `basePath` made `/` and `/docs`
the same route):

```tsx
import { redirect } from "next/navigation";
import { getFirstSlug } from "@/lib/docs";

export default async function DocsIndexPage() {
  const first = await getFirstSlug();
  redirect(`/docs/${first}/`);
}
```

- [ ] **Step 4: Confirm the moved layout's CSS import still resolves**

After Task 2 Step 1's `git mv`, `layout.tsx` sits at
`app/docs/[slug]/layout.tsx` and `docs.css` sits at `app/docs/docs.css` —
the same one-level-up relationship they had before the move
(`app/[slug]/layout.tsx` → `app/[slug]/../docs.css`). So the existing
`import "../docs.css";` line is already correct and needs no edit; just
confirm it:

Run: `grep -n "docs.css" "apps/web-shell/app/docs/[slug]/layout.tsx"`
Expected: `import "../docs.css";`

- [ ] **Step 5: Fix the docs sidebar's nav links to the literal `/docs/` prefix**

**Modify** `apps/web-shell/app/docs/[slug]/docs-shell.tsx` — the nav
`Link` used to read `href={`/${i.slug}/`}` and rely on `basePath` to add
`/docs`. Find:

```tsx
                  <Link
                    key={i.slug}
                    className={`section-link${i.slug === activeSlug ? " active" : ""}`}
                    href={`/${i.slug}/`}
                  >
```

Replace with:

```tsx
                  <Link
                    key={i.slug}
                    className={`section-link${i.slug === activeSlug ? " active" : ""}`}
                    href={`/docs/${i.slug}/`}
                  >
```

Also find the icon image reference, which correctly already carries an
explicit `/docs/` prefix (plain `<img>`, never auto-prefixed by
`basePath` even before this change) — leave it as-is, just confirm it
still resolves now that the file backing it moved to `public/docs/icon.svg`:

Run: `grep -n 'src="/docs/icon.svg"' "apps/web-shell/app/docs/[slug]/docs-shell.tsx"`
Expected: one match — no edit needed, the path was already right.

- [ ] **Step 6: Fix the global cursor rule, and drop the now-redundant duplicate PNGs**

**Modify** `apps/web-shell/app/globals.css` — the cursor rule was written
with an explicit `/docs/` prefix because, under `basePath`, that was the
only way to reach this app's own `public/img/cursor/*.png`. Without
`basePath`, `public/img/cursor/*.png` serves at plain `/img/cursor/*.png`
— which collides with `apps/landing/next.config.ts`'s existing
`{ source: "/img/:path*", destination: GAME_ORIGIN/img/:path* }` rewrite,
meaning that path is already, always served by the old game origin
regardless of which app rendered the referring page. `apps/game/web/img/cursor/`
holds the identical two files, so switching to the bare path is not a
functional change — it just means this app no longer needs its own copy.
Find:

```css
/* Absolute paths, not next/image - basePath doesn't auto-prefix plain CSS
   url()/img src, so /docs is written here by hand. */
body, html {
  cursor: url(/docs/img/cursor/cursor-arrow.png) 2 0, auto;
}
a, button, .btn, .section-link, .docs-group-head, .theme-toggle, .copy-btn {
  cursor: url(/docs/img/cursor/cursor-pointer.png) 16 16, pointer !important;
}
```

Replace with:

```css
/* Bare /img/... - already served by the old game origin regardless of which
   app rendered the page (apps/landing/next.config.ts's blanket
   /img/:path* rewrite), so no local copy of these assets is needed here. */
body, html {
  cursor: url(/img/cursor/cursor-arrow.png) 2 0, auto;
}
a, button, .btn, .section-link, .docs-group-head, .theme-toggle, .copy-btn {
  cursor: url(/img/cursor/cursor-pointer.png) 16 16, pointer !important;
}
```

Run:
```bash
rm apps/web-shell/public/img/cursor/cursor-arrow.png apps/web-shell/public/img/cursor/cursor-pointer.png
rmdir apps/web-shell/public/img/cursor apps/web-shell/public/img 2>/dev/null || true
```

- [ ] **Step 7: Typecheck and confirm docs still work**

Run: `bun run --cwd apps/web-shell typecheck`
Expected: no errors.

Run: `bun run --cwd apps/web-shell dev`
Visit `http://localhost:4901/` → should redirect to `/docs` → redirect to `/docs/welcome/`.
Click through a few doc pages, confirm the sidebar, nav-group expand/collapse persistence, and theme picker all still work exactly as before (this task moved files and fixed paths, it must not change docs' behavior at all).
Confirm the pixel cursor still renders over links/buttons (open dev tools' Network tab, reload, and check `/img/cursor/cursor-arrow.png` returns 200 — it's served by the proxy to the game origin in production, but in local dev without `apps/landing` running, this request will 404 harmlessly; that's expected and not a regression to chase down here).

- [ ] **Step 8: Commit**

```bash
git add apps/web-shell CLAUDE.md 2>/dev/null
git add -A apps/web-shell
git commit -m "fix apps/web-shell's basePath conflict: docs gets a literal /docs route"
```

---

### Task 3: Auth infrastructure — session verification + server-side API helper

**Files:**
- Create: `apps/web-shell/lib/session.ts`
- Test: `apps/web-shell/lib/session.test.ts`
- Create: `apps/web-shell/lib/server-api.ts`
- Create: `apps/web-shell/.env.example`
- Modify: `apps/web-shell/package.json`

- [ ] **Step 1: Add `jsonwebtoken` to `apps/web-shell`**

**Modify** `apps/web-shell/package.json` — add to `dependencies`:

```json
    "jsonwebtoken": "^9.0.2",
```

and to `devDependencies`:

```json
    "@types/jsonwebtoken": "^9.0.7",
```

Run: `bun install` (from repo root)

- [ ] **Step 2: Write the failing tests for `verifySessionToken`**

```ts
// apps/web-shell/lib/session.test.ts
import { beforeAll, describe, expect, test } from "bun:test";
import jwt from "jsonwebtoken";
import { verifySessionToken } from "./session.ts";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-do-not-use-in-prod";
});

describe("verifySessionToken", () => {
  test("decodes a token signed with the matching secret", () => {
    const token = jwt.sign({ userId: "u1", displayName: "Test User" }, process.env.JWT_SECRET!);
    expect(verifySessionToken(token)).toEqual({ userId: "u1", displayName: "Test User" });
  });

  test("rejects a token signed with a different secret", () => {
    const token = jwt.sign({ userId: "u1", displayName: "Test User" }, "wrong-secret");
    expect(verifySessionToken(token)).toBeNull();
  });

  test("rejects garbage input", () => {
    expect(verifySessionToken("not-a-jwt")).toBeNull();
  });

  test("rejects an expired token", () => {
    const token = jwt.sign({ userId: "u1", displayName: "Test User" }, process.env.JWT_SECRET!, {
      expiresIn: -10,
    });
    expect(verifySessionToken(token)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test apps/web-shell/lib/session.test.ts`
Expected: FAIL — `Cannot find module './session.ts'`

- [ ] **Step 4: Write `lib/session.ts`**

```ts
// apps/web-shell/lib/session.ts
// The cookie holds apps/server's own JWT (see the proxy.ts handoff) -
// this must decode with the exact same secret and payload shape as
// apps/server/src/auth/session.ts's verifySessionToken, or a legitimate
// session reads as signed out. The secret is read lazily inside the
// function (apps/server's version reads it once at module load) so tests
// can set JWT_SECRET before the first call rather than before import.
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "pixl_session";

export interface SessionPayload {
  userId: string;
  displayName: string;
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, secret()) as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function getToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = await getToken();
  return token ? verifySessionToken(token) : null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test apps/web-shell/lib/session.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Write the server-side authenticated fetch helper**

Server Components render with the request's cookies already available via
`next/headers`, so they can call `apps/server` directly — no need to
round-trip through this app's own proxy route (that's only for Client
Components, see Task 5).

```ts
// apps/web-shell/lib/server-api.ts
import { config } from "@/app/_generated/config";
import { getToken } from "./session";

// For Server Components / layouts only - reads the session cookie directly
// via next/headers (through getToken()) and calls apps/server with it as
// the query param it already expects. Returns null on any failure (no
// session, non-2xx, bad JSON) rather than throwing, since most call sites
// just want to render "no data yet" instead of crashing the page.
export async function serverApi<T>(path: string): Promise<T | null> {
  const token = await getToken();
  if (!token) return null;
  const sep = path.includes("?") ? "&" : "?";
  // no-store: this is always per-user data (wallet, projects, ...) - Next's
  // default fetch caching must never be allowed to serve one player's
  // response to another.
  const res = await fetch(`${config.urls.server}${path}${sep}token=${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
```

- [ ] **Step 7: Add `.env.example`**

```
# Must match apps/server's own JWT_SECRET exactly - this app verifies the
# same JWT apps/server issues, not a session system of its own.
JWT_SECRET=
```

- [ ] **Step 8: Typecheck**

Run: `bun run --cwd apps/web-shell typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/web-shell/lib/session.ts apps/web-shell/lib/session.test.ts apps/web-shell/lib/server-api.ts apps/web-shell/.env.example apps/web-shell/package.json bun.lock
git commit -m "add web-shell's session verification and server-side API helper"
```

---

### Task 4: Proxy (formerly "middleware") — catch the HCA token handoff on any page

**Files:**
- Create: `apps/web-shell/proxy.ts`

- [ ] **Step 1: Write `proxy.ts`**

Named `proxy.ts` with an exported `proxy` function, not the older
`middleware.ts`/`middleware` — Next.js 16 deprecated that convention (see
Task 1's finding). `apps/dashboard/middleware.ts` predates the rename and
keeps working as-is; it's a separate app and out of scope here.

Unlike `apps/dashboard` (which runs its own OAuth exchange and always
lands on one `/api/auth/callback`), `apps/server` still owns the whole
Hack Club Auth exchange and redirects back to whatever `web_redirect`
pointed at — the page the player started login from — with `?token=`
appended (see `apps/game/web/pixl.js`'s `loginUrl()`, ported to this app
in Task 7's `lib/urls.ts`). This has to run on every request, not one
route, to catch that redirect landing anywhere.

```ts
// apps/web-shell/proxy.ts
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

// 14 days - matches apps/server/src/auth/session.ts's issueSessionToken
// expiry, so the cookie never outlives the JWT it holds.
const MAX_AGE = 60 * 60 * 24 * 14;

export function proxy(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.searchParams.delete("token");
  const res = NextResponse.redirect(url);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.BASE_URL?.startsWith("https") ?? false,
    maxAge: MAX_AGE,
    path: "/",
  });
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
```

This never verifies the token (that's `lib/session.ts`'s job, run later
by whatever Server Component reads the cookie) — this function's only job
is "a token showed up in the URL, move it into the cookie and clean the
URL up," identically whether the token turns out to be valid or not. An
invalid/expired token just means `getSession()` returns `null` downstream,
same as no cookie at all.

- [ ] **Step 2: Typecheck**

Run: `bun run --cwd apps/web-shell typecheck`
Expected: no errors.

- [ ] **Step 3: Manually verify the redirect + cookie behavior**

Run: `bun run --cwd apps/web-shell dev`
Visit `http://localhost:4901/docs/welcome/?token=fake-test-token` in a
browser. Expected: the URL bar lands on `http://localhost:4901/docs/welcome/`
(no `?token=`), and dev tools' Application/Storage panel shows a
`pixl_session` cookie with value `fake-test-token`, `HttpOnly` checked,
`Secure` unchecked (since `BASE_URL` isn't set to an `https://` value in
local dev).

- [ ] **Step 4: Commit**

```bash
git add apps/web-shell/proxy.ts
git commit -m "add proxy.ts to catch the HCA token handoff into an httpOnly cookie"
```

---

### Task 5: Generic mutation proxy route

**Files:**
- Create: `apps/web-shell/app/api/proxy/[...path]/route.ts`
- Test: `apps/web-shell/app/api/proxy/[...path]/route.test.ts`

- [ ] **Step 1: Write the failing tests**

`proxyRequest` is written as the testable core, separate from the thin
`GET`/`POST`/etc. exports so it can be tested without needing a real
Next request-scoped `cookies()` context (which `getToken()` requires and
which doesn't exist outside an actual Next server).

```ts
// apps/web-shell/app/api/proxy/[...path]/route.test.ts
import { afterEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { proxyRequest } from "./route.ts";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe("proxyRequest", () => {
  test("returns 401 with no token, never calling upstream", async () => {
    const fetchSpy = mock(() => {
      throw new Error("should not be called");
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
    const req = new NextRequest("http://localhost/api/proxy/profile/wallet");
    const res = await proxyRequest(req, ["profile", "wallet"], null);
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("forwards a GET with the token and query string appended", async () => {
    let capturedUrl = "";
    global.fetch = mock(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ ok: true, pixels: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const req = new NextRequest("http://localhost/api/proxy/profile/wallet?foo=bar");
    const res = await proxyRequest(req, ["profile", "wallet"], "tok123");
    expect(capturedUrl).toContain("/api/profile/wallet?foo=bar&token=tok123");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pixels: 42 });
  });

  test("forwards a POST body and content-type", async () => {
    let capturedInit: RequestInit | undefined;
    global.fetch = mock(async (_url: string, init: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const req = new NextRequest("http://localhost/api/proxy/shop/save/5", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ option: "red" }),
    });
    await proxyRequest(req, ["shop", "save", "5"], "tok123");
    expect(capturedInit?.method).toBe("POST");
    expect((capturedInit?.headers as Record<string, string>)?.["content-type"]).toBe("application/json");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test "apps/web-shell/app/api/proxy/[...path]/route.test.ts"`
Expected: FAIL — `Cannot find module './route.ts'`

- [ ] **Step 3: Write `route.ts`**

```ts
// apps/web-shell/app/api/proxy/[...path]/route.ts
// The token lives in an httpOnly cookie, unreadable by client JS by design
// (see docs/superpowers/specs/2026-08-23-react-migration-design.md's
// addendum) - so Client Components that need to POST/PUT/DELETE against
// apps/server go through this instead of calling it directly. Same trust
// boundary as the old localStorage-token model: a signed-in client could
// already call any apps/server endpoint with its own token, this only
// moves where the token itself lives.
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/app/_generated/config";
import { getToken } from "@/lib/session";

export async function proxyRequest(
  req: NextRequest,
  path: string[],
  token: string | null,
): Promise<NextResponse> {
  if (!token) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const search = req.nextUrl.search;
  const sep = search ? "&" : "?";
  const url = `${config.urls.server}/api/${path.join("/")}${search}${sep}token=${encodeURIComponent(token)}`;

  const init: RequestInit = { method: req.method };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
    const contentType = req.headers.get("content-type");
    if (contentType) init.headers = { "content-type": contentType };
  }

  const upstream = await fetch(url, init);
  const body = await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, ctx: RouteContext) {
  const [{ path }, token] = await Promise.all([ctx.params, getToken()]);
  return proxyRequest(req, path, token);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test "apps/web-shell/app/api/proxy/[...path]/route.test.ts"`
Expected: PASS (3 tests). If constructing `NextRequest` fails under
`bun:test` (Task 1's docs check didn't cover this specifically), that's a
real finding — read the error, and if `next/server`'s `NextRequest`
genuinely isn't usable standalone under Bun's test runner, fall back to
building the test around a plain `Request` cast to `NextRequest` for the
`req.method`/`req.headers`/`req.arrayBuffer()` calls `proxyRequest` uses,
plus a manually-constructed `.nextUrl` object exposing `.search`.

- [ ] **Step 5: Typecheck**

Run: `bun run --cwd apps/web-shell typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "apps/web-shell/app/api/proxy"
git commit -m "add the generic authenticated proxy route for client-side mutations"
```

---

### Task 6: Port the shared shell + component CSS

**Files:**
- Modify: `apps/web-shell/app/globals.css`

- [ ] **Step 1: Append the shared design-system CSS**

Ported from `apps/game/web/pixl.css`, verbatim (same class names, same
rules) — same "structural port, not a redesign" approach the docs slice
already took for `docs.css`. Scoped to what this Foundation slice and
`dashboard` actually render: the sidebar/topbar shell chrome, and the
generic component classes every future page will also need (`.btn`,
`.card`, `.panel`, page headers, the progress bar, chips, dots, the
spinner, toasts, and the signed-out gate). Deliberately **not** ported
here (add when a slice first needs them, not speculatively): `.csel`
(custom `<select>` styling — no page in this slice has a `<select>`),
`.overlay`/`.modal`, `.trial-picker`, `.hud`.

**Modify** `apps/web-shell/app/globals.css` — append after the existing
`:root[data-theme="dark"] { ... }` block:

```css

/* ══════════════════════ shared shell + components ══════════════════════
   Ported verbatim from apps/game/web/pixl.css - same class names, same
   rules, so nothing in the shell layout (Task 7) or dashboard page
   (Task 8) markup has to guess at what's available. Trimmed to what this
   slice actually renders; add more sections here as later slices need
   them (never speculatively). */

body {
  overflow-y: scroll;
  transition: color .15s ease;
}
img { display: block; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 26px 20px 72px; }

/* ── app shell / sidebar ── */
body.has-sidebar { padding-left: var(--sidebar); padding-top: var(--toprail); }

.sidebar {
  position: fixed; top: 0; left: 0; bottom: 0; width: var(--sidebar); z-index: 40;
  display: flex; flex-direction: column; gap: 4px;
  padding: 16px 12px;
  background: var(--panel); border-right: var(--bw-heavy) solid var(--stroke);
}
.sb-logo {
  display: flex; align-items: center;
  padding: 6px 8px 16px; margin-bottom: 6px;
  font-family: var(--pixel); font-size: 26px; font-weight: 600; letter-spacing: 1.5px;
  color: var(--ink);
}

.nav { display: flex; flex-direction: column; gap: 16px; flex: 1; overflow-y: auto; }
.nav-group { display: flex; flex-direction: column; gap: 2px; }
.nav-label {
  font-family: var(--pixel); font-size: 10.5px; font-weight: 600; letter-spacing: 2.5px;
  color: var(--muted); padding: 0 10px; margin-bottom: 4px;
}
.nav a {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 10px; border-radius: 0;
  font-family: var(--pixel); font-size: 14.5px; letter-spacing: .8px; font-weight: 500;
  color: var(--ink); border: var(--bw) solid transparent;
  transition: color .13s ease, background .13s ease, border-color .13s ease, transform .12s ease;
}
.nav a .ic {
  width: 26px; height: 26px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--panel-deep); border: var(--bw) solid var(--stroke); border-radius: 0;
  transition: background .13s ease, color .13s ease;
}
.nav a svg { width: 14px; height: 14px; flex-shrink: 0; }
.nav a:hover { color: var(--panel-deep); background: var(--ink); border-color: var(--stroke); transform: translateX(3px); }
.nav a:hover .ic { background: var(--panel-deep); color: var(--ink); }
.nav a.active { color: var(--panel-deep); background: var(--accent); border-color: var(--stroke); }
.nav a.active .ic { background: var(--panel-deep); color: var(--ink); }
.nav a.active:hover { background: var(--accent); }
.sb-foot { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
.back-to-game .arrow { display: inline-block; transition: transform .15s ease; }
.back-to-game:hover .arrow { transform: translateX(-3px); }

.toprail {
  position: fixed; top: 0; left: var(--sidebar); right: 0; height: var(--toprail); z-index: 39;
  display: flex; align-items: center; justify-content: flex-end; gap: 10px;
  padding: 0 20px;
  background: var(--panel-deep);
  border-bottom: var(--bw-heavy) solid var(--stroke);
}

.nav-more, .nav-sheet { display: none; }

@media (max-width: 900px) {
  body.has-sidebar { padding-left: 0; padding-bottom: 64px; }
  .sidebar {
    top: auto; left: 0; right: 0; bottom: 0; width: auto; height: 60px;
    flex-direction: row; gap: 2px; padding: 0 6px;
    border-right: 0; border-top: var(--bw-heavy) solid var(--stroke);
  }
  .sb-logo, .sb-foot { display: none; }
  .nav { flex-direction: row; gap: 2px; justify-content: space-around; overflow: visible; }
  .nav-group { display: contents; }
  .nav-label { display: none; }
  .nav a.secondary { display: none; }
  .nav-more {
    display: flex; flex-direction: column; gap: 3px; flex: 1;
    align-items: center; justify-content: center;
    padding: 8px 2px 6px; border: 0; background: none; cursor: pointer;
    font-family: var(--pixel); font-size: 10px; letter-spacing: .5px;
    color: var(--faint); transition: color .13s ease;
  }
  .nav-more svg { width: 20px; height: 20px; }
  .nav-more.open { color: var(--accent); box-shadow: inset 0 3px 0 var(--accent); }
  .nav-sheet {
    display: block; position: fixed; left: 0; right: 0; bottom: 60px; z-index: 41;
    background: var(--panel);
    border-top: var(--bw-heavy) solid var(--stroke);
    padding: 10px 8px calc(10px + env(safe-area-inset-bottom, 0px));
    animation: pxl-sheet-up .16s ease;
  }
  .nav-sheet[hidden] { display: none; }
  .nav-sheet-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .nav-sheet .nav-sheet-grid a {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
    padding: 12px 4px; border-radius: 0; border: var(--bw) solid var(--stroke);
    background: var(--panel-deep); color: var(--ink); text-decoration: none;
    font-family: var(--pixel); font-size: 11px; letter-spacing: .5px; text-align: center;
  }
  .nav-sheet .nav-sheet-grid a svg { width: 20px; height: 20px; }
  .nav-sheet .nav-sheet-grid a.active { background: var(--accent); color: var(--panel-deep); }
  @keyframes pxl-sheet-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  .nav a {
    flex-direction: column; gap: 3px; flex: 1; justify-content: center;
    padding: 8px 2px 6px; font-size: 10px; letter-spacing: .5px; border: 0; border-radius: 0;
    text-align: center;
  }
  .nav a .ic { width: auto; height: auto; background: transparent; border: 0; }
  .nav a svg { width: 20px; height: 20px; }
  .nav a.active { background: transparent; color: var(--accent); box-shadow: inset 0 3px 0 var(--accent); }
  .nav a.active .ic { background: transparent; color: var(--accent); }
  .nav a:hover { background: transparent; color: var(--accent); transform: none; }
  .nav a:hover .ic { background: transparent; color: var(--accent); }
  .toprail { left: 0; }
}

/* ── currency rail ── */
.wallet-chip, .rest-chip {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 11px 5px 6px; border-radius: 0;
  border: var(--bw) solid var(--stroke); background: var(--panel);
  font-size: 13px; cursor: default; font-variant-numeric: tabular-nums;
}
.wallet-chip .slot, .rest-chip .slot {
  width: 24px; height: 24px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border: var(--bw) solid var(--stroke); border-radius: 0;
}
.wallet-chip .slot { background: var(--gold); }
.wallet-chip .slot img { width: 16px; height: 16px; }
.wallet-chip .px { color: var(--ink); font-family: var(--sans); font-weight: 700; font-size: 16px; letter-spacing: .2px; font-variant-numeric: tabular-nums; }
.rest-chip .slot { background: var(--teal); }
.rest-chip .slot svg { width: 15px; height: 15px; }
.rest-chip .re { color: var(--ink); font-family: var(--sans); font-weight: 700; font-size: 16px; letter-spacing: .2px; font-variant-numeric: tabular-nums; }
.rest-chip .rl { color: var(--dim); font-size: 11px; letter-spacing: .5px; }
@media (max-width: 560px) {
  .rest-chip .rl { display: none; }
  .rest-chip { display: none; }
}

/* ── theme toggle ── */
.theme-toggle, .rail-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 0; flex-shrink: 0;
  border: var(--bw) solid var(--stroke);
  border-right-width: var(--bw-heavy); border-bottom-width: var(--bw-heavy);
  background: var(--panel); color: var(--ink);
  font-size: 15px; cursor: pointer; line-height: 1; font-family: var(--pixel); font-weight: 700;
  transition: color .13s ease, background .13s ease, border-bottom-width .13s ease, transform .13s ease;
}
.theme-toggle:hover, .rail-btn:hover {
  background: var(--accent); color: var(--panel-deep);
  border-bottom-width: var(--bw-lift); transform: translate(-2px, -2px);
}
.theme-toggle svg, .rail-btn svg { width: 16px; height: 16px; image-rendering: pixelated; }

.theme-picker { position: relative; }
.theme-menu {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 60; min-width: 170px;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--panel); border: var(--bw) solid var(--stroke); border-radius: 0;
  box-shadow: var(--drop);
}
.theme-menu[hidden] { display: none; }
.theme-opt {
  display: flex; align-items: center; gap: 9px; width: 100%; padding: 8px 11px;
  border: none; border-radius: 0; background: transparent; color: var(--ink);
  font-family: var(--pixel); font-size: 13.5px; letter-spacing: .3px; text-align: left; cursor: pointer;
  transition: background .12s ease, color .12s ease;
}
.theme-opt:hover { background: var(--accent); color: var(--panel-deep); }
.theme-opt.active { background: var(--ink); color: var(--panel-deep); }
.theme-opt .swatch { width: 14px; height: 14px; border: 1px solid var(--stroke); border-radius: 0; flex-shrink: 0; }

/* ── components ── */
.btn {
  display: inline-flex; align-items: center; gap: 7px;
  cursor: pointer; border-radius: 0;
  border: var(--bw) solid var(--stroke);
  border-right-width: var(--bw-heavy); border-bottom-width: var(--bw-heavy);
  background: var(--gold); color: var(--btn-ink);
  font-family: var(--pixel); font-size: 15px; letter-spacing: .5px; font-weight: 600;
  padding: 9px 17px;
  transition: background .13s ease, color .13s ease, border-color .13s ease,
              border-bottom-width .13s ease, transform .13s ease;
  text-decoration: none; white-space: nowrap;
}
.btn:hover {
  background: var(--gold-soft); color: var(--btn-ink);
  border-bottom-width: var(--bw-lift); transform: translate(-2px, -2px);
}
.btn:active { border-bottom-width: var(--bw); transform: translate(0, 2px); }
.btn.dark { background: var(--ink); color: var(--panel-deep); }
.btn.dark:hover { background: var(--ink); color: var(--gold); }

.chip {
  display: inline-flex; align-items: center; gap: 5px;
  font-family: var(--sans); font-size: 12.5px; letter-spacing: .2px; font-weight: 700;
  font-variant-numeric: tabular-nums;
  padding: 4px 9px; border: var(--bw) solid var(--stroke); border-radius: 0;
  background: var(--panel); color: var(--ink);
}
.chip.gold { background: var(--gold); color: var(--btn-ink); }
.chip.teal { background: var(--teal); color: var(--btn-ink); }

.card {
  cursor: pointer; border: var(--bw) solid var(--stroke); border-radius: 0;
  background: var(--panel); box-shadow: var(--drop);
  transition: box-shadow .13s ease, transform .13s ease, background-color .13s ease;
}
.card:hover { box-shadow: var(--drop-lg); transform: translate(-2px, -2px); }
.card:active { transform: translate(0, 0); box-shadow: var(--drop); }
.panel { border: var(--bw) solid var(--stroke); border-radius: 0; background: var(--panel); box-shadow: var(--drop); }

.page-title { font-family: var(--pixel); font-weight: 700; font-size: 34px; line-height: 1.05; letter-spacing: 1px; color: var(--ink); }
.page-sub { font-family: var(--pixel); font-weight: 500; font-size: 13px; letter-spacing: 2px; color: var(--dim); margin-top: 8px; text-transform: uppercase; }

.rbar { position: relative; height: 16px; background: var(--panel); border: var(--bw) solid var(--stroke); border-radius: 0; overflow: hidden; }
.rbar > i {
  display: block; height: 100%;
  background: repeating-linear-gradient(90deg, var(--teal) 0 7px, var(--teal-hover) 7px 14px);
  transition: width .5s ease;
}
.rbar.gold > i { background: repeating-linear-gradient(90deg, var(--gold) 0 7px, var(--gold-soft) 7px 14px); }

.dot { width: 9px; height: 9px; border: 1px solid var(--stroke); border-radius: 0; display: inline-block; flex-shrink: 0; }
.dot.on { background: var(--good); }
.dot.off { background: var(--bad); }

.field {
  font-family: var(--sans); background: var(--panel); color: var(--ink);
  border: var(--bw) solid var(--stroke); border-radius: 0; padding: 10px 14px; font-size: 15px;
  outline: none; transition: box-shadow .13s ease, transform .13s ease;
}
.field:focus { box-shadow: var(--drop); transform: translate(-1px, -1px); }
.field::placeholder { color: var(--muted); }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
.faint { color: var(--faint); }
.gold { color: var(--gold); }
.teal { color: var(--teal); }

/* ── spinner ── */
.spin { width: 30px; height: 30px; margin: 40px auto; border: 4px solid var(--panel-2); border-top-color: var(--accent); border-radius: 50%; animation: spin .7s steps(8) infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ── toast ── */
.toast-slot { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 200; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
.toast {
  background: var(--panel); color: var(--ink);
  border: var(--bw) solid var(--stroke); border-radius: 0; padding: 12px 20px;
  font-size: 15px; box-shadow: var(--drop);
  animation: toast-in .2s ease both;
}
.toast.bad { background: var(--bad); color: var(--panel-deep); }
@keyframes toast-in { from { opacity: 0; transform: translateY(10px); } }

/* ── gate (no session) ──
   The game's own boot splash is the background, so a signed-out visitor
   lands on the same screen the game itself starts on. */
.gate {
  position: fixed; inset: 0; z-index: 9999;
  display: flex; align-items: center; justify-content: center;
  padding: 24px; background: #f5eed2;
}
.gate-card { display: flex; flex-direction: column; align-items: center; text-align: center; max-width: 620px; }
.gate-splash {
  --sw: min(1000px, 92vw);
  display: block; width: var(--sw); height: auto; image-rendering: pixelated;
  margin-top: calc(var(--sw) * -0.19);
  margin-bottom: calc(var(--sw) * -0.20);
}
.gate-card p { color: #6b5c46; font-size: 16px; line-height: 1.7; margin-bottom: 28px; max-width: 34em; }
.btn-enter {
  display: inline-block; font-family: var(--pixel); font-size: 32px; line-height: 1;
  padding: 14px 36px; background: #000; color: #f5eed2; text-decoration: none;
  border: 2px solid #000; border-right-width: 8px; border-bottom-width: 8px;
  transition: transform .15s ease, border-bottom-width .15s ease;
}
.btn-enter:hover { border-bottom-width: 12px; transform: translate(-4px, -4px); }
.btn-enter:active { border-bottom-width: 4px; transform: translate(0, 2px); }
@media (max-height: 620px) {
  .gate-splash { --sw: min(560px, 70vw); }
  .btn-enter { font-size: 24px; padding: 12px 26px; }
  .gate-card p { font-size: 14px; margin-bottom: 20px; }
}
```

- [ ] **Step 2: Typecheck (CSS doesn't typecheck, but confirm nothing else broke)**

Run: `bun run --cwd apps/web-shell typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web-shell/app/globals.css
git commit -m "port the shared shell/component CSS from pixl.css into web-shell"
```

---

### Task 7: The shell layout (sidebar/topbar) and its nav data

**Files:**
- Create: `apps/web-shell/lib/urls.ts`
- Create: `apps/web-shell/app/(shell)/nav-data.ts`
- Create: `apps/web-shell/app/(shell)/shell-nav.tsx`
- Create: `apps/web-shell/app/(shell)/layout.tsx`

- [ ] **Step 1: Write `lib/urls.ts`**

Only `gameUrl` is needed for this slice (the gate's CTA) — a `loginUrl`
helper for a direct in-place web login (the design doc's section 5 quotes
`pixl.js`'s own comment on this) belongs to whichever future slice
actually renders a "LOG IN" button (e.g. `calc`'s public, trimmed nav);
adding it here with nothing calling it yet would be dead code.

```ts
// apps/web-shell/lib/urls.ts
// Ported from pixl.js: on the standalone play.* host the game is at the
// root; proxied under pixl.hackclub.com (via apps/landing's rewrites) it
// lives at /play. This runs server-side (Server Components have no
// `location`), so it takes the request host explicitly instead of reading
// it off `location.hostname`.
export function gameUrl(host: string): string {
  return host.startsWith("play.") ? "/" : "/play";
}
```

- [ ] **Step 2: Write the nav data, ported from `pixl.js`'s `NAV_GROUPS`/`ICONS`/`MOBILE_PRIMARY`**

```ts
// apps/web-shell/app/(shell)/nav-data.ts
// Ported from apps/game/web/pixl.js. "docs" is intentionally not in here -
// it's a separate top-level Next route with its own layout
// (app/docs/[slug]), not a page this shell wraps. quests and timeline are
// also intentionally absent - see the migration design doc's 2026-08-24
// addendum: both are deferred out of this migration entirely.
export interface NavLink {
  slug: string;
  label: string;
}

export interface NavGroup {
  label: string;
  items: NavLink[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "PLAY",
    items: [
      { slug: "dashboard", label: "OVERVIEW" },
      { slug: "explore", label: "EXPLORE" },
      { slug: "ideas", label: "IDEAS" },
      { slug: "vault", label: "GOALS" },
      { slug: "trials", label: "TRIALS" },
      { slug: "projects", label: "PROJECTS" },
    ],
  },
  {
    label: "ECONOMY",
    items: [
      { slug: "shop", label: "SHOP" },
      { slug: "orders", label: "ORDERS" },
      { slug: "collectibles", label: "COLLECT" },
      { slug: "refers", label: "REFERS" },
      { slug: "calc", label: "CALC" },
    ],
  },
  {
    label: "YOU",
    items: [
      { slug: "report", label: "REPORT" },
      { slug: "account", label: "ACCOUNT" },
    ],
  },
];

// What the mobile dock shows without opening the MORE sheet.
export const MOBILE_PRIMARY = ["dashboard", "projects", "shop", "explore"];

// Whole-pixel <rect>s on a 16x16 grid, ported verbatim from pixl.js's
// ICONS - crisp at the sidebar's small size, one currentColor fill, no
// painted-on detail (it disappears into the fill at this size).
export const ICONS: Record<string, string> = {
  dashboard: `<rect x="7" y="1" width="2" height="2"/><rect x="5" y="3" width="6" height="2"/><rect x="3" y="5" width="10" height="2"/><rect x="3" y="7" width="3" height="7"/><rect x="10" y="7" width="3" height="7"/><rect x="6" y="7" width="4" height="2"/>`,
  shop: `<rect x="5" y="1" width="6" height="2"/><rect x="5" y="3" width="2" height="2"/><rect x="9" y="3" width="2" height="2"/><rect x="3" y="5" width="10" height="9"/>`,
  orders: `<rect x="3" y="2" width="10" height="2"/><rect x="3" y="12" width="10" height="2"/><rect x="3" y="2" width="2" height="12"/><rect x="11" y="2" width="2" height="12"/><rect x="6" y="6" width="4" height="2"/><rect x="6" y="9" width="4" height="2"/>`,
  refers: `<rect x="3" y="3" width="4" height="4"/><rect x="1" y="8" width="8" height="6"/><rect x="9" y="4" width="6" height="2"/><rect x="11" y="2" width="2" height="6"/>`,
  collectibles: `<rect x="4" y="3" width="8" height="2"/><rect x="2" y="5" width="12" height="2"/><rect x="4" y="7" width="8" height="2"/><rect x="6" y="9" width="4" height="2"/><rect x="7" y="11" width="2" height="2"/>`,
  explore: `<rect x="5" y="2" width="6" height="2"/><rect x="3" y="4" width="2" height="2"/><rect x="11" y="4" width="2" height="2"/><rect x="2" y="6" width="2" height="4"/><rect x="12" y="6" width="2" height="4"/><rect x="3" y="10" width="2" height="2"/><rect x="11" y="10" width="2" height="2"/><rect x="5" y="12" width="6" height="2"/><rect x="7" y="7" width="2" height="2"/>`,
  ideas: `<rect x="5" y="1" width="6" height="1"/><rect x="4" y="2" width="8" height="6"/><rect x="5" y="8" width="6" height="1"/><rect x="6" y="10" width="4" height="2"/><rect x="6" y="13" width="4" height="2"/>`,
  projects: `<rect x="2" y="3" width="12" height="2"/><rect x="2" y="5" width="2" height="8"/><rect x="12" y="5" width="2" height="8"/><rect x="2" y="11" width="12" height="2"/>`,
  report: `<rect x="3" y="2" width="2" height="12"/><rect x="5" y="3" width="8" height="6"/>`,
  account: `<rect x="5" y="2" width="6" height="5"/><rect x="3" y="9" width="10" height="5"/>`,
  vault: `<rect x="3" y="2" width="10" height="2"/><rect x="3" y="12" width="10" height="2"/><rect x="3" y="4" width="2" height="8"/><rect x="11" y="4" width="2" height="8"/><rect x="7" y="5" width="2" height="6"/><rect x="6" y="7" width="4" height="2"/>`,
  calc: `<rect x="3" y="1" width="10" height="2"/><rect x="3" y="13" width="10" height="2"/><rect x="3" y="1" width="2" height="14"/><rect x="11" y="1" width="2" height="14"/><rect x="5" y="3" width="6" height="3"/><rect x="5" y="8" width="2" height="2"/><rect x="9" y="8" width="2" height="2"/><rect x="5" y="11" width="2" height="2"/><rect x="9" y="11" width="2" height="2"/>`,
  trials: `<rect x="2" y="3" width="12" height="2"/><rect x="2" y="11" width="12" height="2"/><rect x="2" y="3" width="2" height="10"/><rect x="12" y="3" width="2" height="10"/><rect x="7" y="5" width="2" height="1"/><rect x="7" y="7" width="2" height="1"/><rect x="7" y="9" width="2" height="1"/>`,
};

export const MORE_ICON = `<rect x="2" y="2" width="3" height="3"/><rect x="7" y="2" width="3" height="3"/><rect x="12" y="2" width="2" height="3"/><rect x="2" y="7" width="3" height="3"/><rect x="7" y="7" width="3" height="3"/><rect x="12" y="7" width="2" height="3"/><rect x="2" y="12" width="3" height="2"/><rect x="7" y="12" width="3" height="2"/><rect x="12" y="12" width="2" height="2"/>`;
export const RE_ICON = `<path d="M8 1l4 6-4 8-4-8z"/>`;
export const PALETTE_ICON = `<rect x="4" y="2" width="8" height="2"/><rect x="2" y="4" width="2" height="7"/><rect x="12" y="4" width="2" height="6"/><rect x="4" y="11" width="7" height="2"/><rect x="10" y="10" width="2" height="2"/><rect x="5" y="5" width="2" height="2"/><rect x="9" y="5" width="2" height="2"/><rect x="5" y="8" width="2" height="2"/>`;
```

- [ ] **Step 3: Write the interactive nav Client Component**

The mobile MORE sheet and the theme picker dropdown are the only genuinely
interactive pieces — active-link highlighting derives from `usePathname()`
so future pages need zero wiring to appear correctly highlighted, and the
wallet/restoration numbers arrive as props already computed by the parent
Server Component (Task 7 Step 4). The onboarding-tour help button
(`pixl-help-btn` in `pixl.js`) is intentionally omitted — there's nothing
for it to launch yet (see the migration design doc's addendum: the tour
redesign is deferred to the `projects` slice).

```tsx
// apps/web-shell/app/(shell)/shell-nav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ICONS, MOBILE_PRIMARY, MORE_ICON, NAV_GROUPS, PALETTE_ICON, RE_ICON } from "./nav-data";

const THEMES = [
  { id: "light", label: "Pixl Paper", panel: "#f5eed2", gold: "#ec3750" },
  { id: "dark", label: "Pixl Ink", panel: "#171615", gold: "#ff6b4a" },
];

function Icon({ svg }: { svg: string }) {
  return (
    <span
      className="ic"
      dangerouslySetInnerHTML={{
        __html: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${svg}</svg>`,
      }}
    />
  );
}

export function ShellNav({
  game,
  pixels,
  restorationPct,
}: {
  game: string;
  pixels: number;
  restorationPct: number | null;
}) {
  const pathname = usePathname();
  const activeSlug = pathname.split("/").filter(Boolean)[0] ?? "";
  const [sheetOpen, setSheetOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [theme, setThemeState] = useState("light");

  useEffect(() => {
    try {
      setThemeState(localStorage.getItem("pixl_theme_v2") || "light");
    } catch {
      // keep the light default
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!sheetOpen) return;
    function onClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest(".sidebar")) setSheetOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSheetOpen(false);
    }
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [sheetOpen]);

  useEffect(() => {
    if (!themeMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest(".theme-picker")) setThemeMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setThemeMenuOpen(false);
    }
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [themeMenuOpen]);

  function setTheme(id: string) {
    setThemeState(id);
    try {
      localStorage.setItem("pixl_theme_v2", id);
    } catch {
      // best-effort persistence only
    }
    setThemeMenuOpen(false);
  }

  const overflow = NAV_GROUPS.flatMap((g) => g.items.filter((i) => !MOBILE_PRIMARY.includes(i.slug)));

  function navLink(slug: string, label: string, secondary: boolean) {
    return (
      <Link
        key={slug}
        href={`/${slug}/`}
        className={`${slug === activeSlug ? "active" : ""}${secondary ? " secondary" : ""}`}
      >
        <Icon svg={ICONS[slug] ?? ""} />
        <span>{label}</span>
      </Link>
    );
  }

  return (
    <>
      <aside className="sidebar">
        <a className="sb-logo" href={game} title="Back to the game">
          PIXL
        </a>
        <nav className="nav">
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map((i) => navLink(i.slug, i.label, !MOBILE_PRIMARY.includes(i.slug)))}
            </div>
          ))}
          <button
            className={`nav-more${sheetOpen ? " open" : ""}`}
            type="button"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen((v) => !v)}
          >
            <Icon svg={MORE_ICON} />
            <span>MORE</span>
          </button>
          <div className="nav-sheet" hidden={!sheetOpen}>
            <div className="nav-sheet-grid">{overflow.map((i) => navLink(i.slug, i.label, false))}</div>
          </div>
        </nav>
        <div className="sb-foot">
          <a className="btn dark back-to-game" href={game}>
            <span className="arrow">◄</span> BACK TO GAME
          </a>
        </div>
      </aside>
      <div className="toprail">
        {restorationPct !== null && (
          <div className="rest-chip" title="Core Integrity: the community's Restoration progress">
            <span
              className="slot"
              dangerouslySetInnerHTML={{
                __html: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${RE_ICON}</svg>`,
              }}
            />
            <span className="re">{restorationPct}%</span>
            <span className="rl">CORE</span>
          </div>
        )}
        <div className="wallet-chip" title="Your pixels">
          <span className="slot">
            <img src="/img/pixel.png" alt="px" />
          </span>
          <span className="px">{pixels.toLocaleString()}</span>
        </div>
        <div className="theme-picker">
          <button
            className="theme-toggle"
            type="button"
            title="Change theme"
            aria-expanded={themeMenuOpen}
            onClick={() => setThemeMenuOpen((v) => !v)}
          >
            <Icon svg={PALETTE_ICON} />
          </button>
          <div className="theme-menu" hidden={!themeMenuOpen}>
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`theme-opt${t.id === theme ? " active" : ""}`}
                onClick={() => setTheme(t.id)}
              >
                <span className="swatch" style={{ background: t.panel, boxShadow: `inset 0 0 0 2px ${t.gold}` }} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Write the Server Component shell layout**

**Correction found during implementation:** the version below originally
relied on a `body.has-sidebar` CSS class (`padding-left: var(--sidebar);
padding-top: var(--toprail);`, ported into `globals.css` in Task 6) to
push page content right of the fixed-position sidebar and below the
fixed-position toprail — matching how the old vanilla-JS `mountTopbar()`
did it via `document.body.classList.add("has-sidebar")`. That doesn't
work here: only the ROOT layout (`app/layout.tsx`, a different file, out
of scope for this task) renders `<html>`/`<body>` in the App Router: a
nested `(shell)` route-group layout can only control what renders INSIDE
`<body>`, never add a class to `<body>` itself. Without a fix, `<main
className="wrap">` would render with no offset at all, hidden underneath
the fixed sidebar.

The fix (already reflected in the code sample below): a new `.shell-main`
wrapper `<div>` that does the same padding job as `body.has-sidebar`, but
scoped to an element this layout actually controls. This needed one small
CSS addition alongside Task 6's port (not in `pixl.css` — a necessary
adaptation for this app's Server Component architecture, not a
speculative addition): immediately after the existing `body.has-sidebar`
rule in `apps/web-shell/app/globals.css`, add
`.shell-main { padding-left: var(--sidebar); padding-top: var(--toprail); }`,
and inside the existing `@media (max-width: 900px)` block, right after
`body.has-sidebar`'s override there, add
`.shell-main { padding-left: 0; padding-bottom: 64px; }`. `body.has-sidebar`
itself stays in the CSS untouched (dead in this app today, but a faithful,
harmless part of the verbatim `pixl.css` port).

Fetches the wallet + restoration numbers server-side (no client loading
flash), and renders the full-page gate for a signed-out visitor instead of
any page content — matching `pixl.js`'s `gate()` behavior exactly (its CTA
always links to the game, never a web login link, even though a web login
link exists elsewhere; this port keeps that same behavior rather than
redesigning it).

```tsx
// apps/web-shell/app/(shell)/layout.tsx
import { headers } from "next/headers";
import { serverApi } from "@/lib/server-api";
import { getSession } from "@/lib/session";
import { gameUrl } from "@/lib/urls";
import { ShellNav } from "./shell-nav";

interface Wallet {
  pixels: number;
}
interface ActiveEvent {
  type: string;
  target: number;
  progress: number;
}
interface EventsActive {
  events: ActiveEvent[];
}

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const host = (await headers()).get("host") ?? "";
  const game = gameUrl(host);

  if (!session) {
    return (
      <div className="gate">
        <div className="gate-card">
          <img className="gate-splash" src="/img/boot-splash.png" alt="Pixl" />
          <p>
            This page is part of the Pixl world. Hop into the game and walk up to the shop, an NPC, or
            press the shortcut key to open it with your account.
          </p>
          <a className="btn-enter" href={game}>
            Enter the Game
          </a>
        </div>
      </div>
    );
  }

  const [wallet, events] = await Promise.all([
    serverApi<Wallet>("/api/profile/wallet"),
    serverApi<EventsActive>("/api/events/active"),
  ]);
  const pixels = wallet ? Math.round(wallet.pixels) : 0;
  const restoration = (events?.events ?? []).find((e) => e.type === "community_goal" && Number(e.target) > 0);
  const restorationPct = restoration
    ? Math.max(0, Math.min(100, Math.round((restoration.progress / restoration.target) * 100)))
    : null;

  return (
    <>
      <ShellNav game={game} pixels={pixels} restorationPct={restorationPct} />
      <div className="shell-main">
        <main className="wrap">{children}</main>
      </div>
    </>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `bun run --cwd apps/web-shell typecheck`
Expected: no errors. The `.shell-main` wrapper (see Step 4's correction
note above) is what actually offsets page content around the fixed
sidebar/toprail here — `body.has-sidebar` stays in `globals.css` unused,
since a nested `(shell)` layout can't apply a class to `<body>`. Confirm
this looks right visually in Task 9's manual check.

- [ ] **Step 6: Commit**

```bash
git add apps/web-shell/lib/urls.ts "apps/web-shell/app/(shell)"
git commit -m "add the shell layout: sidebar/topbar chrome, wallet + restoration chips"
```

---

### Task 8: The `/dashboard` page

**Files:**
- Create: `apps/web-shell/app/(shell)/dashboard/lib.ts`
- Test: `apps/web-shell/app/(shell)/dashboard/lib.test.ts`
- Create: `apps/web-shell/app/(shell)/dashboard/dashboard.css`
- Create: `apps/web-shell/app/(shell)/dashboard/page.tsx`
- Create: `apps/web-shell/public/dashboard/og.png` (copied)

- [ ] **Step 1: Write the failing tests for the pure dashboard helpers**

```ts
// apps/web-shell/app/(shell)/dashboard/lib.test.ts
import { describe, expect, test } from "bun:test";
import { barTrial, levelBarCells, linkedSeconds, nextStep, shippedSeconds, type Project, type Trial } from "./lib.ts";

describe("nextStep", () => {
  test("a project needing changes outranks everything else", () => {
    const projects: Project[] = [
      { name: "Old one", status: "approved" },
      { name: "Fixer", status: "needs_changes" },
      { name: "Draftee", status: "draft" },
    ];
    expect(nextStep(projects).h).toBe("Fix up Fixer");
  });

  test("a draft outranks a shipped-and-waiting project", () => {
    const projects: Project[] = [
      { name: "In review", status: "shipped" },
      { name: "WIP", status: "draft" },
    ];
    expect(nextStep(projects).h).toBe("Ship WIP");
  });

  test("all shipped, none draft: points at the review queue", () => {
    const projects: Project[] = [{ name: "In review", status: "shipped" }];
    expect(nextStep(projects).h).toBe("You're in the review queue");
  });

  test("no projects at all: points at the first-project doc", () => {
    expect(nextStep([]).href).toBe("/docs/first-project/");
  });

  test("everything approved: invites starting a new one", () => {
    const projects: Project[] = [{ name: "Done", status: "approved" }];
    expect(nextStep(projects).h).toBe("Start your next project");
  });
});

describe("levelBarCells", () => {
  const bands = [
    { throughLevel: 10, rePerLevel: 10 },
    { throughLevel: 50, rePerLevel: 35 },
  ];

  test("half filled halfway through the current band", () => {
    const cells = levelBarCells(bands, 45, 5, 50);
    expect(cells.filter(Boolean).length).toBe(10);
  });

  test("fully filled right at the level-up threshold", () => {
    expect(levelBarCells(bands, 50, 5, 50).every(Boolean)).toBe(true);
  });

  test("empty right after leveling up", () => {
    expect(levelBarCells(bands, 40, 5, 50).some(Boolean)).toBe(false);
  });
});

describe("linkedSeconds / shippedSeconds", () => {
  const stats = {
    connected: true,
    projects: [
      { name: "repo-a", seconds: 3600, secondsSinceCutoff: 1800 },
      { name: "repo-b", seconds: 7200 },
    ],
  };

  test("prefers secondsSinceCutoff when present", () => {
    const p: Project = { name: "P", status: "shipped", hackatime_projects: ["repo-a"] };
    expect(linkedSeconds(p, stats)).toBe(1800);
  });

  test("falls back to seconds with no cutoff figure", () => {
    const p: Project = { name: "P", status: "shipped", hackatime_projects: ["repo-b"] };
    expect(linkedSeconds(p, stats)).toBe(7200);
  });

  test("shippedSeconds excludes drafts", () => {
    const projects: Project[] = [
      { name: "Draft", status: "draft", hackatime_projects: ["repo-a"] },
      { name: "Shipped", status: "shipped", hackatime_projects: ["repo-b"] },
    ];
    expect(shippedSeconds(projects, stats)).toBe(7200);
  });

  test("disconnected stats: everything is zero", () => {
    const p: Project = { name: "P", status: "shipped", hackatime_projects: ["repo-a"] };
    expect(linkedSeconds(p, { connected: false, projects: [] })).toBe(0);
  });
});

describe("barTrial", () => {
  const trials: Trial[] = [
    { id: 1, name: "First", unlocked: true, completed: false },
    { id: 2, name: "Second", unlocked: true, completed: false },
  ];

  test("prefers the trial with a linked project", () => {
    const projects: Project[] = [{ name: "P", status: "draft", sidequest_id: 2 }];
    expect(barTrial(trials, projects)?.name).toBe("Second");
  });

  test("falls back to the first trial with no linked project", () => {
    expect(barTrial(trials, [])?.name).toBe("First");
  });

  test("null with no trials at all", () => {
    expect(barTrial([], [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test "apps/web-shell/app/(shell)/dashboard/lib.test.ts"`
Expected: FAIL — `Cannot find module './lib.ts'`

- [ ] **Step 3: Write `lib.ts`, ported from `apps/game/web/dashboard/index.html`**

```ts
// apps/web-shell/app/(shell)/dashboard/lib.ts
export interface Project {
  name: string;
  status: string;
  is_owner?: boolean;
  sidequest_id?: number | string;
  hackatime_projects?: string[];
}

export interface Trial {
  id: number | string;
  name: string;
  unlocked: boolean;
  completed: boolean;
  min_hours?: number | null;
}

export interface HackatimeProjectStat {
  name: string;
  seconds: number;
  secondsSinceCutoff?: number;
}

export interface HackatimeStats {
  connected: boolean;
  projects: HackatimeProjectStat[];
}

export interface NextStep {
  h: string;
  s: string;
  href: string;
  b: string;
}

// The first match wins, so this reads top-down as "the most useful thing
// right now."
export function nextStep(projects: Project[]): NextStep {
  const has = (s: string) => projects.find((p) => p.status === s);
  const needsWork = has("needs_changes");
  if (needsWork)
    return {
      h: `Fix up ${needsWork.name}`,
      s: "A reviewer sent this one back. Sort what they flagged and ship it again.",
      href: "/projects/",
      b: "OPEN",
    };
  const draft = has("draft");
  if (draft)
    return {
      h: `Ship ${draft.name}`,
      s: "It's still a draft. When it's finished and tracked, send it for review.",
      href: "/projects/",
      b: "OPEN",
    };
  if (has("shipped"))
    return {
      h: "You're in the review queue",
      s: "Nothing to do but wait. Start the next one while you're here.",
      href: "/projects/",
      b: "NEW PROJECT",
    };
  if (projects.length === 0)
    return {
      h: "Start your first project",
      s: "Pick something small and real. The docs walk through the whole thing.",
      href: "/docs/first-project/",
      b: "READ",
    };
  return {
    h: "Start your next project",
    s: "Everything's approved. Pick up a trial or build something of your own.",
    href: "/projects/",
    b: "NEW PROJECT",
  };
}

export function linkedSeconds(p: Project, stats: HackatimeStats | null): number {
  if (!stats?.connected) return 0;
  const linked = new Set(p.hackatime_projects ?? []);
  return stats.projects
    .filter((h) => linked.has(h.name))
    .reduce((s, h) => s + (h.secondsSinceCutoff ?? h.seconds), 0);
}

export function shippedSeconds(projects: Project[], stats: HackatimeStats | null): number {
  return projects
    .filter((p) => p.status && p.status !== "draft")
    .reduce((s, p) => s + linkedSeconds(p, stats), 0);
}

// The Trial the hours bar measures against: the one with a project on it,
// otherwise whichever Trial the player took on first.
export function barTrial(trials: Trial[], projects: Project[]): Trial | null {
  return (
    trials.find((t) => projects.some((p) => Number(p.sidequest_id) === Number(t.id))) ?? trials[0] ?? null
  );
}

export function formatHours(seconds: number): string {
  return `${(seconds / 3600).toFixed(1)}h`;
}

interface LevelBand {
  throughLevel: number;
  rePerLevel: number;
}

// Segmented level-progress bar: fills relative to the CURRENT band, not to
// level 100, so it moves visibly on every ship instead of creeping a pixel
// at a time. One boolean per cell (20 cells, true = filled).
export function levelBarCells(bands: LevelBand[], re: number, level: number, nextAt: number): boolean[] {
  const band = bands.find((b) => level < b.throughLevel) ?? bands[bands.length - 1]!;
  const prevAt = Math.max(0, nextAt - band.rePerLevel);
  const span = Math.max(1, nextAt - prevAt);
  const pct = Math.max(0, Math.min(1, (re - prevAt) / span));
  const cells = 20;
  const on = Math.round(pct * cells);
  return Array.from({ length: cells }, (_, i) => i < on);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test "apps/web-shell/app/(shell)/dashboard/lib.test.ts"`
Expected: PASS (11 tests)

- [ ] **Step 5: Port the dashboard-specific CSS**

**Create** `apps/web-shell/app/(shell)/dashboard/dashboard.css` — copied
verbatim from the `<style>` block in `apps/game/web/dashboard/index.html`
(lines 25-113):

```css
.next { display: flex; align-items: center; justify-content: space-between; gap: 18px;
  flex-wrap: wrap; padding: 20px 22px; margin-top: 22px;
  border-left: 3px solid var(--gold); }
.next-txt { flex: 1; min-width: 240px; }
.next-k { font-family: var(--pixel); font-size: 12px; letter-spacing: 1px;
  text-transform: uppercase; color: var(--gold); margin-bottom: 5px; }
.next-h { font-family: var(--pixel); font-size: 19px; color: var(--ink); letter-spacing: .3px; }
.next-s { font-size: 14px; color: var(--dim); line-height: 1.55; margin-top: 6px; }

.hours { margin-top: 22px; padding: 20px 22px 15px; }
.hours-top { display: flex; align-items: flex-start; justify-content: space-between;
  gap: 18px; flex-wrap: wrap; margin-bottom: 13px; }
.hours-big { font-family: var(--pixel); font-size: 42px; line-height: 1;
  letter-spacing: 1px; color: var(--ink); }
.hours-goal { font-family: var(--pixel); font-size: 27px; line-height: 1.15;
  letter-spacing: 1px; color: var(--gold); text-align: right; }
.hours-sub { font-family: var(--sans); font-size: 13px; letter-spacing: 0;
  color: var(--faint); margin-top: 7px; }
.hours-goal .hours-sub { text-align: right; }
.hours-ticks { display: flex; justify-content: space-between; margin-top: 7px;
  font-family: var(--pixel); font-size: 12px; color: var(--faint); }

.stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px; margin-top: 22px; }
.stat { padding: 16px 18px; }
.stat-k { font-family: var(--pixel); font-size: 11px; letter-spacing: 1px;
  text-transform: uppercase; color: var(--faint); }
.stat-v { font-family: var(--sans); font-weight: 700; font-size: 26px; color: var(--ink);
  margin-top: 6px; font-variant-numeric: tabular-nums; line-height: 1.1; }
.stat-v.gold { color: var(--gold); }
.stat-v.teal { color: var(--teal); }
.stat-s { font-size: 12.5px; color: var(--faint); margin-top: 5px; }

.lvl { margin-top: 22px; padding: 18px 20px; }
.lvl-top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.lvl-n { font-family: var(--pixel); font-size: 17px; color: var(--ink); letter-spacing: .3px; }
.lvl-next { font-size: 12.5px; color: var(--faint); font-variant-numeric: tabular-nums; }
.lvl-bar { display: flex; gap: 3px; margin-top: 12px; }
.lvl-bar i { flex: 1; height: 10px; background: var(--panel-2);
  border: var(--bw) solid var(--stroke); border-radius: 0; }
.lvl-bar i.on { background: var(--gold); border-color: var(--gold); }

.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
@media (max-width: 760px) { .cols { grid-template-columns: 1fr; } }
.panel-h { display: flex; align-items: center; justify-content: space-between; gap: 10px;
  margin-bottom: 12px; }
.panel-h b { font-family: var(--pixel); font-size: 14px; color: var(--ink); letter-spacing: .5px; }
.panel-h a { font-size: 12.5px; color: var(--gold); text-decoration: none; }
.panel-h a:hover { text-decoration: underline; }
.box { padding: 18px 20px; }

.plist { display: flex; flex-direction: column; gap: 8px; }
.prow { display: flex; align-items: center; gap: 10px; text-decoration: none;
  padding: 9px 11px; border: var(--bw) solid var(--stroke); border-radius: 0;
  background: var(--panel-2); }
.prow:hover { border-color: var(--gold); }
.prow .nm { flex: 1; min-width: 0; color: var(--ink); font-size: 14px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag { font-family: var(--pixel); font-size: 10.5px; letter-spacing: .5px;
  padding: 3px 7px; border-radius: 0; border: var(--bw) solid var(--stroke);
  color: var(--faint); flex-shrink: 0; }
.tag.approved { color: var(--teal); border-color: color-mix(in srgb, var(--teal) 45%, var(--stroke)); }
.tag.shipped { color: var(--gold); border-color: color-mix(in srgb, var(--gold) 45%, var(--stroke)); }
.tag.needs_changes { color: #ff8b8b; border-color: rgba(255,139,139,.4); }

.nlist { display: flex; flex-direction: column; gap: 10px; }
.nrow { display: flex; gap: 10px; font-size: 13.5px; color: var(--dim); line-height: 1.5; }
.nrow .dot { width: 6px; height: 6px; border-radius: 0; background: var(--stroke);
  margin-top: 6px; flex-shrink: 0; }
.nrow.unread .dot { background: var(--gold); }
.nrow .when { color: var(--faint); font-size: 12px; white-space: nowrap; }
.quiet { color: var(--faint); font-size: 13.5px; }

.links { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px; margin-top: 16px; }
.links a { display: block; padding: 13px 15px; text-decoration: none;
  border: var(--bw) solid var(--stroke); border-radius: 0; background: var(--panel);
  transition: border-color .13s ease, background .13s ease; }
.links a:hover { border-color: var(--gold); background: var(--panel-2); }
.links .lk { font-family: var(--pixel); font-size: 13px; color: var(--ink); letter-spacing: .4px; }
.links .ls { font-size: 12px; color: var(--faint); margin-top: 4px; line-height: 1.45; }
```

- [ ] **Step 6: Copy the OG image**

```bash
mkdir -p apps/web-shell/public/dashboard
cp apps/game/web/dashboard/og.png apps/web-shell/public/dashboard/og.png
```

- [ ] **Step 7: Write the page**

Entirely a Server Component: every value that used to arrive via a
post-mount `boot()` fetch (and a `.spin` loading state in between) is
fetched and computed before the first byte renders — a real improvement
over the original, not just a port, since there's no loading flash for a
page whose whole job is "show status at a glance." JSX also escapes text
content automatically, so none of the original's `Pixl.esc(...)` calls
are needed.

```tsx
// apps/web-shell/app/(shell)/dashboard/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { config } from "@/app/_generated/config";
import { serverApi } from "@/lib/server-api";
import {
  barTrial,
  formatHours,
  levelBarCells,
  linkedSeconds,
  nextStep,
  shippedSeconds,
  type HackatimeStats,
  type Project,
  type Trial,
} from "./lib";
import "./dashboard.css";

const TITLE = "Pixl · Dashboard";
const DESCRIPTION = "Your Pixl status at a glance: level, Pixels, Restoration Energy and what's next.";
const URL = `${config.urls.site}/dashboard/`;
const IMAGE = `${URL}og.png`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: URL },
  openGraph: {
    type: "website",
    siteName: "Pixl",
    title: TITLE,
    description: DESCRIPTION,
    url: URL,
    images: [{ url: IMAGE, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [IMAGE],
  },
};

interface Wallet {
  pixels: number;
  re: number;
  approvedHours: number;
  level: number;
  reForNextLevel: number;
  maxLevel: number;
}
interface Notification {
  body?: string;
  title?: string;
  read: boolean;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "DRAFT",
  shipped: "IN REVIEW",
  approved: "APPROVED",
  needs_changes: "NEEDS WORK",
  rejected: "REJECTED",
};

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!isFinite(s)) return "";
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default async function DashboardPage() {
  const [wallet, projectsResp, notifsResp, htResp, questsResp] = await Promise.all([
    serverApi<Wallet>("/api/profile/wallet"),
    serverApi<{ projects: Project[] }>("/api/projects"),
    serverApi<{ notifications: Notification[] }>("/api/notifications"),
    serverApi<{ stats: HackatimeStats | null }>("/api/hackatime/stats"),
    serverApi<{ quests: Trial[] }>("/api/sidequests"),
  ]);

  const list = (projectsResp?.projects ?? []).filter((p) => p.is_owner !== false);
  const trials = (questsResp?.quests ?? []).filter((q) => q.unlocked && !q.completed);
  const htStats = htResp?.stats ?? null;
  const step = nextStep(list);
  const trial = barTrial(trials, list);
  const linked = trial ? list.find((p) => Number(p.sidequest_id) === Number(trial.id)) : null;
  const need = trial?.min_hours != null ? Number(trial.min_hours) : 0;
  const secs = linked ? linkedSeconds(linked, htStats) : shippedSeconds(list, htStats);
  const hours = secs / 3600;
  const pct = need ? Math.max(0, Math.min(100, (hours / need) * 100)) : 0;

  const level = wallet?.level ?? 0;
  const nextAt = wallet?.reForNextLevel ?? 0;
  const re = wallet?.re ?? 0;
  const maxLevel = wallet?.maxLevel ?? 100;
  const cells = levelBarCells(config.economy.levelBands, re, level, nextAt);

  const recent = (notifsResp?.notifications ?? []).slice(0, 5);

  return (
    <>
      <h1 className="page-title">OVERVIEW</h1>
      <div className="page-sub">Where you&apos;re at, and what to do next.</div>

      <Link className="next card panel" href={step.href}>
        <span className="next-txt">
          <span className="next-k">Next up</span>
          <span className="next-h">{step.h}</span>
          <span className="next-s">{step.s}</span>
        </span>
        <span className="btn">{step.b}</span>
      </Link>

      {need ? (
        <div className="hours card panel">
          <div className="hours-top">
            <div>
              <div className="hours-big">{formatHours(secs)}</div>
              <div className="hours-sub">{linked ? `on ${linked.name}` : "no project on this Trial yet"}</div>
            </div>
            <div>
              <div className="hours-goal">{need}H TO SHIP</div>
              <div className="hours-sub">{trial!.name}</div>
            </div>
          </div>
          <div className="rbar gold">
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="hours-ticks">
            <span>0</span>
            <span>{Math.round(need / 4)}</span>
            <span>{Math.round(need / 2)}</span>
            <span>{Math.round((need * 3) / 4)}</span>
            <span>{need}</span>
          </div>
        </div>
      ) : (
        <div className="hours card panel">
          <div className="hours-top">
            <div>
              <div className="hours-big">{formatHours(secs)}</div>
              <div className="hours-sub">
                shipped so far{trial ? ` · ${trial.name} has no minimum` : ""}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="stat-row">
        <div className="stat card panel">
          <div className="stat-k">Pixels</div>
          <div className="stat-v gold">{Math.round(wallet?.pixels ?? 0).toLocaleString()}</div>
          <div className="stat-s">to spend in the shop</div>
        </div>
        <div className="stat card panel">
          <div className="stat-k">Restoration Energy</div>
          <div className="stat-v teal">{Math.round(re).toLocaleString()}</div>
          <div className="stat-s">lifetime, never spent</div>
        </div>
        <div className="stat card panel">
          <div className="stat-k">Approved hours</div>
          <div className="stat-v">{Math.round(wallet?.approvedHours ?? 0).toLocaleString()}</div>
          <div className="stat-s">signed off by a reviewer</div>
        </div>
      </div>

      <div className="lvl card panel">
        <div className="lvl-top">
          <span className="lvl-n">LEVEL {level}</span>
          <span className="lvl-next">
            {level >= maxLevel ? "max level" : `${Math.max(0, Math.ceil(nextAt - re))} RE to level ${level + 1}`}
          </span>
        </div>
        <div className="lvl-bar">
          {cells.map((on, i) => (
            <i key={i} className={on ? "on" : ""} />
          ))}
        </div>
      </div>

      <div className="cols">
        <section className="box card panel">
          <div className="panel-h">
            <b>YOUR PROJECTS</b>
            <Link href="/projects/">All projects</Link>
          </div>
          <div className="plist">
            {list.length === 0 ? (
              <div className="quiet">Nothing here yet. Your first project starts on the projects page.</div>
            ) : (
              list.slice(0, 5).map((p, i) => {
                const cls = ["approved", "shipped", "needs_changes"].includes(p.status) ? p.status : "";
                return (
                  <Link key={i} className="prow" href="/projects/">
                    <span className="nm">{p.name || "Untitled"}</span>
                    <span className={`tag ${cls}`}>{STATUS_LABEL[p.status] ?? String(p.status ?? "").toUpperCase()}</span>
                  </Link>
                );
              })
            )}
          </div>
        </section>
        <section className="box card panel">
          <div className="panel-h">
            <b>RECENT</b>
          </div>
          <div className="nlist">
            {recent.length === 0 ? (
              <div className="quiet">Nothing yet. Approvals, invites and orders show up here.</div>
            ) : (
              recent.map((n, i) => (
                <div key={i} className={`nrow ${n.read ? "" : "unread"}`}>
                  <span className="dot" />
                  <span>{n.body || n.title || ""}</span>
                  <span className="when">{timeAgo(n.created_at)}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="links">
        <Link href="/docs/first-project/">
          <span className="lk">FIRST PROJECT</span>
          <span className="ls">The whole loop, start to finish</span>
        </Link>
        <Link href="/docs/rules/">
          <span className="lk">SHIP RULES</span>
          <span className="ls">What the submit button checks</span>
        </Link>
        <Link href="/docs/energy/">
          <span className="lk">RE &amp; LEVELS</span>
          <span className="ls">How your rate actually works</span>
        </Link>
        <Link href="/explore/">
          <span className="lk">EXPLORE</span>
          <span className="ls">See what others shipped</span>
        </Link>
      </div>
    </>
  );
}
```

- [ ] **Step 8: Typecheck and build**

Run: `bun run --cwd apps/web-shell typecheck`
Expected: no errors.

Run: `bun run --cwd apps/web-shell build`
Expected: build succeeds.

- [ ] **Step 9: Commit**

```bash
git add "apps/web-shell/app/(shell)/dashboard" apps/web-shell/public/dashboard
git commit -m "add the /dashboard page, entirely server-rendered"
```

---

### Task 9: Manual end-to-end verification, CLAUDE.md, and the cutover gate

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md's `apps/web-shell` section**

**Modify** `CLAUDE.md` — find the `### \`apps/web-shell\`` section and
replace its bullet list with:

```markdown
### `apps/web-shell` (React migration of the player-facing web shell)
- Next.js 16 App Router, deployed on Orchard (`pixl-web-shell`, no public
  hostname of its own — reached only through `apps/landing/next.config.ts`'s
  `rewrites()`, over the Orchard cluster's internal service DNS). Each page
  family lives at its own literal route segment (`app/docs/[slug]`,
  `app/(shell)/dashboard`, and so on as later slices land) — there is no
  app-wide `basePath` (removed 2026-08-24 once a second family joined docs;
  see `docs/superpowers/specs/2026-08-23-react-migration-design.md`'s
  addendum for why one was ever needed and why it stopped working).
- Auth: an httpOnly `pixl_session` cookie holds the same JWT
  `apps/server` issues. `proxy.ts` catches `?token=` on any request
  (Hack Club Auth redirects back to whatever page login started from, not
  one fixed callback route) and moves it into the cookie. `lib/session.ts`
  verifies it locally (`JWT_SECRET` must match `apps/server`'s exactly).
  Server Components call `apps/server` directly via `lib/server-api.ts`;
  Client Components that need to mutate go through
  `app/api/proxy/[...path]/route.ts` instead, since the cookie is
  unreadable by client JS by design. This only applies to `apps/web-shell`
  — the Godot client and any page still on the old static site
  (`apps/game/web/`) keep using the token-in-localStorage flow unchanged.
- The `(shell)` route group (`app/(shell)/layout.tsx`) renders the
  sidebar/topbar chrome — ported from `apps/game/web/pixl.js`'s
  `mountTopbar()` — around every signed-in page. `app/(shell)/nav-data.ts`
  holds the nav structure; `shell-nav.tsx` is the interactive Client
  Component (mobile sheet, theme picker); the layout itself is a Server
  Component that renders the full-page signed-out gate or fetches the
  wallet/Restoration numbers before the page ever reaches the browser.
- The RE/payout economy formulas (`rePerHour`, `projectPayoutUsd`, etc. in
  `pixl.js`) aren't ported here yet — `/dashboard` only ever displays
  values `apps/server` already computed (wallet pixels/RE/level), it never
  runs the formulas itself. Port them as their own tested module (matching
  `packages/docs-engine/src/tokens.ts`'s pattern: byte-for-byte identical
  to `apps/server`'s own math, this must never drift) when a slice first
  needs to compute a payout number client-side — likely `calc` or `projects`.
- Reads `docs/*.md` directly via `packages/docs-engine`'s `render()`/
  `buildTokens()` (a workspace-package import — this app's Dockerfile uses
  a repo-root build context specifically so that resolves, unlike
  `apps/dashboard`'s isolated per-app context).
- Docker image uses Next's `output: "standalone"` — required in this
  monorepo, not just an optimization: without it, the runtime stage would
  need to drag along the whole workspace's hoisted `node_modules` (Bun
  installs into a shared `/repo/node_modules/.bun/...` store for any
  workspace-package-dependent app, since the install runs against the root
  `package.json`) to keep `apps/web-shell/node_modules`'s symlinks from
  dangling. `output: "standalone"` traces the real dependency graph into
  concrete files instead.
- See `docs/superpowers/specs/2026-08-23-react-migration-design.md` for
  the full migration design (its 2026-08-24 addendum has the slice order
  for everything after docs) and `docs/superpowers/plans/` for the
  per-slice implementation plans.
```

- [ ] **Step 2: Full test suite + typecheck + build**

Run: `bun test apps/web-shell`
Expected: all tests pass (session: 4, proxy route: 3, dashboard lib: 11, plus the existing docs tests from the earlier slice).

Run: `bun run --cwd apps/web-shell typecheck`
Expected: no errors.

Run: `bun run --cwd apps/web-shell build`
Expected: build succeeds.

- [ ] **Step 3: Manual end-to-end verification against a real signed-in session**

This is the one thing no automated test in this plan covers: a real Hack
Club Auth round-trip through `proxy.ts` into a page that actually
renders signed-in content.

Run: `bun run --cwd apps/web-shell dev`
1. Visit `http://localhost:4901/dashboard` while signed out. Expected: the
   full-page gate renders ("Enter the Game" linking to `/play`), not the
   dashboard content, not a 500 error.
2. Get a real token: sign into the game normally (or hit
   `apps/server`'s `/auth/hackclub?web_redirect=http://localhost:4901/dashboard`
   directly, completing the real HCA flow) and confirm it lands back on
   `http://localhost:4901/dashboard` with no `?token=` in the URL bar, and
   dev tools shows a `pixl_session` httpOnly cookie.
3. Confirm the dashboard renders real data: your actual pixel count,
   level, approved hours, and project list, matching what
   `https://pixl.hackclub.com/dashboard/` (the old static page) shows for
   the same account.
4. Click the mobile MORE sheet (resize the window under 900px) and the
   theme picker — confirm both open, close on outside click and Escape,
   and the theme picker's choice persists across a reload.
5. Confirm the `.shell-main` layout offset actually looks right (see
   Task 7 Step 4's correction note) — the sidebar/toprail shouldn't
   overlap the page content.

If anything in this step doesn't match, fix it now — this is the
Foundation slice's whole reason to exist, and every later slice inherits
whatever's wrong here.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "document apps/web-shell's routing, auth, and shell layout in CLAUDE.md"
```

- [ ] **Step 5: Stop — do not repoint `/dashboard` in `apps/landing/next.config.ts` yet**

Per the migration design doc's ground rules, cutting a family's rewrite
over to `apps/web-shell` for real players needs explicit sign-off, the
same caution the docs slice's own cutover step used. Report Step 3's
manual verification results and ask before adding `/dashboard`'s rewrite
to `apps/landing/next.config.ts`'s `SHELL_PATHS` → `WEB_SHELL_ORIGIN`
repoint. Slice 2's plan (collectibles + account + trials) gets written
once this slice is confirmed working end-to-end.
