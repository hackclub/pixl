import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (name: string) => readFileSync(join(import.meta.dir, "../app/", name), "utf8");

describe("review detail claim behavior", () => {
  test("the GET page only reads claim state; no implicit database claim", () => {
    const page = source("review/[id]/page.tsx");
    expect(page).not.toContain("claimReview(projectId, viewer)");
    expect(page).toContain("activeReviewClaim(p, Date.now(), REVIEW_LOCK_MS)");
    expect(page).toContain("hasActiveClaim ? (");
  });

  test("reviewers must explicitly start before form or heartbeat mounts", () => {
    const page = source("review/[id]/page.tsx");
    expect(page).toContain("action={beginReviewClaim}");
    expect(page).toContain("action={endReviewClaim}");
    expect(page).toContain("hasActiveClaim && canReview && <ReviewHeartbeat");
  });

  test("new review action enforces scope, stage, ownership and assignment", () => {
    const actions = source("actions.ts");
    const part = actions.slice(actions.indexOf("export const beginReviewClaim"), actions.indexOf("export const endReviewClaim"));
    for (const key of ["guardedAction", "queueAllows(", "isOwnProject(", "firstPassAccess(", "claimReview("]) {
      expect(part).toContain(key);
    }
  });
});
