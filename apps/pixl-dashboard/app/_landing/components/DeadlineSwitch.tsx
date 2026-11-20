"use client";

import { useEffect, useState, type ReactNode } from "react";
import { submissionDeadline } from "@/app/_generated/config";

// Shows `before` until the submission deadline in packages/config/pixl.json
// passes, then `after`, without a redeploy: the page is statically generated,
// so the swap happens in the browser. It starts on `before` (what the static
// HTML contains, so hydration matches) and flips as soon as the clock says the
// deadline is over, including for visitors who open the page afterwards.
export function DeadlineSwitch({ before, after }: { before: ReactNode; after: ReactNode }) {
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    const deadline = submissionDeadline.getTime();
    if (Date.now() >= deadline) {
      setEnded(true);
      return;
    }
    const id = setInterval(() => {
      if (Date.now() >= deadline) {
        setEnded(true);
        clearInterval(id);
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return <>{ended ? after : before}</>;
}
