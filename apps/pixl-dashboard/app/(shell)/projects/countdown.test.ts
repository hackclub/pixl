import { describe, expect, test } from "bun:test";
import { formatCountdown, timeLeft } from "./countdown";

const deadline = new Date("2026-11-20T23:59:59Z");

describe("timeLeft", () => {
  test("splits the remaining time into days, hours, minutes and seconds", () => {
    const now = new Date("2026-11-08T19:28:51Z");
    expect(timeLeft(deadline, now)).toEqual({ days: 12, hours: 4, minutes: 31, seconds: 8 });
  });

  test("is null at and after the deadline", () => {
    expect(timeLeft(deadline, deadline)).toBeNull();
    expect(timeLeft(deadline, new Date("2026-11-21T00:00:00Z"))).toBeNull();
  });
});

describe("formatCountdown", () => {
  test("pads hours, minutes and seconds", () => {
    expect(formatCountdown({ days: 3, hours: 4, minutes: 5, seconds: 6 })).toBe("3d 04h 05m 06s");
  });
});
