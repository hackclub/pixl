import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { db } from "../db/pgCompat.js";
import { PUBLIC_PROJECT_COLUMNS } from "./explore.js";

// Same catalog projects.ts's redactStaffFields keeps off player-facing
// responses - reviewer identity/notes, ban/hold, Joe/fraud, internal IDs,
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
  "joe_project_id",
  "joe_submitted_at",
  "joe_trust_score",
  "joe_outcome",
  "joe_reason",
  "joe_reviewed_at",
  "joe_reviewer",
  "joe_error",
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
