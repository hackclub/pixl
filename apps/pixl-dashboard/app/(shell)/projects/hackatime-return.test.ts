import { describe, expect, test } from "bun:test";
import { hackatimeReturnNotice } from "./hackatime-return";

describe("hackatimeReturnNotice", () => {
  test("no flow return shows nothing", () => {
    expect(hackatimeReturnNotice(null, null)).toBeNull();
    expect(hackatimeReturnNotice("bogus", null)).toBeNull();
  });

  test("success is a good notice", () => {
    expect(hackatimeReturnNotice("connected", null)).toEqual({ text: "Hackatime connected.", bad: false });
  });

  test("known failure reasons get specific copy", () => {
    expect(hackatimeReturnNotice("failed", "account_mismatch")?.text).toContain("different Slack account");
    expect(hackatimeReturnNotice("failed", "no_slack_id")?.text).toContain("isn't linked to Slack");
  });

  test("unknown or missing reasons fall back to generic copy", () => {
    const generic = hackatimeReturnNotice("failed", null);
    expect(generic?.bad).toBe(true);
    expect(hackatimeReturnNotice("failed", "toString")).toEqual(generic);
    expect(hackatimeReturnNotice("failed", "<script>")).toEqual(generic);
  });
});
