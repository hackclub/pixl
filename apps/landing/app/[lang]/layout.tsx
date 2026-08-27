import type { Metadata } from "next";
import { Geist_Mono, Poppins } from "next/font/google";
import "../globals.css";
import { SmoothScroll } from "../_components/SmoothScroll";
import { EasterEgg } from "../_components/EasterEgg";
import { LocaleProvider } from "../_components/LocaleProvider";
import { defaultLocale, getDictionary, hasLocale, locales } from "./dictionaries";
import { config } from "../_generated/config";

// Poppins carries every bit of copy that isn't the pixel display face. It has
// no variable cut on Google Fonts, so the weights we actually use are listed.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const locale = hasLocale(lang) ? lang : defaultLocale;
  const dict = await getDictionary(locale);
  return {
    title: dict.meta.title,
    description: dict.meta.description,
    metadataBase: new URL(config.urls.site),
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(locales.map((l) => [l, `/${l}`])),
    },
    openGraph: {
      title: dict.meta.title,
      description: dict.meta.description,
      url: `${config.urls.site}/${locale}`,
      siteName: "Pixl",
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

export async function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export default async function RootLayout({
  children,
  params,
}: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  // The layout renders before the page's notFound() check, so fall back to the
  // default dictionary rather than throwing on an unknown locale segment.
  const locale = hasLocale(lang) ? lang : defaultLocale;
  const dict = await getDictionary(locale);
  return (
    <html
      lang={locale}
      className={`${poppins.variable} ${geistMono.variable} antialiased`}
    >
      <body className="flex flex-col">
        <LocaleProvider dict={dict} lang={locale}>
          <SmoothScroll>{children}</SmoothScroll>
          <EasterEgg />
        </LocaleProvider>
      </body>
    </html>
  );
}
