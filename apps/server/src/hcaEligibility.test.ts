import { describe, expect, test } from "bun:test";
import { hcaStatePatch, isSignupRejected, shipEligibilityBlock } from "./hcaEligibility.js";

describe("isSignupRejected", () => {
  test.each([
    ["needs_submission", undefined, false],
    ["pending", undefined, false],
    ["verified", true, false],
    ["verified", false, true],
    ["verified", undefined, true],
    ["verified", "true", true],
    ["ineligible", false, true],
    ["ineligible", true, true],
    [undefined, undefined, false],
    ["", undefined, false],
    ["something_new", undefined, false],
  ])("status %p, ysws_eligible %p -> rejected %p", (status, eligible, rejected) => {
    expect(isSignupRejected({ verification_status: status, ysws_eligible: eligible })).toBe(rejected);
  });
});

describe("hcaStatePatch", () => {
  test("stores both claims together", () => {
    expect(hcaStatePatch({ verification_status: "verified", ysws_eligible: true })).toEqual({
      hca_verification_status: "verified",
      hca_ysws_eligible: true,
    });
  });

  test("a status without an eligibility claim stores null, not a stale value", () => {
    expect(hcaStatePatch({ verification_status: "pending" })).toEqual({
      hca_verification_status: "pending",
      hca_ysws_eligible: null,
    });
  });

  test("no status means nothing to write", () => {
    expect(hcaStatePatch({})).toEqual({});
    expect(hcaStatePatch({ ysws_eligible: true })).toEqual({});
    expect(hcaStatePatch({ verification_status: "  " })).toEqual({});
  });
});

describe("shipEligibilityBlock", () => {
  test("only verified and eligible may ship", () => {
    expect(shipEligibilityBlock({ hca_verification_status: "verified", hca_ysws_eligible: true })).toBeNull();
  });

  test.each([
    [{ hca_verification_status: "needs_submission" }, "hca_verification_required"],
    [{ hca_verification_status: "pending" }, "hca_verification_required"],
    [{ hca_verification_status: null }, "hca_verification_required"],
    [{}, "hca_verification_required"],
    [null, "hca_verification_required"],
    [{ hca_verification_status: "ineligible" }, "hca_ineligible"],
    [{ hca_verification_status: "verified", hca_ysws_eligible: false }, "hca_ineligible"],
    [{ hca_verification_status: "verified", hca_ysws_eligible: null }, "hca_ineligible"],
    [{ hca_verification_status: "something_new" }, "hca_ineligible"],
  ])("%p -> %p", (row, code) => {
    expect(shipEligibilityBlock(row)?.error).toBe(code);
  });
});
