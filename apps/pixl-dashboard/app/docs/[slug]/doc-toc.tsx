"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

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
    // Same family/sizing as the left nav so both sidebars read as one system.
    // Dropped below 1080px, before the content column gets squeezed.
    <aside
      className={cn(
        "sticky top-[54px] h-[calc(100vh-54px)] overflow-y-auto pt-[46px] pr-[18px] pb-[40px] pl-[6px] max-[1080px]:hidden",
        headings.length < 2 && "invisible",
      )}
    >
      {headings.length >= 2 && (
        <>
          <div className="mb-[10px] pl-[13px] font-sans text-[12.5px] font-semibold uppercase tracking-[1.2px] text-muted">
            On this page
          </div>
          {headings.map((h) => (
            <a
              key={h.id}
              href={`#${h.id}`}
              className={cn(
                "block border-l-2 border-stroke px-[12px] py-[6px] font-sans text-[14px] font-medium leading-normal text-dim no-underline",
                "transition-[color,border-color,border-left-width] duration-[130ms] ease-[ease] hover:text-ink",
                h.id === active && "border-l-4 border-l-accent font-semibold text-accent hover:text-accent",
              )}
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
