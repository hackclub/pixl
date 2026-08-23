"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    hljs?: { highlightAll: () => void };
  }
}

export function CodeBlocks({ slug }: { slug: string }) {
  useEffect(() => {
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

  return null;
}
