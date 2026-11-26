import { describe, expect, test } from "bun:test";
import { actionErrorMessage, isStaleDeployError } from "./actionError";

// The exact text a reviewer saw when approving from a tab opened before a deploy.
const BROWSER_STALE =
  'Server Action "7fd4a3091491e37fedfe1ad61e10237b12869427df" was not found on the server. Read more: https://nextjs.org/docs/messages/failed-to-find-server-action';
const SERVER_STALE =
  'Failed to find Server Action "7f626f3124c22ce924b61dc13dcb336e52de959161". This request might be from an older or newer deployment.';

describe("stale deploy errors", () => {
  test("recognises both the browser's and the server's wording", () => {
    expect(isStaleDeployError(new Error(BROWSER_STALE))).toBe(true);
    expect(isStaleDeployError(new Error(SERVER_STALE))).toBe(true);
  });

  test("other failures are not treated as stale", () => {
    expect(isStaleDeployError(new Error("Failed to fetch"))).toBe(false);
    expect(isStaleDeployError(new Error("You can't review a project you own."))).toBe(false);
    expect(isStaleDeployError(null)).toBe(false);
  });

  test("the message tells the reviewer to reload, without the raw error", () => {
    const text = actionErrorMessage(new Error(BROWSER_STALE), "submit this verdict");
    expect(text).toContain("reload the page");
    expect(text).not.toContain("7fd4a3091491");
    expect(text).not.toContain("nextjs.org");
  });
});

describe("redacted server errors", () => {
  test("the minified React #441 text becomes the generic message, not the raw error", () => {
    const text = actionErrorMessage(
      new Error("Minified React error #441; visit https://react.dev/errors/441 for the full message"),
      "generate a draft",
    );
    expect(text).toContain("the server hit an error part way through");
    expect(text).not.toContain("react.dev");
  });
});
