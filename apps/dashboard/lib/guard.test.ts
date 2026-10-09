import { describe, expect, test } from "bun:test";
import { ALL_PERMISSIONS, EDIT_SUBMISSION, SECOND_PASS } from "./guard";

describe("EDIT_SUBMISSION marker", () => {
  test("is its own marker, not final-reviewer status", () => {
    expect(EDIT_SUBMISSION).toBe("edit_submission");
    expect(EDIT_SUBMISSION).not.toBe(SECOND_PASS);
  });

  test("is not a generic permission, so it can't be ticked on as one", () => {
    expect(ALL_PERMISSIONS as readonly string[]).not.toContain(EDIT_SUBMISSION);
  });
});
