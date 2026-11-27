"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS } from "./(shell)/nav-data";
import styles from "./not-found.module.css";

const ROUTES = [...NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)), "/docs"];

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = next;
    }
  }
  return row[b.length];
}

function closestRoute(path: string): string | null {
  const wanted = path.toLowerCase().replace(/\/+$/, "");
  if (wanted.length < 3) return null;
  let best: { href: string; score: number } | null = null;
  for (const href of ROUTES) {
    const isPrefix = href.startsWith(wanted) || wanted.startsWith(href);
    const score = isPrefix ? 0 : distance(wanted, href);
    if (score <= 2 && (!best || score < best.score)) best = { href, score };
  }
  return best?.href ?? null;
}

export function NotFoundDetails() {
  const pathname = usePathname() || "/";
  const suggestion = closestRoute(pathname);
  return (
    <div className={styles.routeHint}>
      <span className={styles.lostPath} title={pathname}>
        MISSING: <code>{pathname}</code>
      </span>
      {suggestion && (
        <span className={styles.routeSuggestion}>
          Looking for{" "}
          <Link href={suggestion}>{suggestion}</Link>?
        </span>
      )}
    </div>
  );
}
