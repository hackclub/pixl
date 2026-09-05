"use client";

import { useEffect } from "react";
import { heartbeatReview } from "@/app/actions";

// Keeps this reviewer's claim on a project alive (see REVIEW_LOCK_MS in
// lib/db.ts) while they're actually still on the detail page, instead of the
// lock silently expiring partway through a long review and letting a second
// reviewer pick up the same project. Only mounted when this viewer holds the
// claim (claim.ok in the parent page) - heartbeatReview itself is also a
// no-op for anyone who doesn't.
export function ReviewHeartbeat({ projectId }: { projectId: number }) {
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") {
        heartbeatReview(projectId).catch(() => {});
      }
    };
    const id = setInterval(tick, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [projectId]);

  return null;
}
