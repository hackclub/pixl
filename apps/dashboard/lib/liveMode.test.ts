import { describe, expect, test } from "bun:test";
import {
  LIVE_MODE_COOKIE,
  LIVE_SHOW_REVIEWERS_COOKIE,
  isLiveModeValue,
  liveAlias,
  redactBuilderDetails,
  reviewerName,
} from "./liveMode";

describe("isLiveModeValue", () => {
  test("only the literal '1' turns live mode on", () => {
    expect(isLiveModeValue("1")).toBe(true);
    expect(isLiveModeValue("0")).toBe(false);
    expect(isLiveModeValue("true")).toBe(false);
    expect(isLiveModeValue("")).toBe(false);
    expect(isLiveModeValue(undefined)).toBe(false);
  });

  test("cookie name is stable", () => {
    expect(LIVE_MODE_COOKIE).toBe("pixl_live_mode");
  });
});

describe("liveAlias", () => {
  test("owner is Builder, collaborators are numbered in order", () => {
    const collabs = ["u2", "u3"];
    expect(liveAlias("u1", "u1", collabs)).toBe("Builder");
    expect(liveAlias("u2", "u1", collabs)).toBe("Contributor 1");
    expect(liveAlias("u3", "u1", collabs)).toBe("Contributor 2");
  });

  test("unknown ids never fall back to a real name", () => {
    expect(liveAlias("zzz", "u1", ["u2"])).toBe("Contributor");
  });
});

describe("redactBuilderDetails", () => {
  const real = {
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    ageLabel: "17 (born 2009-01-01)",
    country: "UK",
    address: "1 St James Sq, London",
  };

  test("passes values through when live mode is off", () => {
    expect(redactBuilderDetails(false, real)).toEqual(real);
  });

  test("hides every identifying field when live mode is on", () => {
    const out = redactBuilderDetails(true, real);
    expect(JSON.stringify(out)).not.toContain("Ada");
    expect(JSON.stringify(out)).not.toContain("example.com");
    expect(JSON.stringify(out)).not.toContain("2009");
    expect(JSON.stringify(out)).not.toContain("James");
    expect(JSON.stringify(out)).not.toContain("UK");
  });
});

describe("reviewerName", () => {
  const viewer = "U_ME";

  test("strips the (SlackID) suffix when names aren't hidden", () => {
    expect(reviewerName("Ada Lovelace (U_ADA)", viewer, false)).toBe("Ada Lovelace");
    expect(reviewerName("Plain Name", viewer, false)).toBe("Plain Name");
  });

  test("hides other reviewers behind 'Reviewer'", () => {
    expect(reviewerName("Ada Lovelace (U_ADA)", viewer, true)).toBe("Reviewer");
  });

  test("never hides the viewer's own name", () => {
    expect(reviewerName("Me Myself (U_ME)", viewer, true)).toBe("Me Myself");
  });

  test("a bare slack id is matched against the viewer too", () => {
    expect(reviewerName("U_ME", viewer, true)).toBe("U_ME");
    expect(reviewerName("U_ADA", viewer, true)).toBe("Reviewer");
  });

  test("a label with no slack id is hidden, since it can't be proven to be the viewer", () => {
    expect(reviewerName("Plain Name", viewer, true)).toBe("Reviewer");
  });

  test("empty labels fall back to the given default", () => {
    expect(reviewerName(null, viewer, true, "a reviewer")).toBe("a reviewer");
    expect(reviewerName("", viewer, false, "a reviewer")).toBe("a reviewer");
  });

  test("cookie name is stable", () => {
    expect(LIVE_SHOW_REVIEWERS_COOKIE).toBe("pixl_live_show_reviewers");
  });
});
