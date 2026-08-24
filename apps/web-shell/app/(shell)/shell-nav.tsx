"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ICONS, MOBILE_PRIMARY, MORE_ICON, NAV_GROUPS, PALETTE_ICON, RE_ICON } from "./nav-data";

const THEMES = [
  { id: "light", label: "Pixl Paper", panel: "#f5eed2", gold: "#ec3750" },
  { id: "dark", label: "Pixl Ink", panel: "#171615", gold: "#ff6b4a" },
];

function Icon({ svg }: { svg: string }) {
  return (
    <span
      className="ic"
      dangerouslySetInnerHTML={{
        __html: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${svg}</svg>`,
      }}
    />
  );
}

export function ShellNav({
  game,
  pixels,
  restorationPct,
}: {
  game: string;
  pixels: number;
  restorationPct: number | null;
}) {
  const pathname = usePathname();
  const activeSlug = pathname.split("/").filter(Boolean)[0] ?? "";
  const [sheetOpen, setSheetOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [theme, setThemeState] = useState("light");

  useEffect(() => {
    try {
      setThemeState(localStorage.getItem("pixl_theme_v2") || "light");
    } catch {
      // keep the light default
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!sheetOpen) return;
    function onClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest(".sidebar")) setSheetOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSheetOpen(false);
    }
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [sheetOpen]);

  useEffect(() => {
    if (!themeMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest(".theme-picker")) setThemeMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setThemeMenuOpen(false);
    }
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [themeMenuOpen]);

  function setTheme(id: string) {
    setThemeState(id);
    try {
      localStorage.setItem("pixl_theme_v2", id);
    } catch {
      // best-effort persistence only
    }
    setThemeMenuOpen(false);
  }

  const overflow = NAV_GROUPS.flatMap((g) => g.items.filter((i) => !MOBILE_PRIMARY.includes(i.slug)));

  function navLink(slug: string, label: string, secondary: boolean) {
    return (
      <Link
        key={slug}
        href={`/${slug}/`}
        className={`${slug === activeSlug ? "active" : ""}${secondary ? " secondary" : ""}`}
      >
        <Icon svg={ICONS[slug] ?? ""} />
        <span>{label}</span>
      </Link>
    );
  }

  return (
    <>
      <aside className="sidebar">
        <a className="sb-logo" href={game} title="Back to the game">
          PIXL
        </a>
        <nav className="nav">
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map((i) => navLink(i.slug, i.label, !MOBILE_PRIMARY.includes(i.slug)))}
            </div>
          ))}
          <button
            className={`nav-more${sheetOpen ? " open" : ""}`}
            type="button"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen((v) => !v)}
          >
            <Icon svg={MORE_ICON} />
            <span>MORE</span>
          </button>
          <div className="nav-sheet" hidden={!sheetOpen}>
            <div className="nav-sheet-grid">{overflow.map((i) => navLink(i.slug, i.label, false))}</div>
          </div>
        </nav>
        <div className="sb-foot">
          <a className="btn dark back-to-game" href={game}>
            <span className="arrow">◄</span> BACK TO GAME
          </a>
        </div>
      </aside>
      <div className="toprail">
        {restorationPct !== null && (
          <div className="rest-chip" title="Core Integrity: the community's Restoration progress">
            <span
              className="slot"
              dangerouslySetInnerHTML={{
                __html: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${RE_ICON}</svg>`,
              }}
            />
            <span className="re">{restorationPct}%</span>
            <span className="rl">CORE</span>
          </div>
        )}
        <div className="wallet-chip" title="Your pixels">
          <span className="slot">
            <img src="/img/pixel.png" alt="px" />
          </span>
          <span className="px">{pixels.toLocaleString()}</span>
        </div>
        <div className="theme-picker">
          <button
            className="theme-toggle"
            type="button"
            title="Change theme"
            aria-expanded={themeMenuOpen}
            onClick={() => setThemeMenuOpen((v) => !v)}
          >
            <Icon svg={PALETTE_ICON} />
          </button>
          <div className="theme-menu" hidden={!themeMenuOpen}>
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`theme-opt${t.id === theme ? " active" : ""}`}
                onClick={() => setTheme(t.id)}
              >
                <span className="swatch" style={{ background: t.panel, boxShadow: `inset 0 0 0 2px ${t.gold}` }} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
