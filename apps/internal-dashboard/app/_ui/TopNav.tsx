"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import Icon from "@hackclub/icons";
import { glyphStyle } from "./glyphs";
import { activeNavHref, type NavGroup, type NavItem, type NavModel } from "./nav";

function NavLink({ item, count, active }: { item: NavItem; count?: number; active: boolean }) {
  return (
    <Link href={item.href} className="hc-nav-link" data-active={active ? true : undefined}>
      <Icon glyph={item.glyph} size={20} style={glyphStyle(item.glyph)} aria-hidden />
      {item.label}
      {count !== undefined && count > 0 && <span className="hc-nav-count">{count}</span>}
    </Link>
  );
}

// Everything that isn't an everyday link, one section per group.
function MoreMenu({
  groups,
  counts,
  activeHref,
}: {
  groups: NavGroup[];
  counts: Record<string, number>;
  activeHref: string | null;
}) {
  const pathname = usePathname();
  const ref = useRef<HTMLDetailsElement>(null);
  const items = groups.flatMap((g) => g.items);
  const active = items.some((item) => item.href === activeHref);
  const total = items.reduce((sum, item) => sum + (counts[item.href] ?? 0), 0);

  // Close on navigation, outside click and Escape.
  useEffect(() => {
    ref.current?.removeAttribute("open");
  }, [pathname]);
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) ref.current.removeAttribute("open");
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") ref.current?.removeAttribute("open");
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <details ref={ref} className="hc-nav-menu" data-active={active ? true : undefined}>
      <summary className="hc-nav-link">
        <Icon glyph="menu" size={20} aria-hidden />
        More
        {total > 0 && <span className="hc-nav-count">{total}</span>}
        <Icon glyph="down-caret" size={16} aria-hidden />
      </summary>
      <div className="hc-nav-menu-panel hc-nav-mega">
        {groups.map((group) => (
          <section key={group.label}>
            <p className="hc-eyebrow px-2 pt-1 pb-1">{group.label}</p>
            <ul>
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} count={counts[item.href]} active={item.href === activeHref} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}

export default function TopNav({ nav, counts }: { nav: NavModel; counts: Record<string, number> }) {
  const activeHref = activeNavHref(usePathname(), nav);
  return (
    <nav className="hc-topnav flex items-center gap-1">
      {nav.primary.map((item) => (
        <NavLink key={item.href} item={item} count={counts[item.href]} active={item.href === activeHref} />
      ))}
      {nav.groups.length > 0 && <MoreMenu groups={nav.groups} counts={counts} activeHref={activeHref} />}
    </nav>
  );
}
