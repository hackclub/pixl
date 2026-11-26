"use client";

// The font toggle and theme picker, shared by the dashboard's top rail and
// the docs sidebar so both pages offer the same options and store them in
// the same localStorage keys (read before paint by app/layout.tsx).
import { useEffect, useState } from "react";
import { FONT_ICON, PALETTE_ICON } from "@/app/(shell)/nav-data";
import { PixelIcon } from "@/components/pixel-icon";
import { railButton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

const DARK_PALETTES = [
  { id: "cabinet", label: "Cabinet", swatches: ["#121a23", "#68c7cb", "#ffad68"] },
  { id: "graphite", label: "Graphite Arcade", swatches: ["#151715", "#fc7059", "#f4a45f"] },
];

const themeOption = cn(
  "flex w-full items-center gap-[9px] border-none bg-transparent px-[11px] py-[8px] text-left",
  "font-pixel text-[13.5px] tracking-[.3px] whitespace-nowrap text-ink transition-colors duration-[120ms]",
  "hover:bg-accent hover:text-panel-deep",
);
const themeOptionSelected = "bg-theme-selected text-theme-selected-ink hover:bg-theme-selected";

export function useDismiss(open: boolean, selector: string, close: () => void) {
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

function Swatches({ colors }: { colors: string[] }) {
  return (
    <span aria-hidden className="flex shrink-0 border border-stroke">
      {colors.map((color) => (
        <span key={color} className="size-[11px] border-r border-stroke last:border-r-0" style={{ backgroundColor: color }} />
      ))}
    </span>
  );
}

export function DisplayControls() {
  const [menuOpen, setMenuOpen] = useState(false);
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

  useDismiss(menuOpen, "[data-theme-picker]", () => setMenuOpen(false));

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
    setMenuOpen(false);
  }

  const selectedTheme = theme === "light" ? "light" : darkPalette;

  return (
    <>
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
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <PixelIcon rects={PALETTE_ICON} />
        </button>
        {menuOpen ? (
          <div
            className={cn(
              "absolute top-[calc(100%+6px)] right-0 z-60 flex min-w-[200px] flex-col overflow-hidden",
              "border-2 border-stroke bg-panel shadow-drop",
            )}
          >
            <button
              type="button"
              aria-pressed={selectedTheme === "light"}
              className={cn(themeOption, selectedTheme === "light" && themeOptionSelected)}
              onClick={() => setTheme("light")}
            >
              <Swatches colors={["#f5eed2", "#ec3750", "#ff8c37"]} />
              <span>Pixl Paper</span>
            </button>
            <div aria-hidden className="h-[2px] bg-stroke" />
            {DARK_PALETTES.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={selectedTheme === t.id}
                className={cn(themeOption, selectedTheme === t.id && themeOptionSelected)}
                onClick={() => setTheme(t.id)}
              >
                <Swatches colors={t.swatches} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
