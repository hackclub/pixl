import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { getAccess, canView, isReportViewer, isHelper, isFulfiller } from "@/lib/guard";
import { countPendingReviews, countOpenReports, countPendingOrders } from "@/lib/db";
import { ticketStats } from "@/lib/tickets";
import { Shell } from "@/app/_components/Shell";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const jetbrainsMonoHeading = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-heading",
});

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Pixl HQ",
  description: "The Pixl team's home for reviews, players, and pixels",
  // Internal admin tool , keep it out of search entirely so it never competes
  // with pixl.hackclub.com (the actual landing page) for "pixl hackclub".
  // Deliberately not paired with a robots.txt disallow: that would stop
  // Google from crawling the page at all, which means it can never see this
  // noindex tag and drop an already-indexed URL from its results.
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await getAccess();
  const session = access?.session ?? null;
  const reportViewer = await isReportViewer();
  const helper = await isHelper();
  const fulfiller = await isFulfiller();
  const nav = access
    ? {
        overview: access.isSuper,
        players: canView(access, ["warn", "ban"]),
        projects: canView(access, ["review", "warn", "ban"]),
        review: canView(access, ["review"]),
        pixels: canView(access, ["pixels"]),
        moderation: canView(access, ["warn", "ban"]),
        ideas: canView(access, ["ideas"]),
        reports: reportViewer,
        tickets: helper,
        notify: access.isSuper || access.perms.has("notify"),
        admins: access.isSuper,
        reviewers: access.isSuper,
        slackLookup: canView(access, ["lookup"]),
        referrals: canView(access, ["referrals"]),
        online: canView(access, ["warn", "ban"]),
        shop: canView(access, ["shop"]),
        events: canView(access, ["events"]),
        sidequests: canView(access, ["sidequests"]),
        story: canView(access, ["story"]),
        goals: canView(access, ["goals"]),
        news: canView(access, ["news"]),
        showNTell: canView(access, ["show_n_tell"]),
        fulfillment: fulfiller,
      }
    : null;
  const reviewCount =
    nav?.review && access
      ? await countPendingReviews({
          viewer: access.session.slackId,
          canSecondPass: access.canSecondPass,
        })
      : 0;
  const reportCount = reportViewer ? await countOpenReports() : 0;
  const ticketCount = helper ? (await ticketStats()).open : 0;
  const orderCount = nav?.fulfillment ? await countPendingOrders() : 0;
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        geist.variable,
        geistMono.variable,
        "font-sans",
        inter.variable,
        jetbrainsMonoHeading.variable,
      )}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function() {
  var html = document.documentElement;
  try {
    var t = localStorage.getItem("theme");
    if (t !== "light") {
      html.classList.add("dark");
    }
  } catch(e) {}
  var scales = [1, 1.15, 1.3];
  var labels = ["A", "A+", "A++"];
  function applyFont(i) {
    html.style.setProperty("--font-scale", scales[i]);
    document.querySelectorAll("[data-font-cycle]").forEach(function(b) {
      b.textContent = labels[i];
    });
  }
  var fi = 0;
  try {
    var saved = parseInt(localStorage.getItem("fontStep") || "0", 10);
    if (saved >= 0 && saved < scales.length) fi = saved;
  } catch(e) {}
  applyFont(fi);
  document.addEventListener("click", function(e) {
    var themeBtn = e.target.closest("[data-theme-toggle]");
    if (themeBtn) {
      html.classList.toggle("dark");
      var dark = html.classList.contains("dark");
      document.querySelectorAll("[data-theme-toggle]").forEach(function(b) {
        b.textContent = dark ? "☀" : "☾";
      });
      try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch(e) {}
      return;
    }
    var fontBtn = e.target.closest("[data-font-cycle]");
    if (fontBtn) {
      fi = (fi + 1) % scales.length;
      applyFont(fi);
      try { localStorage.setItem("fontStep", String(fi)); } catch(e) {}
    }
  });
})();
`,
          }}
        />
      </head>
      <body className="min-h-screen">
        {session && nav ? (
          // <Shell
          //   session={{ name: session.name, slackId: session.slackId }}
          //   nav={nav}
          //   reviewCount={reviewCount}
          // >
          //   {children}
          // </Shell>
          <SidebarProvider>
            <Shell
              session={{ name: session.name, slackId: session.slackId }}
              nav={nav}
              reviewCount={reviewCount}
              reportCount={reportCount}
              ticketCount={ticketCount}
              orderCount={orderCount}
            />

            <main className="flex-1 min-w-0 overflow-x-clip flex flex-col gap-4">
              <div className="bg-command-background/40 backdrop-blur-xl backdrop-saturate-150 shadow-2xl shadow-black/30 w-full h-10 fixed z-100 p-2">
                <SidebarTrigger />
              </div>
              <div className="px-10 pt-10">{children}</div>
            </main>
          </SidebarProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
