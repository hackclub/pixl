"use client";

import { useEffect } from "react";
import Script from "next/script";

declare global {
  interface Window {
    hljs?: { highlightAll: () => void };
  }
}

export function CodeBlocks({ slug }: { slug: string }) {
  useEffect(() => {
    // Covers the fast path: hljs was already loaded by an earlier doc page
    // in this client-side session, so it's ready the instant this mounts.
    // The Script below's onLoad covers the other path (first page load,
    // hljs still in flight when this effect runs).
    if (window.hljs) window.hljs.highlightAll();

    const cleanups: (() => void)[] = [];
    document.querySelectorAll("article.doc pre").forEach((pre) => {
      if (pre.querySelector(".copy-btn")) return;
      const btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.type = "button";
      btn.textContent = "Copy";
      const handler = async () => {
        try {
          await navigator.clipboard.writeText(pre.querySelector("code")?.textContent ?? "");
          btn.textContent = "Copied";
          btn.classList.add("copied");
          setTimeout(() => {
            btn.textContent = "Copy";
            btn.classList.remove("copied");
          }, 1600);
        } catch {
          // clipboard permission denied - button just stays "Copy"
        }
      };
      btn.addEventListener("click", handler);
      pre.appendChild(btn);
      cleanups.push(() => {
        btn.removeEventListener("click", handler);
        btn.remove();
      });
    });

    return () => cleanups.forEach((fn) => fn());
  }, [slug]);

  return (
    <Script
      src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"
      integrity="sha512-D9gUyxqja7hBtkWpPWGt9wfbfaMGVt9gnyCvYa+jojwwPHLCzUm5i8rpk7vD7wNee9bA35eYIjobYPaQuKS1MQ=="
      crossOrigin="anonymous"
      strategy="afterInteractive"
      onLoad={() => window.hljs?.highlightAll()}
    />
  );
}
