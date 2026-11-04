import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { db } from "../db/pgCompat.js";
import exploreRouter, { EARNING_REASONS, leaderboardDeps, MAX_SEARCH_LENGTH, PUBLIC_PROJECT_COLUMNS, searchText } from "./explore.js";

// Same catalog projects.ts's toPlayerProject keeps off player-facing
// responses - reviewer identity/notes, ban/hold, Robert/fraud, internal IDs,
// review drafts. This is the actual "sensitive field" list for the
// projects table, not a list invented for this test.
const SENSITIVE_PROJECT_FIELDS = [
  "ban_by",
  "ban_reason",
  "reviewing_by",
  "first_pass_by",
  "first_pass_note",
  "first_pass_verdict",
  "system_note",
  "review_note_by",
  "reject_by",
  "hold_by",
  "hold_reason",
  "spot_checked_by",
  "spot_checked_at",
  "review_draft",
  "review_draft_by",
  "review_draft_at",
  "airtable_record_id",
  "robert_project_id",
  "robert_submitted_at",
  "robert_trust_score",
  "robert_note",
  "robert_reviewed_at",
  "robert_state",
  "robert_outcome",
  "robert_outcome_at",
  "robert_error",
];

// build() is private to TypeScript only; at runtime it's an ordinary method
// (see db/pgCompat.test.ts), which lets these assert on the real SQL text a
// query produces without a live database.
function selectClauseFor(columns: string): string {
  const { text } = (
    db.from("projects").select(columns) as unknown as { build(): { text: string } }
  ).build();
  const match = text.match(/^select (.*?) from /i);
  if (!match) throw new Error(`could not find a SELECT clause in: ${text}`);
  return match[1];
}

describe("PUBLIC_PROJECT_COLUMNS", () => {
  test("lists no sensitive field", () => {
    const cols = PUBLIC_PROJECT_COLUMNS.split(",").map((c) => c.trim());
    for (const field of SENSITIVE_PROJECT_FIELDS) expect(cols).not.toContain(field);
  });

  test("the actual SQL SELECT clause it produces asks for no sensitive column", () => {
    const clause = selectClauseFor(PUBLIC_PROJECT_COLUMNS);
    for (const field of SENSITIVE_PROJECT_FIELDS) expect(clause).not.toContain(`"${field}"`);
  });

  test("the actual SQL SELECT clause still asks for every field the public routes rely on", () => {
    const clause = selectClauseFor(PUBLIC_PROJECT_COLUMNS);
    for (const field of [
      "id", "user_id", "name", "description", "project_type", "level", "status",
      "image_url", "repo_url", "demo_url", "shipped_at", "created_at",
      "hackatime_seconds", "is_peak",
    ]) {
      expect(clause).toContain(`"${field}"`);
    }
  });

  test("a real DB response object built from these columns has no sensitive key", () => {
    // Simulates the shape a matching Postgres row would actually have -
    // exactly the requested columns, nothing else - then checks the same
    // route-level spread (`...p`) explore.ts uses can't surface a
    // sensitive key that was never fetched in the first place.
    const row: Record<string, unknown> = {};
    for (const c of PUBLIC_PROJECT_COLUMNS.split(",").map((c) => c.trim())) row[c] = "x";
    const responseProject = { ...row, owner_name: "someone", upvotes: 0 };
    for (const field of SENSITIVE_PROJECT_FIELDS) expect(field in responseProject).toBe(false);
  });
});

describe("every public projects-table query in explore.ts uses the allowlist", () => {
  // Not every projects-table select in this file needs to be the full public
  // allowlist verbatim - a narrower select (e.g. just "id, user_id" for an
  // ownership map) is fine, safer even. What must never happen is a route
  // asking for "*" or any sensitive column, on any of these calls.
  test("no route ever selects a sensitive column (or *) for the projects table", () => {
    const source = readFileSync(new URL("./explore.ts", import.meta.url), "utf-8");
    const calls = [...source.matchAll(/from\("projects"\)\s*\.select\(([^)]*)\)/g)];
    expect(calls.length).toBeGreaterThan(0); // fails loudly if the source shape ever changes
    for (const [, rawArg] of calls) {
      const arg = rawArg.trim();
      expect(arg).not.toBe('"*"');
      expect(arg).not.toBe("'*'");
      const literal = arg.match(/^['"](.*)['"]$/);
      const columns =
        arg === "PUBLIC_PROJECT_COLUMNS"
          ? PUBLIC_PROJECT_COLUMNS
          : (literal?.[1] ?? arg);
      const cols = columns.split(",").map((c) => c.trim());
      for (const field of SENSITIVE_PROJECT_FIELDS) expect(cols).not.toContain(field);
    }
  });
});

describe("explore bounds", () => {
  test("search text is capped", () => {
    expect(searchText("a".repeat(5000))).toHaveLength(MAX_SEARCH_LENGTH);
    expect(searchText("  ada  ")).toBe("ada");
    expect(searchText(["x"])).toBe("");
  });

  async function board(
    path: string,
    opts?: { query?: (text: string) => Record<string, unknown>[]; dbData?: unknown[] },
  ) {
    const { createServer } = await import("node:http");
    const express = (await import("express")).default;
    const { issueSessionToken } = await import("../auth/session.js");
    const { bearer, testAuthGate } = await import("../http/testkit.js");
    const queries: { text: string; params: unknown[] }[] = [];
    const realQuery = leaderboardDeps.query;
    const realFrom = db.from;
    leaderboardDeps.query = async (text, params) => {
      queries.push({ text, params });
      if (opts?.query) return opts.query(text);
      return text.includes("limit $1")
        ? [{ id: "u-top", total: 12, rewarded: 10, pixels: 50, n: 7 }]
        : [{ id: "u-me", total: 2, rewarded: 0, pixels: 0, n: 1 }];
    };
    db.from = (() => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "in", "lte", "gt", "is", "eq", "gte", "lt"]) c[m] = () => c;
      c.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: opts?.dbData ?? [{ id: "u-top", display_name: "Top" }], error: null }).then(r);
      return c;
    }) as unknown as typeof db.from;
    const app = express();
    app.use(testAuthGate());
    app.use(exploreRouter);
    const server = createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      const token = issueSessionToken({ client: "web", userId: "u-me", displayName: "Me" });
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: bearer(token) });
      return { body: (await res.json()) as Record<string, unknown>, queries };
    } finally {
      leaderboardDeps.query = realQuery;
      db.from = realFrom;
      await new Promise<void>((r) => server.close(() => r()));
    }
  }

  test("the referral board aggregates and limits in SQL", async () => {
    const r = await board("/api/explore/leaderboard/referrals");
    expect(r.queries.every((q) => /group by/i.test(q.text))).toBe(true);
    expect(r.queries[0].params).toEqual([25]);
    expect(r.body.players).toEqual([{ rank: 1, display_name: "Top", value: 12, rewarded: 10, pixels: 50 + 119, you: false }]);
    expect(r.body.yourValue).toBe(2);
  });

  test("the upvote board aggregates and limits in SQL", async () => {
    const r = await board("/api/explore/leaderboard/upvotes");
    expect(r.queries.every((q) => /group by/i.test(q.text))).toBe(true);
    expect(r.body.players).toEqual([{ rank: 1, display_name: "Top", value: 7, you: false }]);
    expect(r.body.yourValue).toBe(1);
  });

  test("the pixel board ranks by pixels earned, not balance", async () => {
    const r = await board("/api/explore/leaderboard", {
      dbData: [],
      query: (text) =>
        text.includes("limit $1")
          ? [
              { id: "u-top", display_name: "Top", skin: "cvc:1", earned: "1234.40" },
              { id: "u-me", display_name: "Me", skin: "cvc:2", earned: "20.00" },
            ]
          : [{ earned: "20.00", rank: 2 }],
    });
    expect(r.queries.every((q) => /pixel_transactions/.test(q.text) && !/users\s*\.\s*pixels|\bu\.pixels\b/.test(q.text))).toBe(true);
    expect(r.queries[0].params).toEqual([25]);
    expect(r.body.players).toEqual([
      { rank: 1, id: "u-top", display_name: "Top", skin: "cvc:1", pixels: 1234, you: false },
      { rank: 2, id: "u-me", display_name: "Me", skin: "cvc:2", pixels: 20, you: true },
    ]);
    expect(r.body.yourRank).toBe(2);
    expect(r.body.yourPixels).toBe(20);
  });

  test("spending and refunds are not earnings", () => {
    for (const reason of ["shop_purchase", "shop_refund", "manual_grant", "manual_deduction"]) {
      expect(EARNING_REASONS as readonly string[]).not.toContain(reason);
    }
    expect(EARNING_REASONS).toContain("project_approved");
  });
});
