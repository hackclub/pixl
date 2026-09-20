import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { issueSessionToken } from "../auth/session.js";
import { db } from "../db/pgCompat.js";
import projectsRouter from "./projects.js";

function chainable(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "select", "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is",
    "contains", "not", "match", "or", "order", "limit", "range", "insert",
    "upsert", "update", "delete", "single", "maybeSingle",
  ];
  for (const m of methods) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

interface Scenario {
  hcaRow: Record<string, unknown> | null;
  usersError?: { message: string };
}

async function callAs(
  scenario: Scenario,
  path: string,
  body: Record<string, unknown>,
  method = "POST",
) {
  const realFrom = db.from;
  db.from = ((table: string) => {
    if (table === "projects")
      return chainable({
        data: { id: 1, user_id: "user-1", name: "Draft", status: "draft", repo_url: null },
        error: null,
      });
    if (table === "users")
      return chainable({
        data: scenario.usersError ? null : scenario.hcaRow,
        error: scenario.usersError ?? null,
      });
    return chainable({ data: null, error: null });
  }) as typeof db.from;

  const app = express();
  app.use(express.json());
  app.use(projectsRouter);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const token = issueSessionToken({ userId: "user-1", displayName: "Player" });
    const res = await fetch(`http://127.0.0.1:${port}${path}?token=${token}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  } finally {
    db.from = realFrom;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const ship = (scenario: Scenario) =>
  callAs(scenario, "/api/projects/1/ship", { eligibilityAttested: true });

describe("POST /api/projects/:id/ship HCA gate", () => {
  test("needs_submission is told to verify with HCA", async () => {
    const r = await ship({ hcaRow: { hca_verification_status: "needs_submission", hca_ysws_eligible: null } });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("hca_verification_required");
    expect(String(r.body.message)).toContain("Verify your identity");
  });

  test("pending is told to verify with HCA", async () => {
    const r = await ship({ hcaRow: { hca_verification_status: "pending", hca_ysws_eligible: null } });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("hca_verification_required");
  });

  test("an account that has never captured HCA state is told to verify and refresh", async () => {
    const r = await ship({ hcaRow: { hca_verification_status: null, hca_ysws_eligible: null } });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("hca_verification_required");
    expect(String(r.body.message)).toContain("Log out and back in");
  });

  test("ineligible gets the ineligibility message", async () => {
    const r = await ship({ hcaRow: { hca_verification_status: "ineligible", hca_ysws_eligible: false } });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("hca_ineligible");
    expect(String(r.body.message)).toContain("not eligible");
  });

  test("verified but not ysws_eligible gets the ineligibility message", async () => {
    const r = await ship({ hcaRow: { hca_verification_status: "verified", hca_ysws_eligible: false } });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("hca_ineligible");
  });

  test("verified with no stored ysws_eligible gets the ineligibility message", async () => {
    const r = await ship({ hcaRow: { hca_verification_status: "verified", hca_ysws_eligible: null } });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("hca_ineligible");
  });

  test("verified and ysws_eligible passes the gate and reaches the normal ship checks", async () => {
    const r = await ship({ hcaRow: { hca_verification_status: "verified", hca_ysws_eligible: true } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("repo_required");
  });

  test("a failed HCA state lookup is a 500, not a silent pass", async () => {
    const r = await ship({ hcaRow: null, usersError: { message: "column does not exist" } });
    expect(r.status).toBe(500);
  });
});

describe("drafts are not gated on HCA state", () => {
  test("an ineligible player can still create a draft", async () => {
    const r = await callAs(
      { hcaRow: { hca_verification_status: "ineligible", hca_ysws_eligible: false } },
      "/api/projects",
      { name: "My draft" },
    );
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  test("a player who has not verified can still create a draft", async () => {
    const r = await callAs(
      { hcaRow: { hca_verification_status: "needs_submission", hca_ysws_eligible: null } },
      "/api/projects",
      { name: "My draft" },
    );
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});
