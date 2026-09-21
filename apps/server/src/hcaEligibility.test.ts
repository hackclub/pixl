import { describe, expect, test } from "bun:test";
import { hcaStateChanged, hcaStatePatch, hcaSyncOutcome, isSignupRejected, shipEligibilityBlock } from "./hcaEligibility.js";

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

  test("the block carries the stored status so the UI can say what is actually happening", () => {
    expect(shipEligibilityBlock({ hca_verification_status: "pending" })?.status).toBe("pending");
    expect(shipEligibilityBlock({})?.status).toBeNull();
  });

  test("the message never claims a re-login will fix it", () => {
    expect(shipEligibilityBlock({})?.message).not.toContain("Log out");
  });
});

describe("hcaStateChanged", () => {
  const verified = { hca_verification_status: "verified", hca_ysws_eligible: true };

  test("identical state is not a change", () => {
    expect(hcaStateChanged(verified, verified)).toBe(false);
  });

  test.each([
    [{}, verified],
    [null, verified],
    [{ hca_verification_status: "pending", hca_ysws_eligible: null }, verified],
    [verified, { hca_verification_status: "pending", hca_ysws_eligible: null }],
    [verified, { hca_verification_status: "verified", hca_ysws_eligible: false }],
    [verified, { hca_verification_status: "verified", hca_ysws_eligible: null }],
  ])("%p -> %p is a change", (current, next) => {
    expect(hcaStateChanged(current, next)).toBe(true);
  });

  test("an empty patch is never a change, even against null state", () => {
    expect(hcaStateChanged(null, {})).toBe(false);
    expect(hcaStateChanged(verified, {})).toBe(false);
  });
});

describe("hcaSyncOutcome", () => {
  test.each([
    [{ hca_verification_status: "verified", hca_ysws_eligible: true }, "verified"],
    [{ hca_verification_status: "pending" }, "pending"],
    [{ hca_verification_status: "needs_submission" }, "needs_submission"],
    [{ hca_verification_status: "ineligible" }, "ineligible"],
    [{ hca_verification_status: "verified", hca_ysws_eligible: false }, "ineligible"],
    [{}, "unknown"],
    [null, "unknown"],
  ])("%p -> %p", (row, outcome) => {
    expect(hcaSyncOutcome(row)).toBe(outcome);
  });
});
