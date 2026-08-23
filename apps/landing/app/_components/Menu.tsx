"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale } from "./LocaleProvider";

// The bar is fixed and has no backdrop, so section content used to slide under
// the docs button while you read. Rather than give it a
// background (which would cover the flag and change the look), it gets out of
// the way: hidden while scrolling down, back the moment you scroll up.
function useHideOnScrollDown(threshold = 120) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let last = window.scrollY;
    let queued = false;

    function onScroll() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        // the 4px deadzone stops momentum jitter from flapping the bar
        if (y > threshold && y > last + 4) setHidden(true);
        else if (y < last - 4 || y <= threshold) setHidden(false);
        last = y;
        queued = false;
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return hidden;
}

export function Menu() {
  const hidden = useHideOnScrollDown();
  const { dict } = useLocale();

  return (
    <div
      className={`flex justify-between fixed z-1000 w-full transition-transform duration-300 ease-out motion-reduce:transition-none ${
        hidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      <a href="https://hackclub.com" target="_blank">
        <img
          src="/hc-logo.png"
          alt="Hack Club"
          className="w-28 sm:w-40 lg:w-64"
        />
      </a>
      <div className="flex gap-2 sm:gap-3 mr-3 lg:mr-6">
        <Link
          href="/docs"
          className="font-pixel h-min text-center border-t-0 px-3 py-1.5 text-lg sm:text-xl lg:text-2xl bg-[#ff8c37] text-[#F5EED2] cursor-pointer border-black border-r-4 border-l-2 border-b-4 hover:border-b-8 transition-all hover:pt-15"
        >
          {dict.menu.openDocs}
        </Link>
      </div>
    </div>
  );
}
