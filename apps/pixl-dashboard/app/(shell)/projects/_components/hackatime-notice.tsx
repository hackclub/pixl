"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Notice } from "@/components/ui/primitives";
import { hackatimeReturnNotice } from "../hackatime-return";

/** Shown once after the Hackatime connect flow lands back on a /projects page. */
export function HackatimeReturnNotice() {
  const router = useRouter();
  const pathname = usePathname();
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);

  useEffect(() => {
    // Read straight from the URL (client-only effect): no useSearchParams, so
    // the layout needs no Suspense boundary.
    const params = new URLSearchParams(window.location.search);
    const next = hackatimeReturnNotice(params.get("hackatime"), params.get("hackatime_reason"));
    if (!next) return;
    setNotice(next);
    params.delete("hackatime");
    params.delete("hackatime_reason");
    router.replace(pathname + (params.size ? `?${params}` : ""), { scroll: false });
  }, [pathname, router]);

  if (!notice) return null;
  return (
    <Notice tone={notice.bad ? "bad" : "good"} className="mb-4">
      {notice.text}
    </Notice>
  );
}
