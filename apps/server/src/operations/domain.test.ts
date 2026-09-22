import { describe, expect, test } from "bun:test";
import { secondsBetween } from "../hackatime/api.js";
import {
  acceptsEntries,
  blackoutPayout,
  effectiveStatus,
  eligibleTrackedSeconds,
  entryWindow,
  graceFixCapSeconds,
  journalSecondsInWindow,
  playerBlackoutLabel,
} from "./domain.js";

const H = 3600_000;
const T0 = new Date("2026-10-01T12:00:00Z");
const at = (h: number) => new Date(T0.getTime() + h * H);
const op = (status: "upcoming" | "active" | "ended" | "paused", startH = -2, endH = 24) => ({
  status,
  startsAt: at(startH),
  endsAt: at(endH),
});

describe("effectiveStatus", () => {
  test("follows the clock unless an admin paused or ended it", () => {
    expect(effectiveStatus(op("active"), T0)).toBe("active");
    expect(effectiveStatus(op("upcoming", 3, 30), T0)).toBe("upcoming");
    expect(effectiveStatus(op("active", -40, -1), T0)).toBe("ended");
    expect(effectiveStatus(op("paused"), T0)).toBe("paused");
    expect(effectiveStatus(op("ended"), T0)).toBe("ended");
  });
  test("a paused operation that has passed its end is ended, not paused", () => {
    expect(effectiveStatus(op("paused", -40, -1), T0)).toBe("ended");
  });
  test("15. only an active operation accepts entries", () => {
    expect(acceptsEntries(op("active"), T0)).toBe(true);
    for (const s of ["paused", "ended", "upcoming"] as const)
      expect(acceptsEntries(op(s, s === "upcoming" ? 5 : -2), T0)).toBe(false);
  });
});

describe("entryWindow", () => {
  const o = { startsAt: at(-10), endsAt: at(24) };
  test("3. an existing project only gets work after it joined", () => {
    const w = entryWindow({ joinedAt: at(-3), firstQualifiedShipAt: at(-1) }, o, T0);
    expect(w.start).toEqual(at(-3));
    expect(w.end).toEqual(at(-1));
  });
  test("joining before the operation started clamps to the start", () => {
    const w = entryWindow({ joinedAt: at(-50), firstQualifiedShipAt: at(-1) }, o, T0);
    expect(w.start).toEqual(at(-10));
  });
  test("4. the end is min(first ship, operation end); later work is excluded", () => {
    const shippedAfterEnd = entryWindow({ joinedAt: at(-3), firstQualifiedShipAt: at(40) }, o, T0);
    expect(shippedAfterEnd.end).toEqual(at(24));
    const open = entryWindow({ joinedAt: at(-3), firstQualifiedShipAt: null }, o, T0);
    expect(open.end).toEqual(T0);
  });
  test("6. once shipped the window ignores reship time and operation edits", () => {
    const entry = { joinedAt: at(-3), firstQualifiedShipAt: at(-1) };
    const before = entryWindow(entry, o, at(0));
    const later = entryWindow(entry, { startsAt: o.startsAt, endsAt: at(500) }, at(300));
    expect(later).toEqual(before);
  });
});

describe("journalSecondsInWindow", () => {
  const j = [
    { hours: 2, createdAt: at(-5) },
    { hours: 1.5, createdAt: at(-1) },
    { hours: 4, createdAt: at(2) },
  ];
  test("only entries created inside the window count", () => {
    expect(journalSecondsInWindow(j, at(-3), at(0))).toBe(1.5 * 3600);
  });
  test("the fix window excludes its own start (the ship instant)", () => {
    const edge = [{ hours: 1, createdAt: at(0) }, { hours: 1, createdAt: at(1) }];
    expect(journalSecondsInWindow(edge, at(0), at(2), { startExclusive: true })).toBe(3600);
    expect(journalSecondsInWindow(edge, at(0), at(2))).toBe(7200);
  });
});

describe("secondsBetween (Hackatime spans)", () => {
  const spans = [
    { start: 100, end: 200 },
    { start: 300, end: 400 },
  ];
  test("clips spans on both ends", () => {
    expect(secondsBetween(spans, 150, 350)).toBe(50 + 50);
    expect(secondsBetween(spans, 0, 1000)).toBe(200);
    expect(secondsBetween(spans, 200, 300)).toBe(0);
    expect(secondsBetween(spans, 500, 600)).toBe(0);
  });
  test("an open end behaves like the existing 'since' clip", () => {
    expect(secondsBetween(spans, 150)).toBe(50 + 100);
  });
});

describe("grace fix cap", () => {
  test("14. bounded to max(1h, 25% of the base window): grace is not a second Blackout", () => {
    expect(graceFixCapSeconds(4 * 3600)).toBe(3600);
    expect(graceFixCapSeconds(10 * 3600)).toBe(2.5 * 3600);
    expect(graceFixCapSeconds(0)).toBe(3600);
    expect(eligibleTrackedSeconds(4 * 3600, 20 * 3600)).toBe(5 * 3600);
    expect(eligibleTrackedSeconds(4 * 3600, 0.25 * 3600)).toBe(4.25 * 3600);
  });
  test("operation config can tune the cap", () => {
    expect(graceFixCapSeconds(10 * 3600, { graceFixCapRatio: 0.5 })).toBe(5 * 3600);
    expect(graceFixCapSeconds(1 * 3600, { graceFixCapMinHours: 2 })).toBe(2 * 3600);
  });
  test("never negative", () => {
    expect(eligibleTrackedSeconds(-5, -5)).toBe(0);
  });
});

// Blackout's actual rule: a flat +$1/hr bonus on top of EVERY contributor's
// own normal rate, never a floor. A $6/hr player still gets +$1 (a floor
// gave them nothing); a $5/hr player still gets +$1 too (a floor also gave
// them nothing, since 5 already met the old "minimum"). rateUsd=1 IS the
// bonus amount here, not a minimum - see domain.ts's RateMode doc comment.
describe("blackoutPayout: additive mode, effectiveRate = normalRate + 1", () => {
  const base = {
    approvedHours: 10,
    eligibleHours: 10,
    creditHours: 10,
    rateUsd: 1,
    rateMode: "additive" as const,
    pxValueUsd: 0.07,
  };

  test("$4.00/hr -> $5.00/hr effective, 1h", () => {
    const p = blackoutPayout({ ...base, approvedHours: 1, eligibleHours: 1, creditHours: 1, normalUsdRate: 4 });
    expect(p.effectiveUsdRate).toBe(5);
    expect(p.grossPx).toBe(71); // round(1h * $5 / $0.07)
    expect(p.upliftPx).toBe(14); // 71 - round(1h * $4 / $0.07) = 71 - 57
  });

  test("$4.31/hr -> $5.31/hr effective, 1h", () => {
    const p = blackoutPayout({ ...base, approvedHours: 1, eligibleHours: 1, creditHours: 1, normalUsdRate: 4.31 });
    expect(p.effectiveUsdRate).toBe(5.31);
    expect(p.grossPx).toBe(76);
    expect(p.upliftPx).toBe(14);
  });

  test("$5.00/hr -> $6.00/hr effective, 1h (a floor would have paid this nothing)", () => {
    const p = blackoutPayout({ ...base, approvedHours: 1, eligibleHours: 1, creditHours: 1, normalUsdRate: 5 });
    expect(p.effectiveUsdRate).toBe(6);
    // 15, not 14 - rounding each side independently (round(6/0.07)=86,
    // round(5/0.07)=71) doesn't land on exactly +1/0.07=14.28 every time.
    // This is the same rounding strategy the normal payout path already
    // uses; it is not a bug.
    expect(p.upliftPx).toBe(15);
    expect(p.grossPx - p.upliftPx).toBe(71); // still exactly the normal payout
  });

  test("$6.00/hr -> $7.00/hr effective, 1h (a floor would have paid this nothing)", () => {
    const p = blackoutPayout({ ...base, approvedHours: 1, eligibleHours: 1, creditHours: 1, normalUsdRate: 6 });
    expect(p.effectiveUsdRate).toBe(7);
    expect(p.grossPx).toBe(100);
    expect(p.upliftPx).toBe(14);
  });

  test("$4.31/hr, 10h: uplift scales with hours, ~$10 of bonus value", () => {
    const p = blackoutPayout({ ...base, normalUsdRate: 4.31 });
    expect(p.effectiveUsdRate).toBe(5.31);
    expect(p.upliftPx).toBe(143);
    expect(p.upliftPx * 0.07).toBeCloseTo(10.01, 2);
  });

  test("$6.00/hr, 10h: uplift scales with hours, ~$10 of bonus value", () => {
    const p = blackoutPayout({ ...base, normalUsdRate: 6 });
    expect(p.effectiveUsdRate).toBe(7);
    expect(p.upliftPx).toBe(143);
  });

  test("approved hours can never exceed the trusted ceiling or the normal credit", () => {
    expect(blackoutPayout({ ...base, approvedHours: 99, eligibleHours: 4, normalUsdRate: 4 }).hours).toBe(4);
    expect(blackoutPayout({ ...base, approvedHours: 99, creditHours: 3, normalUsdRate: 4 }).hours).toBe(3);
    expect(blackoutPayout({ ...base, approvedHours: -3, normalUsdRate: 4 }).upliftPx).toBe(0);
  });

  test("zero approved hours pays nothing", () => {
    expect(blackoutPayout({ ...base, approvedHours: 0, normalUsdRate: 4 }).upliftPx).toBe(0);
  });

  test("team members are independent: each gets their own +$1/hr, not a shared floor", () => {
    const people = [
      { hours: 6, rate: 4 },
      { hours: 3, rate: 4.5 },
      { hours: 5, rate: 6 },
    ].map((x) =>
      blackoutPayout({
        ...base,
        approvedHours: x.hours,
        eligibleHours: x.hours,
        creditHours: x.hours,
        normalUsdRate: x.rate,
      }),
    );
    expect(people.map((p) => p.hours)).toEqual([6, 3, 5]);
    expect(people.map((p) => p.effectiveUsdRate)).toEqual([5, 5.5, 7]);
    // Every one of them gets a positive uplift now, including the $6/hr
    // earner who a floor model would have paid nothing.
    expect(people.every((p) => p.upliftPx > 0)).toBe(true);
  });
});

describe("blackoutPayout: floor mode (kept generic for a future operation, not used by Blackout)", () => {
  const base = { approvedHours: 10, eligibleHours: 10, creditHours: 10, rateUsd: 5, rateMode: "floor" as const, pxValueUsd: 0.07 };
  test("normal $4 becomes $5 for the hours", () => {
    const p = blackoutPayout({ ...base, normalUsdRate: 4 });
    expect(p.effectiveUsdRate).toBe(5);
    expect(p.upliftPx).toBe(143);
  });
  test("normal $6 stays $6, nothing is added", () => {
    expect(blackoutPayout({ ...base, normalUsdRate: 6 }).upliftPx).toBe(0);
  });
});

describe("playerBlackoutLabel", () => {
  test("a reviewer's proposal stays hidden while the project is in review", () => {
    expect(playerBlackoutLabel("eligible", "second_review")).toBe("awaiting_review");
    expect(playerBlackoutLabel("ineligible", "second_review")).toBe("awaiting_review");
    expect(playerBlackoutLabel("eligible", "approved")).toBe("eligible");
    expect(playerBlackoutLabel("ineligible", "approved")).toBe("ineligible");
  });
  test("a system verdict is shown immediately", () => {
    expect(playerBlackoutLabel("ineligible", "shipped", { systemDecided: true })).toBe("ineligible");
  });
  test("every documented user-facing state is reachable", () => {
    expect(playerBlackoutLabel("entered", "draft")).toBe("entered");
    expect(playerBlackoutLabel("shipped", "shipped")).toBe("shipped");
    expect(playerBlackoutLabel("shipped", "second_review")).toBe("awaiting_review");
    expect(playerBlackoutLabel("approved", "approved")).toBe("approved");
    expect(playerBlackoutLabel("needs_changes", "needs_changes")).toBe("needs_changes");
  });
  test("19. the label is independent of unship / project state churn", () => {
    for (const s of ["draft", "shipped", "second_review", "approved"])
      expect(playerBlackoutLabel("entered", s)).toBe("entered");
  });
});
