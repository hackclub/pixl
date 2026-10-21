import { describe, expect, test } from "bun:test";
import { createShipsProvider } from "./ships";

const live = process.env.PIXL_TEST_SHIPS_LIVE === "1";

describe.skipIf(!live)("public Ships API (read-only)", () => {
  test("downloads the dataset once, validates it and indexes PIXL entries", async () => {
    let calls = 0;
    const real = fetch;
    const p = createShipsProvider({
      fetchImpl: ((u: string | URL | Request, i?: RequestInit) => {
        calls++;
        return real(u, i);
      }) as typeof fetch,
    });
    const first = await p.get();
    const second = await p.get();
    expect(first.error).toBeNull();
    expect(calls).toBe(1);
    const s = second.snapshot!;
    expect(s.totalReturned).toBeGreaterThan(s.pixlCount);
    expect(s.pixlCount).toBeGreaterThan(0);
    expect(s.byId.size + s.invalidCount + s.duplicateCount).toBe(s.pixlCount);
    for (const e of s.byId.values()) {
      expect(Number.isFinite(e.hours) && e.hours >= 0).toBe(true);
    }
    console.log(
      JSON.stringify({
        totalEntries: s.totalReturned,
        pixlEntries: s.pixlCount,
        usable: s.byId.size,
        invalid: s.invalidCount,
        duplicateIds: s.duplicateCount,
        withApproval: [...s.byId.values()].filter((e) => e.approvedAt != null).length,
        withSlackId: [...s.byId.values()].filter((e) => e.slackId).length,
        fractionalHours: [...s.byId.values()].filter((e) => !Number.isInteger(e.hours)).length,
        sharedRepos: [...s.byRepo.values()].filter((l) => l.length > 1).length,
        bytes: s.bytes,
        fetchedAt: new Date(second.fetchedAt!).toISOString(),
      }),
    );
  });
});
