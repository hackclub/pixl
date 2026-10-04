import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// actions.ts is a "use server" module full of DB calls, so these read the
// source (same approach as the operations permission test) to pin down that
// every path that bans a project pays the banning reviewer.
const src = readFileSync(join(import.meta.dir, "../app/actions.ts"), "utf8");

function body(name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport async function ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("project ban payout", () => {
  test("banProject (the admin Ban project button) pays the banning reviewer the ban rate", () => {
    expect(body("banProject")).toContain('recordSettledPayout(projectId, access, "banned", project.name)');
  });

  test("banProject doesn't pay again for a project that was already banned", () => {
    const b = body("banProject");
    expect(b).toContain("banned_at");
    expect(b).toMatch(/!target\??\.banned_at|alreadyBanned/);
  });

  test("the review-form ban verdict still pays", () => {
    expect(body("reviewProject")).toContain('recordSettledPayout(projectId, access, "banned", project.name)');
  });

  test("a ban pays a flat 2 pixels", () => {
    expect(src).toContain("const BAN_PAYOUT_PIXELS = 2;");
  });
});
