import { expect, test } from "bun:test";
import { buildReviewMessage, ccReply, escapeMrkdwn, reviewerToTag, shouldPostReviewAnnouncement } from "./reviewChannel";

const base = {
  playerSlackIds: ["U0AAAAAAAA"],
  projectName: "Cool <Game>",
  projectUrl: "https://example.com/x",
  note: "Nice work\n<!channel> fix the menu",
  reviewerSlackId: "U0BBBBBBBB",
};

test("changes requested names the reviewer and quotes an escaped note", () => {
  const msg = buildReviewMessage({ ...base, kind: "changes" });
  expect(msg).toContain("Hi <@U0AAAAAAAA>!");
  expect(msg).toContain("<https://example.com/x|Cool &lt;Game&gt;>");
  expect(msg).toContain("> Nice work\n> &lt;!channel&gt; fix the menu");
  expect(msg).toContain("especially requested by <@U0BBBBBBBB>");
});

test("first pass and final approval use their own wording", () => {
  expect(buildReviewMessage({ ...base, kind: "first_pass" })).toContain("pending for a second review");
  const final = buildReviewMessage({ ...base, kind: "final", pixels: 120, playerSlackIds: ["U0AAAAAAAA", "U0CCCCCCCC"] });
  expect(final).toContain("Hi <@U0AAAAAAAA>, <@U0CCCCCCCC>!");
  expect(final).toContain("*120 pixels* were granted");
  expect(final).toContain("This approval was made by <@U0BBBBBBBB>");
});

test("falls back to a bold name without a link", () => {
  expect(buildReviewMessage({ ...base, kind: "changes", projectUrl: null })).toContain("*Cool &lt;Game&gt;*");
});

test("opting out of being named gives no reviewer id and a cc to Gabin", () => {
  expect(reviewerToTag("U0BBBBBBBB", true)).toBe("U0BBBBBBBB");
  expect(reviewerToTag("U0BBBBBBBB", false)).toBeNull();
  expect(reviewerToTag("not-an-id", true)).toBeNull();
  expect(ccReply("U0BBBBBBBB")).toBeNull();
  expect(ccReply(null)).toBe("cc <@U0A2SJ7B739>");
});

test("an anonymous reviewer is called a reviewer, never tagged", () => {
  for (const kind of ["changes", "first_pass", "final"] as const) {
    const msg = buildReviewMessage({ ...base, kind, reviewerSlackId: null });
    expect(msg).toContain("by a reviewer,");
    expect(msg).not.toContain("U0A2SJ7B739");
  }
});

test("escaping helpers", () => {
  expect(escapeMrkdwn("a & <b>")).toBe("a &amp; &lt;b&gt;");
});

test("the final approval names the tier only when it is given", () => {
  const base = { kind: "final" as const, playerSlackIds: ["U0AAAAAAAA"], projectName: "P", projectUrl: null, note: "n", reviewerSlackId: null, pixels: 10 };
  expect(buildReviewMessage({ ...base, tier: 3 })).toContain("approved at *tier 3*");
  expect(buildReviewMessage(base)).not.toContain("tier");
});

test("every review verdict posts publicly to Pixorpheus", () => {
  expect(shouldPostReviewAnnouncement("changes")).toBe(true);
  expect(shouldPostReviewAnnouncement("first_pass")).toBe(true);
  expect(shouldPostReviewAnnouncement("final")).toBe(true);
});
