import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(import.meta.dir, "projects", "index.html"), "utf8");
const start = html.indexOf("// <hca-recheck>");
const end = html.indexOf("// </hca-recheck>");
if (start === -1 || end === -1) throw new Error("hca-recheck markers missing from projects/index.html");

const api = new Function(
  `${html.slice(start, end)}\nreturn { HCA_RECHECK_COPY, HCA_SYNCED_TOASTS, hcaRecheckCopy, hcaResyncPath, takeHcaSynced };`,
)() as {
  HCA_RECHECK_COPY: Record<string, { title: string; body: string }>;
  HCA_SYNCED_TOASTS: Record<string, [string, boolean]>;
  hcaRecheckCopy: (status: unknown) => { title: string; body: string };
  hcaResyncPath: (returnTo: string) => string;
  takeHcaSynced: (params: URLSearchParams) => string | null;
};

describe("hca_verification_required re-check dialog", () => {
  test("says what HCA actually reports for each status", () => {
    expect(api.hcaRecheckCopy("pending").title).toBe("Still under review");
    expect(api.hcaRecheckCopy("needs_submission").title).toBe("Finish verifying");
    expect(api.hcaRecheckCopy(null).title).toBe("Verify with Hack Club Auth");
    expect(api.hcaRecheckCopy(undefined).title).toBe("Verify with Hack Club Auth");
  });

  test("odd or hostile status values fall back to the generic copy", () => {
    for (const odd of ["verified", "", "__proto__", "constructor", "toString", 7, {}]) {
      const copy = api.hcaRecheckCopy(odd);
      expect(copy.title).toBe("Verify with Hack Club Auth");
      expect(typeof copy.body).toBe("string");
    }
  });

  test("no copy promises that logging out and back in will fix it", () => {
    const all = [
      ...Object.values(api.HCA_RECHECK_COPY).flatMap((c) => [c.title, c.body]),
      ...Object.values(api.HCA_SYNCED_TOASTS).map(([text]) => text),
    ];
    for (const text of all) expect(text).not.toMatch(/log ?(out|in)|sign ?(out|in)/i);
  });

  test("the re-check link goes to the dedicated resync route and carries the return page", () => {
    const path = api.hcaResyncPath("https://pixl.hackclub.com/projects/?trial=4");
    expect(path).toBe("/auth/hackclub/resync?web_redirect=https%3A%2F%2Fpixl.hackclub.com%2Fprojects%2F%3Ftrial%3D4");
  });
});

describe("returning from a re-check", () => {
  test.each(["verified", "pending", "needs_submission", "ineligible", "unknown"])("%s is recognised and consumed", (outcome) => {
    const params = new URLSearchParams(`trial=4&hca_synced=${outcome}`);
    expect(api.takeHcaSynced(params)).toBe(outcome);
    expect(params.has("hca_synced")).toBe(false);
    expect(params.get("trial")).toBe("4");
  });

  test("a page that was not returned to leaves the URL alone", () => {
    const params = new URLSearchParams("trial=4");
    expect(api.takeHcaSynced(params)).toBeNull();
    expect(params.toString()).toBe("trial=4");
  });

  test("an unrecognised value is treated as unknown and still removed", () => {
    for (const odd of ["", "yes", "__proto__", "constructor"]) {
      const params = new URLSearchParams({ hca_synced: odd });
      expect(api.takeHcaSynced(params)).toBe("unknown");
      expect(params.has("hca_synced")).toBe(false);
    }
  });

  test("only a verified outcome reads as good news", () => {
    for (const [outcome, [, bad]] of Object.entries(api.HCA_SYNCED_TOASTS)) {
      expect(bad).toBe(outcome !== "verified");
    }
  });
});

describe("projects page wiring", () => {
  test("the stale claim is gone and the ship flow offers the re-check", () => {
    expect(html).not.toContain("Log out and back in");
    expect(html).toContain('r.error === "hca_verification_required"');
    expect(html).toContain("Pixl.apiUrl(hcaResyncPath(location.href))");
    expect(html).toContain("takeHcaSynced(syncParams)");
  });
});
