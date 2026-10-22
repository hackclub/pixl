"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PixelIcon, ReIcon } from "@/components/pixel-icon";
import { Button, buttonVariants, railButton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { clearPlayerLocalState } from "@/lib/local-state";
import { FONT_ICON, ICONS, MOBILE_PRIMARY, MORE_ICON, NAV_GROUPS, PALETTE_ICON } from "./nav-data";

const DARK_PALETTES = [
  { id: "cabinet", label: "Cabinet", swatches: ["#121a23", "#68c7cb", "#ffad68"] },
  { id: "graphite", label: "Graphite Arcade", swatches: ["#151715", "#fc7059", "#f4a45f"] },
];

// Below 900px the sidebar becomes a bottom dock: secondary links hide there
// and open from the MORE sheet instead.
const navLinkClass = cn(
  "group flex items-center gap-[10px] border-2 border-transparent px-[10px] py-[6px]",
  "font-pixel text-[14.5px] font-medium tracking-[.8px] text-ink",
  // No hover state: the colours are pinned so the base a:hover gold doesn't show through.
  "hover:text-ink",
  "data-[active=true]:border-stroke data-[active=true]:bg-accent data-[active=true]:text-panel-deep",
  "data-[active=true]:hover:text-panel-deep",
  "max-[900px]:flex-1 max-[900px]:flex-col max-[900px]:justify-center max-[900px]:gap-[3px] max-[900px]:border-0",
  "max-[900px]:px-[2px] max-[900px]:pt-[8px] max-[900px]:pb-[6px] max-[900px]:text-center",
  "max-[900px]:text-[10px] max-[900px]:tracking-[.5px]",
  "max-[900px]:data-[active=true]:bg-transparent max-[900px]:data-[active=true]:text-accent",
  "max-[900px]:data-[active=true]:shadow-[inset_0_3px_0_var(--accent)]",
  "max-[900px]:data-[active=true]:hover:text-accent",
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
  "transition-[color,background-color] duration-[130ms] hover:bg-transparent hover:text-accent",
  "data-[active=true]:bg-accent data-[active=true]:text-panel-deep",
  "data-[active=true]:hover:bg-accent data-[active=true]:hover:text-panel-deep",
);

// Currency chips on the top rail.
const chip = cn(
  "flex cursor-default items-center gap-[8px] border-2 border-stroke bg-panel py-[5px] pr-[11px] pl-[6px]",
  "text-[13px] tabular-nums",
);
const chipSlot = "flex size-[24px] shrink-0 items-center justify-center border-2 border-stroke";
const chipValue = "font-sans text-[16px] font-bold tracking-[.2px] text-ink tabular-nums";
const chipLabel = "text-[11px] tracking-[.5px] text-dim";

function useDismiss(open: boolean, selector: string, close: () => void) {
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest(selector)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, selector, close]);
}

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
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [theme, setThemeState] = useState("light");
  const [darkPalette, setDarkPaletteState] = useState("graphite");
  const [themeLoaded, setThemeLoaded] = useState(false);
  const [phantom, setPhantomState] = useState(false);

  useEffect(() => {
    try {
      setThemeState(localStorage.getItem("pixl_theme_v2") === "dark" ? "dark" : "light");
      const savedPalette = localStorage.getItem("pixl_dark_palette_v1");
      const matchingPalette = DARK_PALETTES.find((palette) => palette.id === savedPalette);
      if (matchingPalette) setDarkPaletteState(matchingPalette.id);
    } catch {
      // keep the light default
    }
    setThemeLoaded(true);
    setPhantomState(document.documentElement.dataset.font === "phantom");
  }, []);

  useEffect(() => {
    if (!themeLoaded) return;
    const root = document.documentElement;
    root.dataset.theme = theme;
    if (theme === "dark") root.dataset.palette = darkPalette;
    else delete root.dataset.palette;
  }, [theme, darkPalette, themeLoaded]);

  useDismiss(sheetOpen, "[data-shell-sidebar]", () => setSheetOpen(false));
  useDismiss(themeMenuOpen, "[data-theme-picker]", () => setThemeMenuOpen(false));

  function togglePhantom() {
    const next = !phantom;
    setPhantomState(next);
    if (next) document.documentElement.dataset.font = "phantom";
    else delete document.documentElement.dataset.font;
    try {
      if (next) localStorage.setItem("pixl_font", "phantom");
      else localStorage.removeItem("pixl_font");
    } catch {
      // best-effort persistence only
    }
  }

  function setTheme(id: string) {
    try {
      if (id === "light") {
        setThemeState("light");
        localStorage.setItem("pixl_theme_v2", "light");
      } else if (DARK_PALETTES.some((palette) => palette.id === id)) {
        setThemeState("dark");
        setDarkPaletteState(id);
        localStorage.setItem("pixl_theme_v2", "dark");
        localStorage.setItem("pixl_dark_palette_v1", id);
      }
    } catch {
      // best-effort persistence only
    }
    setThemeMenuOpen(false);
  }

  const overflow = NAV_GROUPS.flatMap((g) => g.items.filter((i) => !MOBILE_PRIMARY.includes(i.slug)));
  const selectedTheme = theme === "light" ? "light" : darkPalette;

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
              "group bg-game-cta text-game-cta-ink hover:bg-game-cta hover:text-game-cta-ink",
            )}
            href={game}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="inline-block transition-transform duration-150 group-hover:-translate-x-[3px]">◄</span>{" "}
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
      <div
        className={cn(
          "fixed top-0 right-0 left-(--sidebar) z-[39] flex h-[54px] items-center justify-end gap-[10px] px-[20px]",
          "border-b-4 border-stroke bg-panel-deep max-[900px]:left-0",
        )}
      >
        <div
          className={cn(chip, "max-[560px]:hidden")}
          title="Core Integrity: total Restoration Energy earned by the whole community"
        >
          <span className={cn(chipSlot, "bg-teal [&_svg]:size-[15px]")}>
            <ReIcon />
          </span>
          <span className={chipValue}>{communityRe.toLocaleString()}</span>
          <span className={chipLabel}>CORE</span>
        </div>
        <div className={chip} title="Your Restoration Energy">
          <span className={cn(chipSlot, "bg-accent text-btn-ink [&_svg]:size-[15px]")}>
            <ReIcon />
          </span>
          <span className={chipValue}>{re.toLocaleString()}</span>
          <span className={cn(chipLabel, "max-[560px]:hidden")}>RE</span>
        </div>
        <div className={chip} title="Your pixels">
          <span className={cn(chipSlot, "bg-gold")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="size-[16px]" src="/img/pixel.png" alt="px" />
          </span>
          <span className={chipValue}>{pixels.toLocaleString()}</span>
        </div>
        <button
          className={cn(
            railButton,
            "aria-pressed:bg-button-dark aria-pressed:text-button-dark-ink aria-pressed:hover:bg-button-dark aria-pressed:hover:text-button-dark-ink",
          )}
          type="button"
          title={phantom ? "Switch back to the default font" : "Switch to Phantom Sans"}
          aria-label="Toggle Phantom Sans font"
          aria-pressed={phantom}
          onClick={togglePhantom}
        >
          <PixelIcon rects={FONT_ICON} />
        </button>
        <div className="relative" data-theme-picker>
          <button
            className={railButton}
            type="button"
            title="Change theme"
            aria-label="Choose color palette"
            aria-expanded={themeMenuOpen}
            onClick={() => setThemeMenuOpen((v) => !v)}
          >
            <PixelIcon rects={PALETTE_ICON} />
          </button>
          {themeMenuOpen ? (
            <div
              className={cn(
                "absolute top-[calc(100%+6px)] right-0 z-60 flex min-w-[200px] flex-col overflow-hidden",
                "border-2 border-stroke bg-panel shadow-drop",
              )}
            >
              <button
                type="button"
                aria-pressed={selectedTheme === "light"}
                className={cn(
                  "flex w-full items-center gap-[9px] border-none bg-transparent px-[11px] py-[8px] text-left",
                  "font-pixel text-[13.5px] tracking-[.3px] whitespace-nowrap text-ink transition-colors duration-[120ms]",
                  "hover:bg-accent hover:text-panel-deep",
                  selectedTheme === "light" && "bg-theme-selected text-theme-selected-ink hover:bg-theme-selected",
                )}
                onClick={() => setTheme("light")}
              >
                <span aria-hidden className="flex shrink-0 border border-stroke">
                  {["#f5eed2", "#ec3750", "#ff8c37"].map((color) => (
                    <span key={color} className="size-[11px] border-r border-stroke last:border-r-0" style={{ backgroundColor: color }} />
                  ))}
                </span>
                <span>Pixl Paper</span>
              </button>
              <div aria-hidden className="h-[2px] bg-stroke" />
              {DARK_PALETTES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={selectedTheme === t.id}
                  className={cn(
                    "flex w-full items-center gap-[9px] border-none bg-transparent px-[11px] py-[8px] text-left",
                    "font-pixel text-[13.5px] tracking-[.3px] whitespace-nowrap text-ink transition-colors duration-[120ms]",
                    "hover:bg-accent hover:text-panel-deep",
                    selectedTheme === t.id && "bg-theme-selected text-theme-selected-ink hover:bg-theme-selected",
                  )}
                  onClick={() => setTheme(t.id)}
                >
                  <span aria-hidden className="flex shrink-0 border border-stroke">
                    {t.swatches.map((color) => (
                      <span key={color} className="size-[11px] border-r border-stroke last:border-r-0" style={{ backgroundColor: color }} />
                    ))}
                  </span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
