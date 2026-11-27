import { describe, expect, test } from "bun:test";
import { reviewThreadUrl } from "./reviewThread";

describe("reviewThreadUrl", () => {
  test("builds the permalink of a verdict post in #pixl-checkpoint", () => {
    expect(reviewThreadUrl("1795020833.419709")).toBe(
      "https://hackclub.slack.com/archives/C0C78RZMX1T/p1795020833419709",
    );
  });
  test("no link without a valid ts", () => {
    expect(reviewThreadUrl(null)).toBeNull();
    expect(reviewThreadUrl("")).toBeNull();
    expect(reviewThreadUrl("not-a-ts")).toBeNull();
  });
});
