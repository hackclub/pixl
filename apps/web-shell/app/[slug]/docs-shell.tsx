"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { NavItem } from "@/lib/docs";

const OPEN_KEY = "pixl-docs-open-groups";
const THEMES = [
  { id: "light", label: "Pixl Paper", panel: "#f5eed2", gold: "#ec3750" },
  { id: "dark", label: "Pixl Ink", panel: "#171615", gold: "#ff6b4a" },
];

function groupNav(nav: NavItem[]): { label: string; items: NavItem[] }[] {
  const groups: { label: string; items: NavItem[] }[] = [];
  for (const item of nav) {
    const last = groups[groups.length - 1];
    if (last && last.label === item.group) last.items.push(item);
    else groups.push({ label: item.group, items: [item] });
  }
  return groups;
}

export function DocsShell({
  nav,
  activeSlug,
  headings,
  children,
}: {
  nav: NavItem[];
  activeSlug: string;
  headings: { id: string; text: string }[];
  children: React.ReactNode;
}) {
  const groups = groupNav(nav);
  const activeGroup = groups.find((g) => g.items.some((i) => i.slug === activeSlug))?.label;

  const [open, setOpen] = useState<Set<string>>(() => new Set(activeGroup ? [activeGroup] : []));
  const [backHref, setBackHref] = useState("/dashboard/");
  const [theme, setThemeState] = useState("light");
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeHeading, setActiveHeading] = useState(headings[0]?.id ?? "");

  // Groups opened by hand persist across a fresh page load via localStorage;
  // the group holding the CURRENT page is always forced open on top of that
  // saved set, regardless of history — this state lives in a layout that
  // doesn't remount on client-side navigation between doc pages, which is
  // the actual fix for the bug this migration exists to fix (the old static
  // site had no client router, so this same localStorage read had to run
  // fresh on every single full page load).
  useEffect(() => {
    try {
      const saved = new Set<string>(JSON.parse(localStorage.getItem(OPEN_KEY) || "[]"));
      if (activeGroup) saved.add(activeGroup);
      setOpen(saved);
    } catch {
      // malformed storage - fall back to just the active group
      if (activeGroup) setOpen(new Set([activeGroup]));
    }
  }, [activeGroup]);

  useEffect(() => {
    try {
      const ref = document.referrer;
      if (ref && new URL(ref).origin === location.origin && !/\/docs(\/|$)/.test(new URL(ref).pathname)) {
        setBackHref(ref);
      }
    } catch {
      // keep the /dashboard/ default
    }
  }, []);

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
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest(".theme-picker")) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (headings.length === 0) return;
    function markToc() {
      const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
      if (atBottom) {
        setActiveHeading(headings[headings.length - 1]!.id);
        return;
      }
      let current = headings[0]!.id;
      for (const h of headings) {
        const el = document.getElementById(h.id);
        if (el && el.getBoundingClientRect().top <= 96) current = h.id;
      }
      setActiveHeading(current);
    }
    window.addEventListener("scroll", markToc, { passive: true });
    markToc();
    return () => window.removeEventListener("scroll", markToc);
  }, [headings]);

  function toggleGroup(label: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      } catch {
        // best-effort persistence only
      }
      return next;
    });
  }

  function setTheme(id: string) {
    setThemeState(id);
    try {
      localStorage.setItem("pixl_theme_v2", id);
    } catch {
      // best-effort persistence only
    }
    setMenuOpen(false);
  }

  return (
    <div className="docs">
      <aside className="docs-nav">
        <div className="docs-nav-head">
          {/* Plain <a>, not Link: /play is outside basePath entirely (a
              different proxied app), so it must not get "/docs" prepended. */}
          <a className="docs-brand" href="/play">
            <img src="/docs/icon.svg" alt="" />
            PIXL <span>DOCS</span>
          </a>
          <div className="theme-picker">
            <button
              className="theme-toggle"
              type="button"
              aria-label="Change theme"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <svg viewBox="0 0 16 16" fill="currentColor">
                <rect x="4" y="2" width="8" height="2" />
                <rect x="2" y="4" width="2" height="7" />
                <rect x="12" y="4" width="2" height="6" />
                <rect x="4" y="11" width="7" height="2" />
                <rect x="10" y="10" width="2" height="2" />
                <rect x="5" y="5" width="2" height="2" />
                <rect x="9" y="5" width="2" height="2" />
                <rect x="5" y="8" width="2" height="2" />
              </svg>
            </button>
            {menuOpen && (
              <div className="theme-menu">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    className={`theme-opt${t.id === theme ? " active" : ""}`}
                    type="button"
                    onClick={() => setTheme(t.id)}
                  >
                    <span
                      className="swatch"
                      style={{ background: t.panel, boxShadow: `inset 0 0 0 2px ${t.gold}` }}
                    />
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <button
          className="btn dark"
          type="button"
          style={{ margin: "0 6px 16px", justifyContent: "center" }}
          onClick={() => (location.href = backHref)}
        >
          ◄ BACK
        </button>
        <nav>
          {groups.map((g) => (
            <div key={g.label} className={`docs-group${open.has(g.label) ? "" : " collapsed"}`}>
              <button className="docs-group-head" type="button" onClick={() => toggleGroup(g.label)}>
                <span className="g-title">{g.label}</span>
                <span className="count">{g.items.length}</span>
                <span className="chev">▼</span>
              </button>
              <div className="docs-group-items">
                {g.items.map((i) => (
                  <Link
                    key={i.slug}
                    className={`section-link${i.slug === activeSlug ? " active" : ""}`}
                    href={`/${i.slug}/`}
                  >
                    {i.title}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <main className="docs-main">{children}</main>

      <aside className={`docs-toc${headings.length >= 2 ? "" : " empty"}`}>
        {headings.length >= 2 && (
          <>
            <div className="docs-toc-h">On this page</div>
            {headings.map((h) => (
              <a
                key={h.id}
                href={`#${h.id}`}
                className={h.id === activeHeading ? "active" : ""}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                {h.text}
              </a>
            ))}
          </>
        )}
      </aside>
    </div>
  );
}
