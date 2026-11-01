import { describe, expect, test } from "bun:test";
import { createHalceonProvider, HALCEON_PIXL_URL, parseHalceonPixlHtml } from "./halceon";
import { matchShips } from "./shipsMatch";

const link = (url: string, text: string) => '<a href="' + url + '">' + text + "</a>";
const row = (repo: string, slack: string | null, hours: string, date: string, program = "Pixl") =>
  "<tr><td>" +
  (slack ? link("/p/" + slack, "profile") : "private") +
  '</td><td>' + program + '</td><td><h3>Demo</h3></td><td>' + hours +
  "</td><td>0</td><td>IN</td><td>" + date + "</td><td>" +
  link("https://github.com/" + repo, "repo") + "</td></tr>";
const table = (...rows: string[]) =>
  '<html><table><tr><th>User</th><th>Program</th><th>Description</th><th>Hrs</th><th>★</th><th>Country</th><th>Approved</th><th>Links</th></tr>' +
  rows.join("") + "</table></html>";
const now = Date.parse("2026-11-02T00:00:00Z");
const sample = table(
  row("Demo/Alpha", "U0123456789", "9", "2026-10-30"),
  row("Demo/Alpha", "U0123456789", "12", "2026-11-01"),
  row("other/NotPixl", "U0123456789", "1", "2026-10-30", "Terra"),
  row("bob/Beta", "U0987654321", "3", "2026-10-30"),
);

describe("Halceon submission parser", () => {
  test("accepts only exact Pixl records and keeps separate update ships", () => {
    const snap = parseHalceonPixlHtml(sample, now);
    expect(snap.source).toBe("halceon");
    expect(snap.pixlCount).toBe(3);
    expect(snap.byRepo.get("github.com/demo/alpha")?.map(x => x.hours)).toEqual([9, 12]);
    expect(snap.byRepo.has("github.com/other/notpixl")).toBe(false);
    expect(snap.byRepo.get("github.com/bob/beta")?.[0]?.slackId).toBe("U0987654321");
    expect([...snap.byId.keys()].every(x => x.startsWith("halceon:"))).toBe(true);
  });

  test("rejects empty, truncated and malformed pages instead of treating them as no approvals", () => {
    expect(() => parseHalceonPixlHtml("<html>Error</html>", now)).toThrow();
    expect(() => parseHalceonPixlHtml(table(), now)).toThrow();
    expect(() => parseHalceonPixlHtml(table(row("demo/alpha", "U0123456789", "oops", "2026-11-01")), now)).toThrow();
  });

  test("a mapped Unified ID cannot incorrectly select one of multiple update ships", () => {
    const snap = parseHalceonPixlHtml(sample, now);
    const view = { snapshot: snap, fetchedAt: now, ageMs: 0, fresh: true, error: null, lastAttemptAt: null, nextRetryAt: null };
    const mapping = { kind: "mapped" as const, stagingId: "recStaging", unifiedId: "recAAAAAAAAAAAAAA" };
    expect(matchShips(view, { mapping, repoKey: "github.com/demo/alpha", playerSlackId: "U0123456789" }, now).state).toBe("ambiguous");
    expect(matchShips(view, { mapping, repoKey: "github.com/bob/beta", playerSlackId: "U0123456789" }, now).state).toBe("identity_mismatch");
    const ok = matchShips(view, { mapping, repoKey: "github.com/bob/beta", playerSlackId: "U0987654321" }, now);
    expect(ok.state).toBe("approved");
    expect(ok.matchedBy).toBe("repo_slack");
    expect(ok.recordId).toBeNull();
    expect(ok.hours).toBe(3);
  });

  test("unmapped, disputed, and missing-identity records cannot establish approval", () => {
    const snap = parseHalceonPixlHtml(sample, now);
    const view = { snapshot: snap, fetchedAt: now, ageMs: 0, fresh: true, error: null, lastAttemptAt: null, nextRetryAt: null };
    expect(matchShips(view, { mapping: { kind: "empty", stagingId: "rec123" }, repoKey: "github.com/bob/beta", playerSlackId: "U0987654321" }, now).state).toBe("no_record");
    expect(matchShips(view, { mapping: { kind: "mapped", stagingId: "rec123", unifiedId: "recAAA" }, repoKey: "github.com/bob/beta", playerSlackId: null }, now).state).toBe("ambiguous");
  });

  test("fetches no credentials; caches a valid result and fails closed on malformed refresh", async () => {
    let tick = now;
    let calls = 0;
    const fetchImpl: typeof fetch = async (url, options) => {
      expect(url).toBe(HALCEON_PIXL_URL);
      expect(options?.method).toBe("GET");
      expect(JSON.stringify(options?.headers)).not.toContain("Authorization");
      calls++;
      return new Response(calls === 1 ? sample : "<p>bad</p>", { status: 200 });
    };
    const p = createHalceonProvider({ fetchImpl, now: () => tick, ttlMs: 1000 });
    expect((await p.get()).snapshot?.pixlCount).toBe(3);
    expect((await p.get()).snapshot?.pixlCount).toBe(3);
    expect(calls).toBe(1);
    tick += 1200;
    const after = await p.get();
    expect(after.snapshot?.pixlCount).toBe(3);
    expect(after.error).toBeTruthy();
    expect(after.fresh).toBe(false);
    expect(calls).toBe(2);
  });
});
