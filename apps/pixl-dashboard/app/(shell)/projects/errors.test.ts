import { describe, expect, test } from "bun:test";
import { hcaRecheckCopy, projectError, projectErrorWith, trialHoursCopy } from "./errors";

describe("project error details", () => {
  test("journal copy uses need/have/hours", () => {
    expect(projectErrorWith("journal_too_short", { need: 200, hours: 2 }, { contentLength: 57 })).toBe(
      "Logging 2h needs at least 200 characters of writing (you have 57).",
    );
    expect(projectErrorWith("journal_images_required", { need: 1, have: 0 })).toBe("This entry needs 1 image (you have 0).");
    expect(projectErrorWith("journal_images_required", { need: 3, have: 1 })).toBe("This entry needs 3 images (you have 1).");
    expect(projectErrorWith("journal_too_short")).toContain("100 characters of writing per hour (images don't count)");
  });
  test("trial hours copy", () => {
    expect(trialHoursCopy({ need: 5, have: 1.2 })).toContain("needs at least 5h tracked, you're at 1.2h");
    expect(trialHoursCopy()).toContain("more tracked hours");
  });
  test("hca copy falls back to unknown", () => {
    expect(hcaRecheckCopy("pending").title).toBe("Still under review");
    expect(hcaRecheckCopy("needs_submission").title).toBe("Finish verifying");
    expect(hcaRecheckCopy("__proto__").title).toBe("Verify with Hack Club Auth");
    expect(hcaRecheckCopy(undefined).title).toBe("Verify with Hack Club Auth");
  });
});

describe("server security codes", () => {
  test("off-CDN images, busy uploads and removed collaborators get friendly copy", () => {
    expect(projectError("invalid_image_url")).toBe("Images must be uploaded through Pixl (re-upload this image).");
    expect(projectError("busy")).toBe("Uploads are busy, try again in a moment.");
    expect(projectError("removed")).toBe("You were removed from this project.");
  });
});
