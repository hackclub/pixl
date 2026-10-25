import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { getProjectBudgetData } from "./budgetProjects";
import { getManualLedger, recordManualBudgetEntry, summarizeManualLedger, voidManualBudgetEntry } from "./budgetLedger";

// Runs only against CI's disposable Postgres container. All objects live in a
// unique test schema, never the application schema or a production connection.
const url = process.env.PIXL_TEST_DATABASE_URL;
const db = url ? postgres(url, { max: 1 }) : null;
const schema = "budget_test_" + process.pid + "_" + Math.floor(Math.random() * 10000000);
const run = db ? describe : describe.skip;
const owner = "00000000-0000-4000-8000-000000000001";
const collaborator = "00000000-0000-4000-8000-000000000002";

run("budget projections and cash entries against real PostgreSQL", () => {
  beforeAll(async () => {
    if (!db) return;
    await db.unsafe("CREATE SCHEMA " + schema);
    await db.unsafe("SET search_path TO " + schema);
    await db.unsafe(`
      CREATE TABLE users (id uuid PRIMARY KEY, slack_id text);
      CREATE TABLE projects (
        id bigint PRIMARY KEY, user_id uuid, name text, status text, kind text,
        level numeric, hackatime_seconds numeric, first_pass_hours numeric,
        first_pass_verdict text, prior_approved_hours numeric, funding_usd numeric,
        needs_funding boolean, sidequest_id bigint, trial_reward_choice text,
        banned_at timestamptz, archived_at timestamptz, rejected_at timestamptz,
        shipped_at timestamptz, approved_hours numeric
      );
      CREATE TABLE project_journals (
        project_id bigint, user_id uuid, hours numeric, approved_hours numeric
      );
      CREATE TABLE project_collaborators (
        project_id bigint, user_id uuid, status text, approved_hours numeric,
        prior_approved_hours numeric, hackatime_seconds numeric
      );
      CREATE TABLE pixel_transactions (
        project_id bigint, user_id uuid, amount numeric, hours numeric,
        reason text, created_at timestamptz DEFAULT now()
      );
      CREATE TABLE audit_log (
        id bigserial PRIMARY KEY, at timestamptz DEFAULT now(), app text NOT NULL,
        actor_type text, actor_id text, slack_id text, action text,
        target text, result text NOT NULL, meta jsonb NOT NULL DEFAULT '{}'::jsonb
      );
    `);
    await db`INSERT INTO users VALUES (${owner}, 'OWNER'), (${collaborator}, 'COLLAB')`;
    await db`INSERT INTO projects
      (id,user_id,name,status,kind,level,hackatime_seconds,
        first_pass_hours,first_pass_verdict,prior_approved_hours,
        funding_usd,needs_funding,approved_hours)
      VALUES
      (1,${owner},'Already paid','approved','software',2,72000,NULL,NULL,NULL,0,false,20),
      (2,${owner},'New review','shipped','software',1,3600,NULL,NULL,0,2,true,NULL),
      (3,${owner},'Reship update','second_review','software',1,28800,8,'approved',4,0,false,NULL)
    `;
    await db`INSERT INTO project_journals VALUES (2, ${owner}, 1, NULL)`;
    await db`INSERT INTO project_collaborators VALUES (2, ${collaborator}, 'accepted', NULL, NULL, 10800)`;
    await db`INSERT INTO pixel_transactions(project_id,user_id,amount,hours,reason)
      VALUES (1, ${owner}, 1000, 20, 'project_approved'),
             (3, ${owner}, 150, 4, 'project_approved')`;
  });

  afterAll(async () => {
    if (!db) return;
    await db.unsafe("SET search_path TO public");
    await db.unsafe("DROP SCHEMA " + schema + " CASCADE");
    await db.end();
  });

  test("pending, reship, collaborator and historic payout queries execute with real SQL", async () => {
    if (!db) return;
    const summary = await getProjectBudgetData(db);
    expect(summary.reviewProjectCount).toBe(2);
    const fresh = summary.pendingProjects.find((p) => p.id === 2)!;
    expect(fresh.hours).toBe(2);
    expect(fresh.contributorCount).toBe(2);
    expect(fresh.additionalHours).toBe(5);
    expect(fresh.sponsorValueCents).toBe(4250);
    expect(fresh.estimatedPayoutCents).toBeGreaterThan(0);
    const update = summary.pendingProjects.find((p) => p.id === 3)!;
    expect(update.hours).toBe(8);
    expect(update.additionalHours).toBe(4);
    expect(update.sponsorValueCents).toBe(3400);
    expect(summary.paidProjects.find((r) => r.projectId === 1)?.effectiveUsdPerHour).toBe(5);
  });

  test("owner income, planned expense and void history round-trip through audit_log", async () => {
    if (!db) return;
    const income = {
      direction: "income" as const, state: "settled" as const, label: "Grant received",
      note: "", amountCents: 5000, occurredOn: "2026-10-25", actor: "OWNER",
    };
    await recordManualBudgetEntry(income, db);
    await recordManualBudgetEntry({
      ...income, label: "Hosting next month", direction: "expense", state: "planned", amountCents: 1000,
    }, db);
    const raw = await db`SELECT id, app, action, result, meta::text AS meta FROM audit_log`;
    expect(raw.length).toBe(2);
    expect(JSON.parse(String(raw[0]?.meta))).toMatchObject({ amountCents: 5000, direction: "income" });
    let entries = await getManualLedger(db);
    expect(entries.length).toBe(2);
    expect(summarizeManualLedger(entries)).toEqual({
      settledIncomeCents: 5000, settledExpenseCents: 0,
      plannedIncomeCents: 0, plannedExpenseCents: 1000,
    });
    expect(await voidManualBudgetEntry(entries.find((e) => e.direction === "income")!.id, "OWNER", "Duplicate record", db)).toBe(true);
    entries = await getManualLedger(db);
    expect(summarizeManualLedger(entries).settledIncomeCents).toBe(0);
    expect(entries.find((e) => e.direction === "income")?.voidReason).toBe("Duplicate record");
  });
});