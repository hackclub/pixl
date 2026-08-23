import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { locales, defaultLocale } from "./app/[lang]/dictionaries";

// Rough country -> language guess so first-time visitors land in their own
// tongue. Vercel injects x-vercel-ip-country from the edge. Only maps to the
// locales we actually ship; anything else falls through to Accept-Language.
const COUNTRY_LOCALE: Record<string, string> = {
  FR: "fr",
  ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es", VE: "es",
  EC: "es", GT: "es", CU: "es", BO: "es", DO: "es", HN: "es", PY: "es",
  SV: "es", NI: "es", CR: "es", PA: "es", UY: "es", PR: "es",
  PT: "pt", BR: "pt", AO: "pt", MZ: "pt",
  IN: "hi",
};

function getLocale(request: NextRequest): string {
  const country = request.headers.get("x-vercel-ip-country")?.toUpperCase();
  const byCountry = country ? COUNTRY_LOCALE[country] : undefined;
  if (byCountry && (locales as string[]).includes(byCountry)) return byCountry;

  const acceptLang = request.headers.get("accept-language");
  if (!acceptLang) return defaultLocale;

  const preferred = acceptLang
    .split(",")
    .map((s) => {
      const [tag, q = "1"] = s.trim().split(";q=");
      return { tag: tag.split("-")[0], q: parseFloat(q) };
    })
    .sort((a, b) => b.q - a.q);

  for (const p of preferred) {
    if ((locales as string[]).includes(p.tag)) return p.tag;
  }

  return defaultLocale;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const pathnameHasLocale = locales.some(
    (locale) =>
      pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`,
  );

  if (pathnameHasLocale) return;

  const locale = getLocale(request);
  request.nextUrl.pathname = `/${locale}${pathname}`;
  return NextResponse.redirect(request.nextUrl);
}

export const config = {
  // Exclude the game + game-dash paths (rewritten to play.pixl.rsvp in
  // vercel.json) so the locale redirect never rewrites them to /<lang>/….
  matcher: [
    "/((?!_next|favicon|icon|apple-icon|api|shop|orders|collectibles|play|vault|explore|ideas|quests|trials|timeline|projects|report|hackatime|refers|account|calc|docs|dashboard|img|fonts|pixl|index|hero-bg|step-|pixel_|hc-logo|og-boot-splash|world-map|flow-).*)",
  ],
};
