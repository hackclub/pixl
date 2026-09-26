"use client";

import { useEffect } from "react";
import { heartbeatReview, releaseReviewClaim } from "@/app/actions";

// If the tab is hidden/unfocused for this long straight, give up the claim
// early instead of waiting out the full REVIEW_LOCK_MS (30 min) of silence in
// lib/db.ts - a reviewer who's actually gone shouldn't block someone else
// from picking this project up.
const AWAY_RELEASE_MS = 5 * 60 * 1000;

// Keeps this reviewer's claim on a project alive (see REVIEW_LOCK_MS in
// lib/db.ts) while they're actually still on the detail page, instead of the
// lock silently expiring partway through a long review and letting a second
// reviewer pick up the same project - and gives it up early if they leave the
// tab. Only mounted when this viewer holds the claim (claim.ok in the parent
// page) - heartbeatReview/releaseReviewClaim are also no-ops for anyone who
// doesn't.
export function ReviewHeartbeat({ projectId }: { projectId: number }) {
  useEffect(() => {
    // "Away" means either the tab isn't the visible one or the window itself
    // lost focus - both, since a reviewer can alt-tab to another app while
    // this tab stays the visible one in its own window (same definition
    // ReviewForm.tsx uses for its own active-review-time tracking).
    const isActiveNow = () => document.visibilityState === "visible" && document.hasFocus();

    const tick = () => {
      if (isActiveNow()) heartbeatReview(projectId).catch(() => {});
    };
    const id = setInterval(tick, 5 * 60 * 1000);

    let awayTimer: ReturnType<typeof setTimeout> | null = null;
    const trackAway = () => {
      if (isActiveNow()) {
        if (awayTimer) {
          clearTimeout(awayTimer);
          awayTimer = null;
        }
      } else if (!awayTimer) {
        awayTimer = setTimeout(() => {
          releaseReviewClaim(projectId).catch(() => {});
        }, AWAY_RELEASE_MS);
      }
    };
    window.addEventListener("focus", trackAway);
    window.addEventListener("blur", trackAway);
    document.addEventListener("visibilitychange", trackAway);

    return () => {
      clearInterval(id);
      if (awayTimer) clearTimeout(awayTimer);
      window.removeEventListener("focus", trackAway);
      window.removeEventListener("blur", trackAway);
      document.removeEventListener("visibilitychange", trackAway);
    };
  }, [projectId]);

  return null;
}
