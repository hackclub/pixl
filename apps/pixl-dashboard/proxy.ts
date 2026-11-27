import { NextRequest, NextResponse } from "next/server";

// Runs before every page render. Two jobs:
//   1. a per-request nonce-based Content-Security-Policy (Next attaches the
//      nonce to its own scripts automatically, see
//      node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md)
//   2. forward the requested path so the signed-out gate can build a
//      login link that returns to the same page without client JS.
//
// Session tokens never arrive in the URL anymore (the old ?token= capture is
// gone): /api/auth/callback is the only place a session cookie is set.

export function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // React renders style="" attributes during SSR; those can't carry a nonce.
    "style-src 'self' 'unsafe-inline'",
    // Shop/project images are admin- or player-supplied https URLs.
    "img-src 'self' data: blob: https:",
    "media-src 'self'",
    "font-src 'self'",
    // The browser never talks to apps/server directly; everything goes
    // through this app's own server.
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

// ── Landing locale detection (moved from apps/landing/proxy.ts) ──
// Only for a first visit to "/": guess the visitor's language and send them
// to /fr, /es, /pt or /hi. A `pixl_locale` cookie (set here on that first
// visit, and by the landing's LanguageSwitcher on an explicit choice) stops
// it from ever overriding the visitor again. Kept in sync by hand with
// app/_landing/dictionaries.ts, which is server-only and can't be imported.
export const LANDING_LOCALES = ["en", "fr", "es", "pt", "hi"] as const;
const LOCALE_COOKIE = "pixl_locale";

const COUNTRY_LOCALE: Record<string, string> = {
  FR: "fr",
  ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es", VE: "es",
  EC: "es", GT: "es", CU: "es", BO: "es", DO: "es", HN: "es", PY: "es",
  SV: "es", NI: "es", CR: "es", PA: "es", UY: "es", PR: "es",
  PT: "pt", BR: "pt", AO: "pt", MZ: "pt",
  IN: "hi",
};

export function detectLocale(country: string | null, acceptLanguage: string | null): string {
  const byCountry = country ? COUNTRY_LOCALE[country.toUpperCase()] : undefined;
  if (byCountry) return byCountry;
  if (!acceptLanguage) return "en";
  const preferred = acceptLanguage
    .split(",")
    .map((s) => {
      const [tag, q = "1"] = s.trim().split(";q=");
      return { tag: tag.split("-")[0].toLowerCase(), q: parseFloat(q) || 0 };
    })
    .sort((a, b) => b.q - a.q);
  for (const p of preferred) {
    if ((LANDING_LOCALES as readonly string[]).includes(p.tag)) return p.tag;
  }
  return "en";
}

function localeRedirect(req: NextRequest): NextResponse | null {
  if (req.nextUrl.pathname !== "/" || req.method !== "GET") return null;
  if (req.cookies.has(LOCALE_COOKIE)) return null;
  const locale = detectLocale(
    // Cloudflare sits in front of pixl.hackclub.com.
    req.headers.get("cf-ipcountry"),
    req.headers.get("accept-language"),
  );
  if (locale === "en") return null;
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}`;
  const res = NextResponse.redirect(url, 307);
  res.cookies.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return res;
}

// Emergency protection for the OAuth callback: Next.js still receives the
// request, but requests above this per-process ceiling never hit the token
// exchange handler. This is an availability guard, NOT an edge/WAF limit.
// Deploy an edge rate limit too; replicas each have their own counter.
export function createFixedWindowLimiter(limit: number, windowMs: number) {
  let window = -1;
  let count = 0;
  return (now: number = Date.now()): boolean => {
    const nextWindow = Math.floor(now / windowMs);
    if (nextWindow !== window) {
      window = nextWindow;
      count = 0;
    }
    if (count >= limit) return false;
    count += 1;
    return true;
  };
}

const allowAuthCallback = createFixedWindowLimiter(60, 1000);
const allowExpiredSession = createFixedWindowLimiter(20, 1000);

export function proxy(req: NextRequest) {
  // Under a callback flood, return a cheap, uncached 429 *before* CSP
  // generation and before the callback route can call /auth/exchange.
  if ((req.nextUrl.pathname === "/api/auth/callback" && !allowAuthCallback()) ||
      (req.nextUrl.pathname === "/api/auth/expired" && !allowExpiredSession())) {
    return new NextResponse(null, {
      status: 429,
      headers: {
        "cache-control": "no-store",
        "retry-after": "2",
      },
    });
  }

  const redirect = localeRedirect(req);
  if (redirect) return redirect;

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");

  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  headers.set("x-pixl-path", req.nextUrl.pathname + req.nextUrl.search);

  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  // First English visit to "/": remember it so detection never runs again.
  if (req.nextUrl.pathname === "/" && !req.cookies.has(LOCALE_COOKIE)) {
    res.cookies.set(LOCALE_COOKIE, "en", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  return res;
}

// Skips ONLY real static prefixes and a few exact metadata files. It used to
// skip any path whose last segment had a dot, which let a page route like
// /form/review.x render with no CSP at all. Public files outside these
// prefixes (e.g. /logo.png) just get a CSP header they don't need, and
// anything the proxy doesn't cover still gets next.config.ts's static
// fallback CSP. Must stay a literal (statically analyzed at build time).
export const config = {
  matcher: [
    {
      source:
        "/((?!api/|_next/static/|_next/image|img/|fonts/|favicon\\.ico$|icon\\.png$|robots\\.txt$|sitemap\\.xml$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    { source: "/api/auth/callback" },
    { source: "/api/auth/expired" },
  ],
};
