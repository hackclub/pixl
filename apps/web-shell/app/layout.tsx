import type { Metadata } from "next";
import { Pixelify_Sans, Poppins } from "next/font/google";
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

export const metadata: Metadata = {
  title: "Pixl",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${poppins.variable} ${pixelifySans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
