import { expect, test } from "bun:test";
import { vaultDeleteFailure } from "./vaultDelete";

test("no error means the delete went through", () => {
  expect(vaultDeleteFailure(null)).toBeNull();
});

test("a restrict or foreign key violation is reported as settled", () => {
  expect(vaultDeleteFailure({ code: "23001", message: "x" })).toContain("settled");
  expect(vaultDeleteFailure({ code: "23503", message: "x" })).toContain("settled");
});

test("any other database error fails closed instead of reading as success", () => {
  const out = vaultDeleteFailure({ code: "08006", message: "connection lost" });
  expect(out).not.toBeNull();
  expect(out).not.toContain("settled");
  expect(vaultDeleteFailure({ message: "no code" })).not.toBeNull();
});
