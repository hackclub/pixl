import type { Metadata } from "next";
import { JetBrains_Mono, Pixelify_Sans, Poppins } from "next/font/google";
import "./globals.css";

// next/font self-hosts the font files at build time (served from this app's
// own origin, not fonts.googleapis.com) - a plain <link> to Google Fonts got
// silently mangled into a no-op <link rel="preload"> by Cloudflare's
// automatic font optimization on pixl.hackclub.com, which is what left every
// heading and nav label rendering in the browser's default font in
// production. This sidesteps that layer entirely.
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});
const pixelifySans = Pixelify_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-pixelify-sans",
  display: "swap",
});
// No weight list: JetBrains Mono ships as a variable font, so one file covers
// the regular body of a code block and the 600/700 hljs picks out for
// sections and strong text.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pixl",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${poppins.variable} ${pixelifySans.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
