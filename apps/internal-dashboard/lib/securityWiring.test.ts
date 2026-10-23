import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Source-level pins for fixes whose logic lives in tested pure helpers but
// whose protection depends on the page/action actually calling them. Each one
// fails if the wiring is removed.
const root = join(import.meta.dir, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

function fnBody(file: string, marker: string): string {
  const s = src(file);
  const i = s.indexOf(marker);
  if (i < 0) throw new Error(`${marker} not found in ${file}`);
  const next = s.indexOf("\nexport ", i + marker.length);
  return s.slice(i, next < 0 ? undefined : next);
}

describe("H1 public stats", () => {
  test("stats page and publicGallery never use playerLabel / real_name", () => {
    expect(src("app/stats/page.tsx")).not.toMatch(/playerLabel|real_name|email|slack/);
    const gallery = fnBody("lib/db.ts", "export async function publicGallery");
    expect(gallery).not.toMatch(/playerLabel|real_name|email|slack_id/);
    expect(gallery).toContain("publicOwnerLabel");
  });
  test("the UI test page is gone", () => {
    expect(existsSync(join(root, "app/_uitest"))).toBe(false);
  });
});

describe("H2 fulfillment", () => {
  test("buyer details are only loaded for orders the viewer may see", () => {
    const page = src("app/fulfillment/page.tsx");
    expect(page).toContain("canSeeBuyerDetails");
    expect(page).not.toMatch(/buyerDetailsByUserId\(orders\.map/);
  });
  test("label page checks the claimer and audits views", () => {
    const label = src("app/fulfillment/label/[id]/page.tsx");
    expect(label).toContain("canViewLabel(order, access)");
    expect(label).toContain('"fulfillment.label_view"');
  });
  test("order actions refuse self-dealing and foreign flags", () => {
    expect(fnBody("app/actions.ts", "export const claimOrder")).toContain("isOwnOrder");
    expect(fnBody("app/actions.ts", "export const shipOrder")).toContain("isOwnOrder");
    expect(fnBody("app/actions.ts", "export const markOrderCredited")).toContain("isOwnOrder");
    expect(fnBody("app/actions.ts", "export const flagOrderOverBudget")).toContain("canFlagOrder");
  });
});

describe("H3 review page PII", () => {
  test("builder details go through builderDetailsView", () => {
    const page = src("app/review/[id]/page.tsx");
    expect(page).toContain("builderDetailsView(access, isFinalStage");
    expect(page).not.toMatch(/isFinalStage && birthday \?/);
  });
});

describe("M1/M2 reviewer actions", () => {
  test("proposed-ban branch uses proposedBanDecision", () => {
    expect(fnBody("app/actions.ts", "export const reviewProject")).toContain("proposedBanDecision(access, verdict");
  });
  for (const name of [
    "setJournalHours",
    "updateFundingAmount",
    "skipRobertPass",
    "setProjectLevel",
    "extendHoursCutoff",
    "applySubmissionEdits",
    "toggleProjectPeak",
    "saveReviewDraft",
    "holdReview",
    "sendBackToFirstPass",
    "unshipProject",
    "updateSecondPassChecklist",
    "addProjectNote",
  ]) {
    test(`${name} authorizes the project (queue scope + self-review)`, () => {
      expect(fnBody("app/actions.ts", `export const ${name} =`)).toContain("authorizeProjectAction(access, projectId");
    });
  }
  test("setJournalHours scopes the journal to the project (IDOR)", () => {
    const body = fnBody("app/actions.ts", "export const setJournalHours =");
    expect(body.match(/\.eq\("project_id", projectId\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
  test("isOwnProject checks collaborators, pending invites included", () => {
    const s = src("app/actions.ts");
    expect(s).toMatch(/async function isOwnProject\(access: AdminAccess, ownerUserId: string, projectId: number\)/);
    expect(s).toContain("isOwnOrCollaborator(myIds, ownerUserId, collaborators)");
    const body = s.slice(s.indexOf("async function isOwnProject"), s.indexOf("function denyProjectAction"));
    expect(body).toContain('.in("status", ["pending", "accepted"])');
    const page = src("app/review/[id]/page.tsx");
    expect(page).toContain('c.status === "pending"');
  });
  test("self-review applies to owners too", () => {
    const s = src("app/actions.ts");
    const authz = s.slice(s.indexOf("async function authorizeProjectAction"), s.indexOf("async function hasSelfReviewException"));
    expect(authz).toContain("isOwnProject(access, row.user_id, projectId)");
    expect(authz).not.toContain("access.isOwner");
    const review = fnBody("app/actions.ts", "export const reviewProject");
    expect(review).toContain('stage === "second_review" && own');
    expect(review).not.toMatch(/stage === "shipped" &&\s*!access\.isOwner/);
    const page = src("app/review/[id]/page.tsx");
    expect(page).toContain("spotCheckStage && (access.isOwner || canSecondPass) && !isOwn");
    expect(page).not.toMatch(/const isOwn =\s*!access\.isOwner/);
  });
});

describe("builder legal names (first-pass reviewers)", () => {
  test("queue rows never carry real_name to the client ReviewTable", () => {
    expect(src("app/_components/ReviewTable.tsx")).not.toMatch(/\.real_name/);
    expect(src("lib/db.ts")).toContain('const QUEUE_SELECT = "*, users(id, display_name, slack_id)"');
    for (const fn of [
      "listShippedProjects",
      "listSecondReviewProjects",
      "listReviewedProjects",
      "listSpotCheckProjects",
      "listProposedBanProjects",
    ])
      expect(fnBody("lib/db.ts", `export async function ${fn}`)).toContain(".select(QUEUE_SELECT)");
  });
  test("review and project pages name builders through builderNameFor", () => {
    for (const f of ["app/review/[id]/page.tsx", "app/projects/page.tsx", "app/projects/[id]/page.tsx"]) {
      const page = src(f);
      expect(page).toContain("builderNameFor(access");
      expect(page).not.toMatch(/users\??\.real_name \|\|/);
    }
  });
  test("reviewer-facing review audits only get legal names when privileged", () => {
    expect(fnBody("lib/db.ts", "export async function listReviewAudits")).toContain("opts.realNames");
    expect(src("app/review/(tabs)/page.tsx")).toContain("realNames: canSeeBuilderPII(access)");
  });
});

describe("routes", () => {
  test("ticket routes validate ts", () => {
    for (const r of ["resolve", "reply", "thread"])
      expect(src(`app/api/tickets/[ts]/${r}/route.ts`)).toContain("isValidTicketTs(ts)");
    expect(src("lib/tickets.ts")).toContain("encodeURIComponent(ts)");
  });
  test("guardedRoute and logout enforce the CSRF origin check", () => {
    expect(fnBody("lib/guard.ts", "export function guardedRoute")).toContain("csrfRejection(request.method");
    expect(src("app/api/auth/logout/route.ts")).toContain("csrfRejection(");
    expect(src("app/api/tickets/[ts]/reply/route.ts")).toContain("requireJson: true");
  });
  test("cron routes compare the secret in constant time", () => {
    for (const r of ["queue-health", "robert-sync"]) {
      const s = src(`app/api/cron/${r}/route.ts`);
      expect(s).toContain("bearerMatches(");
      expect(s).not.toContain("!== `Bearer ${secret}`");
    }
  });
  test("audit meta never stores raw error messages", () => {
    const g = src("lib/guard.ts");
    expect(g).not.toMatch(/\.message/);
    expect(g).toContain("errorCode(e)");
  });
  test("oauth state, live-mode and session cookies are Secure", () => {
    expect(src("app/api/auth/login/route.ts")).toMatch(/secure: true/);
    const a = src("app/actions.ts");
    expect(a).toMatch(/LIVE_MODE_COOKIE, on \? "1" : "0", \{ httpOnly: true, secure: true/);
    expect(a).toMatch(/LIVE_SHOW_REVIEWERS_COOKIE, "1", \{ httpOnly: true, secure: true/);
    expect(src("lib/session.ts")).toContain("secure: secureCookies()");
  });
  test("shop image URL fetch is pinned and capped", () => {
    const body = fnBody("app/actions.ts", "async function uploadShopImageFromUrl");
    expect(body).toContain("safeBinaryGet(");
    expect(body).not.toMatch(/await fetch\(/);
  });
});

describe("review claims", () => {
  test("reviewProject re-takes the claim atomically before applying a verdict", () => {
    const body = fnBody("app/actions.ts", "export const reviewProject");
    expect(body).toContain("await claimReview(projectId, access.session.slackId)");
    expect(body).not.toContain("activeReviewClaim(current");
  });
});
