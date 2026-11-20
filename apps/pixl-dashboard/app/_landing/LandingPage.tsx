// The marketing landing page (moved from apps/landing). Rendered at "/" for
// English and at /fr, /es, /pt, /hi by app/[lang]/page.tsx. The root layout
// (app/layout.tsx) owns <html>/<body>; this is just the page body.
import type { Metadata } from "next";
import { config } from "@/app/_generated/config";
import { getDictionary, locales, type Locale } from "./dictionaries";
import { LocaleProvider } from "./components/LocaleProvider";
import { SmoothScroll } from "./components/SmoothScroll";
import { EasterEgg } from "./components/EasterEgg";
import { Menu } from "./components/Menu";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { FontSwitcher } from "./components/FontSwitcher";
import { Hero } from "./components/Hero";
import { ResultsHero } from "./components/ResultsHero";
import { DeadlineSwitch } from "./components/DeadlineSwitch";
import { WTFISTHIS } from "./components/Description";
import { Story } from "./components/Story";
import { MainContent } from "./components/MainContent";
import { FAQ } from "./components/FAQ";
import { Footer } from "./components/Footer";

/** Path for a locale: English is the bare root. */
export function localePath(locale: Locale): string {
  return locale === "en" ? "/" : `/${locale}`;
}

export async function landingMetadata(locale: Locale): Promise<Metadata> {
  const dict = await getDictionary(locale);
  return {
    title: { absolute: dict.meta.title },
    description: dict.meta.description,
    alternates: {
      canonical: localePath(locale),
      languages: Object.fromEntries(locales.map((l) => [l, localePath(l)])),
    },
    openGraph: {
      title: dict.meta.title,
      description: dict.meta.description,
      url: `${config.urls.site}${localePath(locale) === "/" ? "" : localePath(locale)}`,
      siteName: "Pixl",
      locale,
      images: [{ url: "/og-boot-splash-v4.png", width: 1000, height: 650 }],
    },
    twitter: {
      card: "summary_large_image",
      title: dict.meta.title,
      description: dict.meta.description,
      images: ["/og-boot-splash-v4.png"],
    },
  };
}

// The landing was designed for a 16px root (the shell runs at 15px) and is
// always cream whatever the shell theme, so while it is mounted it sets the
// root font size, smooth scrolling and its own fixed scrollbar colour on
// <html> (via html:has(<this root>)), which everything inside inherits.
const landingRoot = [
  "[html:has(&)]:text-[16px] [html:has(&)]:scroll-smooth",
  "[html:has(&)]:[--scroll-thumb:#16161e]",
].join(" ");

export async function LandingPage({ locale }: { locale: Locale }) {
  const dict = await getDictionary(locale);
  return (
    <LocaleProvider dict={dict} lang={locale}>
      <SmoothScroll>
        <div
          lang={locale}
          className={`pixl-landing min-h-screen overflow-x-clip bg-[#F5EED2] font-pixel text-black antialiased ${landingRoot}`}
        >
          <Menu />
          <LanguageSwitcher />
          <FontSwitcher />
          <DeadlineSwitch before={<Hero />} after={<ResultsHero />} />
          <WTFISTHIS />
          <Story />
          <MainContent />
          <FAQ />
          <Footer />
        </div>
      </SmoothScroll>
      <EasterEgg />
    </LocaleProvider>
  );
}
