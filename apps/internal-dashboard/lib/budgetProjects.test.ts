import { describe, expect, test } from "bun:test";
import { candidateProjectHours, estimatedOutstandingPx } from "./budgetProjects";
describe("review queue budget projections", () => {
  test("hardware owner journalling isn't added on top of tracked hours twice", () => {
    expect(candidateProjectHours({
      kind: "hardware", trackedSeconds: 36000, ownerRawJournalHours: 2,
      journalHours: 5, firstPassHours: null, firstPassVerdict: null, status: "shipped",
    })).toBe(13);
  });
  test("software combines tracking and journals and uses first-pass approval when available", () => {
    const p = { kind: "software", trackedSeconds: 3600, ownerRawJournalHours: 0,
      journalHours: 2, firstPassHours: 2.5, firstPassVerdict: "approved" };
    expect(candidateProjectHours({ ...p, status: "shipped" })).toBe(3);
    expect(candidateProjectHours({ ...p, status: "second_review" })).toBe(2.5);
    expect(candidateProjectHours({ ...p, status: "fraud_review", firstPassVerdict: "banned" })).toBe(3);
  });
  test("funding offsets, prior credits and capped negative liability", () => {
    expect(estimatedOutstandingPx(10, 5, 0, 0)).toBe(500);
    expect(estimatedOutstandingPx(10, 5, 10, 0)).toBe(400);
    expect(estimatedOutstandingPx(10, 5, 0, 350)).toBe(150);
    expect(estimatedOutstandingPx(10, 5, 0, 600)).toBe(0);
  });
});