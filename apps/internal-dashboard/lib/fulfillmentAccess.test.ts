import { describe, expect, test } from "bun:test";
import { canFlagOrder, canOpenFulfillmentTab, canSeeBuyerDetails, canViewLabel, claimedBy, isOwnOrder, visibleOrderActions } from "./fulfillmentAccess";
import { PUBLIC_FALLBACK_NAME, PUBLIC_USER_COLUMNS, publicOwnerLabel } from "./publicLabels";

const fulfiller = (slackId: string, isOwner = false) => ({ isOwner, session: { slackId } });

describe("H2: buyer PII only for the claiming fulfiller or an owner", () => {
  test("unclaimed order: no fulfiller sees details", () => {
    expect(canSeeBuyerDetails({ claimed_by_slack: "" }, fulfiller("UF1"))).toBe(false);
    expect(canSeeBuyerDetails({ claimed_by_slack: null }, fulfiller("UF1"))).toBe(false);
  });
  test("an empty session id never matches an unclaimed order", () => {
    expect(claimedBy({ claimed_by_slack: "" }, "")).toBe(false);
  });
  test("claimed by me vs by someone else", () => {
    expect(canSeeBuyerDetails({ claimed_by_slack: "UF1" }, fulfiller("UF1"))).toBe(true);
    expect(canSeeBuyerDetails({ claimed_by_slack: "UF2" }, fulfiller("UF1"))).toBe(false);
  });
  test("owners see everything", () => {
    expect(canSeeBuyerDetails({ claimed_by_slack: "" }, fulfiller("UO", true))).toBe(true);
  });
  test("label IDOR: same rule as details", () => {
    expect(canViewLabel({ claimed_by_slack: "UF2" }, fulfiller("UF1"))).toBe(false);
    expect(canViewLabel({ claimed_by_slack: "UF1" }, fulfiller("UF1"))).toBe(true);
    expect(canViewLabel({ claimed_by_slack: "UF2" }, fulfiller("UO", true))).toBe(true);
  });
});

describe("fulfiller self-dealing", () => {
  test("own order detected by the buyer's Slack id", () => {
    expect(isOwnOrder({ player_slack: "UF1" }, "UF1")).toBe(true);
    expect(isOwnOrder({ player_slack: "UBUYER" }, "UF1")).toBe(false);
    expect(isOwnOrder({ player_slack: null }, "UF1")).toBe(false);
    expect(isOwnOrder({ player_slack: "" }, "")).toBe(false);
  });
  test("owners may fulfil their own order, regular fulfillers still may not", () => {
    expect(isOwnOrder({ player_slack: "UO" }, "UO", true)).toBe(false);
    expect(isOwnOrder({ player_slack: "UF1" }, "UF1", false)).toBe(true);
    expect(isOwnOrder({ player_slack: "UF1" }, "UF1")).toBe(true);
  });
  test("flagging only by the claimer or an owner", () => {
    expect(canFlagOrder({ claimed_by_slack: "" }, fulfiller("UF1"))).toBe(false);
    expect(canFlagOrder({ claimed_by_slack: "UF2" }, fulfiller("UF1"))).toBe(false);
    expect(canFlagOrder({ claimed_by_slack: "UF1" }, fulfiller("UF1"))).toBe(true);
    expect(canFlagOrder({ claimed_by_slack: "" }, fulfiller("UO", true))).toBe(true);
  });
});

describe("H1: public stats never show legal names", () => {
  test("only display_name is used", () => {
    expect(publicOwnerLabel({ display_name: "pixelkid" })).toBe("pixelkid");
    expect(publicOwnerLabel({ display_name: "  " } as { display_name: string })).toBe(PUBLIC_FALLBACK_NAME);
    expect(publicOwnerLabel(null)).toBe(PUBLIC_FALLBACK_NAME);
    // Even if a row carrying real_name sneaks in, it's ignored.
    const leaky = { display_name: "", real_name: "Jane Doe" } as { display_name: string };
    expect(publicOwnerLabel(leaky)).toBe(PUBLIC_FALLBACK_NAME);
  });
  test("the public users embed is display_name only", () => {
    expect(PUBLIC_USER_COLUMNS).toBe("display_name");
  });
});

describe("fulfillment tabs and the actions panel", () => {
  test("only owners may open the fulfiller manager", () => {
    expect(canOpenFulfillmentTab("fulfillers", { isOwner: false })).toBe(false);
    expect(canOpenFulfillmentTab("fulfillers", { isOwner: true })).toBe(true);
    expect(canOpenFulfillmentTab("leaderboard", { isOwner: false })).toBe(true);
    expect(canOpenFulfillmentTab("pending", { isOwner: false })).toBe(true);
  });

  const base = { flagged: false, hasBuyerSlack: true, mine: true, ownOrder: false };
  const panel = (status: string, canManage: boolean, over: Partial<typeof base> = {}) =>
    visibleOrderActions({ ...base, ...over, status, canManage });

  test("cancelled orders have no actions for anyone", () => {
    expect(panel("cancelled", true).any).toBe(false);
    expect(panel("cancelled", false).any).toBe(false);
  });
  test("done orders only offer the owner an edit", () => {
    expect(panel("done", false).any).toBe(false);
    expect(panel("done", true)).toMatchObject({ primary: false, edit: true, any: true });
  });
  test("pending: claim is offered, edit is not", () => {
    expect(panel("pending", false, { mine: false })).toMatchObject({ primary: true, edit: false });
  });
  test("claimed: belongs to the fulfiller, but is not yet placed or paid", () => {
    expect(panel("claimed", false)).toMatchObject({ primary: true, edit: false, flag: true });
    expect(panel("claimed", false, { mine: false, hasBuyerSlack: false }).any).toBe(false);
    expect(panel("claimed", true, { mine: false }).primary).toBe(true);
  });
  test("shipped: only owners can close it", () => {
    expect(panel("shipped", false).primary).toBe(false);
    expect(panel("shipped", true).primary).toBe(true);
    expect(panel("shipped", false).flag).toBe(false);
  });
  test("someone else's claimed order is read-only for a fulfiller", () => {
    const p = panel("ordered", false, { mine: false, hasBuyerSlack: false });
    expect(p.any).toBe(false);
  });
  test("an owner can take over someone else's order", () => {
    expect(panel("credited", true, { mine: false }).primary).toBe(true);
  });
  test("a flagged order can only be unflagged by an owner", () => {
    expect(panel("ordered", false, { flagged: true, hasBuyerSlack: false }).flag).toBe(false);
    expect(panel("ordered", true, { flagged: true }).flag).toBe(true);
  });
});
