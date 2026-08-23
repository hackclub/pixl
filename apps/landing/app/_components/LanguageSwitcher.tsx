"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLocale } from "./LocaleProvider";

const LANGS: [string, string][] = [
  ["en", "English"],
  ["fr", "Français"],
  ["es", "Español"],
  ["pt", "Português"],
];

export function LanguageSwitcher() {
  const { dict, lang } = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelClose() {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }

  function scheduleClose() {
    cancelClose();
    closeTimeoutRef.current = setTimeout(() => {
      setOpen(false);
    }, 300);
  }

  useEffect(() => cancelClose, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function switchTo(next: string) {
    setOpen(false);
    if (next === lang) return;
    // pathname looks like "/fr" or "/fr/whatever" , swap the leading locale.
    const rest = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, "");
    router.push(`/${next}${rest || ""}`);
  }

  const current = LANGS.find(([value]) => value === lang)?.[1] ?? lang;

  return (
    <div ref={rootRef} className="fixed bottom-0 left-3 z-1000 sm:left-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => {
          cancelClose();
          setOpen(true);
        }}
        onMouseLeave={scheduleClose}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={dict.menu.language}
        className="flex cursor-pointer items-center gap-2 border-black border-b-4 border-l-2 border-r-4 border-t-2 bg-[#F5EED2] px-3 py-1.5 font-pixel text-base text-black transition-all hover:border-b-6 sm:gap-2.5 sm:px-6 sm:py-2 sm:text-lg lg:text-xl"
      >
        {current}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="black"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={dict.menu.language}
          className="absolute bottom-full left-0 z-10 mb-2 min-w-full overflow-hidden border-2 border-black bg-[#F5EED2]"
          style={{ boxShadow: "4px 4px 0 #000" }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          {LANGS.map(([value, label]) => (
            <li key={value} role="option" aria-selected={value === lang}>
              <button
                type="button"
                onClick={() => switchTo(value)}
                className={`block w-full whitespace-nowrap px-4 py-2 text-left font-pixel text-sm transition-colors sm:text-base lg:text-lg ${
                  value === lang
                    ? "bg-black text-[#F5EED2]"
                    : "text-black hover:bg-[#ec3750] hover:text-[#F5EED2]"
                }`}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
