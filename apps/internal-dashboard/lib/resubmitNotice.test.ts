import { describe, expect, test } from "bun:test";
import { resubmitNotice } from "./resubmitNotice";
import { buildReviewMessage } from "./reviewChannel";

const deadline = new Date("2026-11-20T23:59:59Z");

describe("resubmitNotice", () => {
  test("changes requested in the last 24h before the deadline: 48h after the deadline", () => {
    const n = resubmitNotice(new Date("2026-11-20T10:00:00Z"), deadline);
    expect(n).toContain("48 hours after the deadline");
    expect(n).toContain("22 Nov at 23:59 UTC");
  });

  test("the 24h range includes its start and the deadline itself", () => {
    expect(resubmitNotice(new Date("2026-11-19T23:59:59Z"), deadline)).toContain("48 hours");
    expect(resubmitNotice(deadline, deadline)).toContain("48 hours");
  });

  test("changes requested after the deadline: 24h from now", () => {
    const n = resubmitNotice(new Date("2026-11-21T10:00:00Z"), deadline);
    expect(n).toContain("24 hours to resubmit");
    expect(n).toContain("22 Nov at 10:00 UTC");
    expect(n).toContain("permanently rejected");
  });

  test("nothing to add earlier than 24h before the deadline", () => {
    expect(resubmitNotice(new Date("2026-11-19T20:00:00Z"), deadline)).toBeNull();
  });
});

describe("changes message", () => {
  const base = { kind: "changes" as const, playerSlackIds: ["U01234567"], projectName: "P", projectUrl: null, note: "fix it", reviewerSlackId: null };

  test("includes the resubmit sentence when given", () => {
    const msg = buildReviewMessage({ ...base, resubmitNote: "You have 24 hours to resubmit." });
    expect(msg).toContain("You have 24 hours to resubmit.");
    expect(msg).toContain("needs a few changes");
  });

  test("is unchanged without one", () => {
    expect(buildReviewMessage(base)).not.toContain("resubmit");
  });

  test("a final rejection says so and not 'needs a few changes'", () => {
    const msg = buildReviewMessage({ ...base, finalRejection: true });
    expect(msg).toContain("permanently rejected");
    expect(msg).not.toContain("needs a few changes");
  });
});
