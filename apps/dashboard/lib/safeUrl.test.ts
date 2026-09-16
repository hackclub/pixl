import { describe, expect, test } from "bun:test";
import { isSafeUrl } from "./safeUrl";

describe("isSafeUrl", () => {
  test("rejects dangerous schemes", () => {
    expect(isSafeUrl("javascript://alert(1)")).toBe(false);
    expect(isSafeUrl("javascript://%0aalert(1)")).toBe(false);
    expect(isSafeUrl("JaVaScRiPt://alert(1)")).toBe(false);
    expect(isSafeUrl("data://text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeUrl("vbscript://alert(1)")).toBe(false);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
  });

  test("accepts plain http(s) links", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
    expect(isSafeUrl("http://example.com")).toBe(true);
    expect(isSafeUrl("https://github.com/user/repo")).toBe(true);
  });

  test("accepts relative, same-app links", () => {
    expect(isSafeUrl("/players/123")).toBe(true);
  });

  test("rejects empty/blank/missing values", () => {
    expect(isSafeUrl("")).toBe(false);
    expect(isSafeUrl("   ")).toBe(false);
    expect(isSafeUrl(null)).toBe(false);
    expect(isSafeUrl(undefined)).toBe(false);
  });
});
