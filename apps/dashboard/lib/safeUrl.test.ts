import { describe, expect, test } from "bun:test";
import { isSafeUrl, safeRedirectPath } from "./safeUrl";

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

describe("safeRedirectPath", () => {
  test("passes same-app paths through unchanged", () => {
    expect(safeRedirectPath("/review/123", "/review")).toBe("/review/123");
    expect(safeRedirectPath("/projects/7?tab=mod", "/review")).toBe("/projects/7?tab=mod");
    expect(safeRedirectPath("/notify", "/review")).toBe("/notify");
  });

  test("falls back on absolute and protocol-relative URLs", () => {
    expect(safeRedirectPath("https://evil.com", "/review")).toBe("/review");
    expect(safeRedirectPath("http://evil.com/phish", "/review")).toBe("/review");
    expect(safeRedirectPath("//evil.com", "/review")).toBe("/review");
    expect(safeRedirectPath("javascript:alert(1)", "/review")).toBe("/review");
    expect(safeRedirectPath("", "/review")).toBe("/review");
    expect(safeRedirectPath(null, "/review")).toBe("/review");
    expect(safeRedirectPath(undefined, "/review")).toBe("/review");
  });

  test("falls back on backslash and header-injection tricks", () => {
    expect(safeRedirectPath("/\\evil.com", "/review")).toBe("/review");
    expect(safeRedirectPath("/foo\\bar", "/review")).toBe("/review");
    expect(safeRedirectPath("/review\r\nSet-Cookie: x=1", "/review")).toBe("/review");
    expect(safeRedirectPath("/review\u2028x", "/review")).toBe("/review");
  });
});
