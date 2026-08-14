"use client";
import { LanguageSwitcher } from "./LanguageSwitcher";

export function Menu() {
  return (
    <div className="flex items-center justify-between fixed z-1000 w-full">
      <a href="https://hackclub.com" target="_blank">
        <img src="/hc-logo.png" alt="Hack Club" className="w-28 sm:w-40 lg:w-64" />
      </a>
      <div className="flex items-center gap-2 mr-3 lg:mr-6">
        <LanguageSwitcher />
      </div>
    </div>
  );
}
