"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { PixelIcon } from "@/components/pixel-icon";
import { useDismiss } from "@/components/display-controls";
import { TopRail } from "@/components/top-rail";
import { Button, buttonVariants } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { clearPlayerLocalState } from "@/lib/local-state";
import { ICONS, MOBILE_PRIMARY, MORE_ICON, NAV_GROUPS } from "./nav-data";

// Below 900px the sidebar becomes a bottom dock: secondary links hide there
// and open from the MORE sheet instead.
const navLinkClass = cn(
  "group flex items-center gap-[10px] border-2 border-transparent px-[10px] py-[6px]",
  "font-pixel text-[14.5px] font-medium tracking-[.8px] text-ink",
  // Hover only adds a background; text stays pinned so the base a:hover gold doesn't show through.
  "transition-[background-color] duration-[130ms] hover:bg-panel-2 hover:text-ink",
  "data-[active=true]:border-stroke data-[active=true]:bg-accent data-[active=true]:text-panel-deep",
  "data-[active=true]:hover:bg-accent data-[active=true]:hover:text-panel-deep",
  "max-[900px]:flex-1 max-[900px]:flex-col max-[900px]:justify-center max-[900px]:gap-[3px] max-[900px]:border-0",
  "max-[900px]:px-[2px] max-[900px]:pt-[8px] max-[900px]:pb-[6px] max-[900px]:text-center",
  "max-[900px]:text-[10px] max-[900px]:tracking-[.5px]",
  "max-[900px]:data-[active=true]:bg-transparent max-[900px]:data-[active=true]:text-accent",
  "max-[900px]:data-[active=true]:shadow-[inset_0_3px_0_var(--accent)]",
  "max-[900px]:data-[active=true]:hover:bg-panel-2 max-[900px]:data-[active=true]:hover:text-accent",
);
const navIconClass = cn(
  "flex size-[26px] shrink-0 items-center justify-center border-2 border-stroke bg-panel-deep text-ink",
  "transition-[background-color,color] duration-[130ms] [&_svg]:size-[14px] [&_svg]:shrink-0",
  "max-[900px]:size-auto max-[900px]:border-0 max-[900px]:bg-transparent max-[900px]:text-current",
  "max-[900px]:[&_svg]:size-[20px]",
);
// Links inside the mobile MORE sheet.
const sheetLinkClass = cn(
  "flex flex-col items-center justify-center gap-[5px] border-2 border-stroke bg-panel-deep px-[4px] py-[12px]",
  "text-center font-pixel text-[11px] font-medium tracking-[.5px] text-ink",
  "transition-[background-color] duration-[130ms] hover:bg-panel-2 hover:text-ink",
  "data-[active=true]:bg-accent data-[active=true]:text-panel-deep",
  "data-[active=true]:hover:bg-accent data-[active=true]:hover:text-panel-deep",
);

export function ShellNav({
  game,
  displayName,
  pixels,
  re,
  communityRe,
}: {
  game: string;
  displayName: string;
  pixels: number;
  re: number;
  communityRe: number;
}) {
  const pathname = usePathname();
  // Leaderboard lives under /explore but has its own nav entry.
  const activeSlug = pathname.startsWith("/explore/leaderboard")
    ? "leaderboard"
    : (pathname.split("/").filter(Boolean)[0] ?? "");
  const [sheetOpen, setSheetOpen] = useState(false);
  useDismiss(sheetOpen, "[data-shell-sidebar]", () => setSheetOpen(false));


  const overflow = NAV_GROUPS.flatMap((g) => g.items.filter((i) => !MOBILE_PRIMARY.includes(i.slug)));

  function navLink(slug: string, label: string, href: string, secondary: boolean) {
    return (
      <Link
        key={slug}
        href={href}
        data-active={slug === activeSlug}
        className={cn(navLinkClass, secondary && "max-[900px]:hidden")}
      >
        <PixelIcon rects={ICONS[slug] ?? []} className={navIconClass} />
        <span>{label}</span>
      </Link>
    );
  }

  return (
    <>
      <aside
        data-shell-sidebar
        className={cn(
          "fixed top-0 bottom-0 left-0 z-40 flex w-(--sidebar) flex-col gap-[4px] border-r-4 border-stroke bg-panel",
          "px-[12px] py-[16px]",
          "max-[900px]:top-auto max-[900px]:right-0 max-[900px]:h-[60px] max-[900px]:w-auto max-[900px]:flex-row",
          "max-[900px]:gap-[2px] max-[900px]:border-t-4 max-[900px]:border-r-0 max-[900px]:px-[6px] max-[900px]:py-0",
        )}
      >
        <Link
          className={cn(
            "mb-[6px] flex items-center px-[8px] pt-[6px] pb-[16px] font-pixel text-[26px] font-semibold",
            "tracking-[1.5px] text-ink hover:text-gold-soft max-[900px]:hidden",
          )}
          href="/dashboard"
          title="Pixl Dashboard"
        >
          PIXL
        </Link>
        <nav
          className={cn(
            "flex flex-1 flex-col gap-[16px] overflow-y-auto",
            "max-[900px]:flex-row max-[900px]:justify-around max-[900px]:gap-[2px] max-[900px]:overflow-visible",
          )}
        >
          {NAV_GROUPS.map((group) => (
            <div className="flex flex-col gap-[2px] max-[900px]:contents" key={group.label}>
              <div
                className={cn(
                  "mb-[4px] px-[10px] font-pixel text-[10.5px] font-semibold tracking-[2.5px] text-muted",
                  "max-[900px]:hidden",
                )}
              >
                {group.label}
              </div>
              {group.items.map((i) => navLink(i.slug, i.label, i.href, !MOBILE_PRIMARY.includes(i.slug)))}
            </div>
          ))}
          <button
            className={cn(
              "hidden flex-1 flex-col items-center justify-center gap-[3px] max-[900px]:flex",
              "border-0 bg-transparent px-[2px] pt-[8px] pb-[6px] font-pixel text-[10px] tracking-[.5px] text-faint",
              "transition-colors duration-[130ms] [&_svg]:size-[20px]",
              sheetOpen && "text-accent shadow-[inset_0_3px_0_var(--accent)]",
            )}
            type="button"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen((v) => !v)}
          >
            <PixelIcon rects={MORE_ICON} />
            <span>MORE</span>
          </button>
          {sheetOpen ? (
            <div
              className={cn(
                "fixed right-0 bottom-[60px] left-0 z-[41] hidden animate-sheet-up border-t-4 border-stroke bg-panel",
                "px-[8px] pt-[10px] pb-[calc(10px+env(safe-area-inset-bottom,0px))] max-[900px]:block",
              )}
            >
              <div className="grid grid-cols-3 gap-[6px]">
                {overflow.map((i) => (
                  <Link key={i.slug} href={i.href} data-active={i.slug === activeSlug} className={sheetLinkClass}>
                    <PixelIcon rects={ICONS[i.slug] ?? []} className="[&_svg]:size-[20px]" />
                    <span>{i.label}</span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </nav>
        <div className="mt-[6px] flex flex-col gap-[8px] max-[900px]:hidden">
          <a
            className={cn(
              buttonVariants({ variant: "dark" }),
              "bg-game-cta text-game-cta-ink hover:bg-[color-mix(in_srgb,var(--game-cta)_85%,#fff)] hover:text-game-cta-ink",
            )}
            href={game}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>◄</span>{" "}
            PLAY THE GAME
          </a>
          {/* Clears journal drafts and tour progress from this browser, then posts. */}
          <form action="/api/auth/logout" method="post" onSubmit={() => clearPlayerLocalState()}>
            <Button variant="ghost" className="w-full" type="submit" title={`Signed in as ${displayName}`}>
              LOG OUT
            </Button>
          </form>
        </div>
      </aside>
      <TopRail stats={{ pixels, re, communityRe }} />
    </>
  );
}
