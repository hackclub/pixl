import { describe, expect, test } from "bun:test";
import { queueWaitSince, queueWaitStartMs } from "./queueWait";

const FIRST = "2026-08-28T11:18:00.000Z";
const RESHIP = "2026-10-10T08:31:00.000Z";

describe("queueWaitSince", () => {
  test("a first ship waits since its first ship", () => {
    expect(queueWaitSince({ first_shipped_at: FIRST, shipped_at: FIRST, is_update: false })).toBe(FIRST);
  });

  test("a fix-and-reship after changes keeps counting from the first ship", () => {
    expect(queueWaitSince({ first_shipped_at: FIRST, shipped_at: RESHIP, is_update: false })).toBe(FIRST);
  });

  test("an update ship of an approved project starts a fresh wait at that ship", () => {
    expect(queueWaitSince({ first_shipped_at: FIRST, shipped_at: RESHIP, is_update: true })).toBe(RESHIP);
  });

  test("falls back to whichever date exists", () => {
    expect(queueWaitSince({ first_shipped_at: null, shipped_at: RESHIP, is_update: false })).toBe(RESHIP);
    expect(queueWaitSince({ first_shipped_at: FIRST, shipped_at: null, is_update: true })).toBe(FIRST);
    expect(queueWaitSince({})).toBeNull();
  });
});

describe("queueWaitStartMs", () => {
  test("an update sorts after a project that has genuinely waited longer", () => {
    const update = queueWaitStartMs({ first_shipped_at: FIRST, shipped_at: RESHIP, is_update: true });
    const longWait = queueWaitStartMs({
      first_shipped_at: "2026-09-10T21:42:00.000Z",
      shipped_at: "2026-09-30T23:10:00.000Z",
      is_update: false,
    });
    expect(longWait).toBeLessThan(update);
  });

  test("no date at all is 0", () => {
    expect(queueWaitStartMs({})).toBe(0);
  });
});
