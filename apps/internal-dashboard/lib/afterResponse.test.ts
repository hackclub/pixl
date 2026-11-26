import { expect, spyOn, test } from "bun:test";
import { afterResponse } from "./afterResponse";

test("outside a request the job runs inline before the call resolves", async () => {
  let ran = false;
  await afterResponse(async () => {
    await new Promise((r) => setTimeout(r, 5));
    ran = true;
  }, "inline");
  expect(ran).toBe(true);
});

test("a failing job is logged and never thrown", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  await expect(
    afterResponse(async () => {
      throw new Error("boom");
    }, "failing"),
  ).resolves.toBeUndefined();
  expect(log.mock.calls.some((c) => String(c[0]).includes("failing"))).toBe(true);
  log.mockRestore();
});
