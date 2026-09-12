"use client";

import { useEffect, useState } from "react";

// Lives with the page rather than the shell: the shell is now shared across
// every doc and can't hold per-doc headings. Rendering it here also keeps the
// rail server-rendered with the right entries on first paint.
export function DocToc({ headings }: { headings: { id: string; text: string }[] }) {
  const [active, setActive] = useState(headings[0]?.id ?? "");

  useEffect(() => {
    if (headings.length === 0) return;
    function markToc() {
      const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
      if (atBottom) {
        setActive(headings[headings.length - 1]!.id);
        return;
      }
      let current = headings[0]!.id;
      for (const h of headings) {
        const el = document.getElementById(h.id);
        if (el && el.getBoundingClientRect().top <= 96) current = h.id;
      }
      setActive(current);
    }
    window.addEventListener("scroll", markToc, { passive: true });
    markToc();
    return () => window.removeEventListener("scroll", markToc);
  }, [headings]);

  return (
    <aside className={`docs-toc${headings.length >= 2 ? "" : " empty"}`}>
      {headings.length >= 2 && (
        <>
          <div className="docs-toc-h">On this page</div>
          {headings.map((h) => (
            <a
              key={h.id}
              href={`#${h.id}`}
              className={h.id === active ? "active" : ""}
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
  );
}
