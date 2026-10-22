"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon, { type GlyphName } from "@hackclub/icons";
import { glyphStyle } from "./glyphs";
import type { NavModel } from "./nav";

interface PlayerHit {
  id: string;
  label: string;
  sub: string;
}
interface ProjectHit {
  id: number;
  label: string;
  sub?: string;
}
interface Hit {
  href: string;
  label: string;
  sub?: string;
  group: string;
  glyph: GlyphName;
}

// Ctrl/Cmd+K: jump to a page, player or project.
export default function CommandPalette({ nav }: { nav: NavModel }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState("");
  const [players, setPlayers] = useState<PlayerHit[]>([]);
  const [projects, setProjects] = useState<ProjectHit[]>([]);
  const [cursor, setCursor] = useState(0);

  function open() {
    dialog.current?.showModal();
  }
  function close() {
    dialog.current?.close();
    setQ("");
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (dialog.current?.open) close();
        else open();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const term = q.trim();
    setCursor(0);
    if (term.length < 2) {
      setPlayers([]);
      setProjects([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const d = (await res.json()) as { players?: PlayerHit[]; projects?: ProjectHit[] };
        setPlayers(d.players ?? []);
        setProjects(d.projects ?? []);
      } catch {
        // aborted by the next keystroke
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const ql = q.trim().toLowerCase();
  const pages: Hit[] = [
    ...nav.primary.map((item) => ({ ...item, group: "Pages" })),
    ...nav.groups.flatMap((g) => g.items.map((item) => ({ ...item, group: g.label }))),
  ]
    .filter((item) => !ql || item.label.toLowerCase().includes(ql))
    .map(({ href, label, group, glyph }) => ({ href, label, group, glyph }));
  const hits: Hit[] = [
    ...pages,
    ...players.map((p) => ({ href: `/players/${p.id}`, label: p.label, sub: p.sub, group: "Players", glyph: "person" as const })),
    ...projects.map((p) => ({ href: `/projects/${p.id}`, label: p.label, sub: p.sub, group: "Projects", glyph: "rep" as const })),
  ];

  function go(href: string) {
    close();
    router.push(href);
  }

  return (
    <>
      <button type="button" className="hc-search-trigger" aria-label="Search" onClick={open}>
        <Icon glyph="search" size={18} aria-hidden />
        <span className="flex-1 truncate text-left">Search pages, players, projects...</span>
        <span className="flex shrink-0 gap-1">
          <kbd className="hc-kbd">Ctrl</kbd>
          <kbd className="hc-kbd">K</kbd>
        </span>
      </button>

      <dialog
        ref={dialog}
        className="hc-dialog hc-search-dialog"
        onClose={() => setQ("")}
        onClick={(e) => {
          if (e.target === dialog.current) close();
        }}
      >
        <div className="hc-search-input">
          <Icon glyph="search" size={20} className="hc-muted shrink-0" aria-hidden />
          <input
            autoFocus
            placeholder="Search pages, players, projects..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, hits.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter" && hits[cursor]) {
                e.preventDefault();
                go(hits[cursor].href);
              }
            }}
          />
          <button type="button" className="hc-kbd" onClick={close}>
            Esc
          </button>
        </div>
        <ul className="hc-search-results">
          {hits.length === 0 && <li className="hc-caption p-6 text-center text-sm">No results found.</li>}
          {hits.map((hit, i) => (
            <li key={`${hit.group}:${hit.href}`}>
              {(i === 0 || hits[i - 1].group !== hit.group) && <p className="hc-search-group">{hit.group}</p>}
              <button
                type="button"
                className="hc-search-item"
                aria-selected={i === cursor}
                ref={i === cursor ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                onMouseMove={() => setCursor(i)}
                onClick={() => go(hit.href)}
              >
                <Icon glyph={hit.glyph} size={18} style={glyphStyle(hit.glyph)} aria-hidden />
                <span className="truncate">{hit.label}</span>
                {hit.sub && <span className="hc-muted ml-auto truncate text-xs">{hit.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="hc-search-footer">
          <span>
            <kbd className="hc-kbd">↑</kbd> <kbd className="hc-kbd">↓</kbd> to move
          </span>
          <span>
            <kbd className="hc-kbd">Enter</kbd> to open
          </span>
          <span>
            <kbd className="hc-kbd">Esc</kbd> to close
          </span>
        </div>
      </dialog>
    </>
  );
}
