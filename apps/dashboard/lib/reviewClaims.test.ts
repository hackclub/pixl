import { describe, expect, test } from "bun:test";
import { annotateClaims, REVIEW_LOCK_MS, type ShippedProject } from "./db";

// Only the claim fields matter here; the rest of ShippedProject is filler.
function project(over: Partial<ShippedProject> = {}): ShippedProject {
  return {
    id: 1,
    reviewing_by: null,
    reviewing_at: null,
    ...over,
  } as unknown as ShippedProject;
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe("annotateClaims", () => {
  test("tags a project another reviewer is actively holding", () => {
    const [p] = annotateClaims(
      [project({ reviewing_by: "U_OTHER", reviewing_at: ago(60_000) })],
      "U_ME",
    );
    expect(p!.claimedBy).toBe("U_OTHER");
  });

  test("keeps the row rather than dropping it", () => {
    const rows = annotateClaims(
      [
        project({ id: 1, reviewing_by: "U_OTHER", reviewing_at: ago(60_000) }),
        project({ id: 2 }),
      ],
      "U_ME",
    );
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
  });

  test("does not tag the viewer's own claim", () => {
    const [p] = annotateClaims(
      [project({ reviewing_by: "U_ME", reviewing_at: ago(60_000) })],
      "U_ME",
    );
    expect(p!.claimedBy).toBeUndefined();
  });

  test("does not tag a claim that has already expired", () => {
    const [p] = annotateClaims(
      [project({ reviewing_by: "U_OTHER", reviewing_at: ago(REVIEW_LOCK_MS + 1000) })],
      "U_ME",
    );
    expect(p!.claimedBy).toBeUndefined();
  });

  test("does not tag a reviewing_by with no timestamp to age it", () => {
    const [p] = annotateClaims(
      [project({ reviewing_by: "U_OTHER", reviewing_at: null })],
      "U_ME",
    );
    expect(p!.claimedBy).toBeUndefined();
  });

  test("tags every holder when there is no viewer", () => {
    const [p] = annotateClaims([
      project({ reviewing_by: "U_OTHER", reviewing_at: ago(60_000) }),
    ]);
    expect(p!.claimedBy).toBe("U_OTHER");
  });
});
