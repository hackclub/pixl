import { describe, expect, test } from "bun:test";
import { buildSubmission, robertExternalId } from "./robert";

const softwareProject = {
  id: 42,
  name: "My Project",
  kind: "software" as const,
  codeUrl: "https://github.com/user/repo",
  demoUrl: "https://demo.example.com",
  hackatimeProjects: ["my-project"],
  journal: [],
  shippedAt: "2026-08-15T12:00:00.000Z",
};

const hardwareProject = {
  ...softwareProject,
  kind: "hardware" as const,
  hackatimeProjects: [],
  journal: [
    { title: "Day 1", content: "Soldered the board", loggedAt: "2026-08-10T00:00:00.000Z", hours: 3 },
  ],
};

describe("robertExternalId", () => {
  test("combines the project id with the ship timestamp", () => {
    expect(robertExternalId(42, "2026-08-15T12:00:00.000Z")).toBe("pixl-42-1786795200");
  });

  test("changes when the project is re-shipped", () => {
    const first = robertExternalId(42, "2026-08-15T12:00:00.000Z");
    const second = robertExternalId(42, "2026-08-16T12:00:00.000Z");
    expect(first).not.toBe(second);
  });

  test("falls back to 0 when the project has never shipped", () => {
    expect(robertExternalId(42, null)).toBe("pixl-42-0");
  });
});

describe("buildSubmission", () => {
  test("builds a hackatime submission with the dedup id", () => {
    const result = buildSubmission(softwareProject, { slackId: "U123" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.kind).toBe("hackatime");
    expect(result.body.submitter).toEqual({ slackId: "U123" });
    expect(result.body.hackatimeProjects).toEqual(["my-project"]);
    expect(result.body.externalId).toBe("pixl-42-1786795200");
  });

  test("fails when the submitter has no slack id", () => {
    const result = buildSubmission(softwareProject, { slackId: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("no slack id");
  });

  test("treats a blank slack id as missing", () => {
    const result = buildSubmission(softwareProject, { slackId: "   " });
    expect(result.ok).toBe(false);
  });

  test("fails when there is no code link", () => {
    const result = buildSubmission({ ...softwareProject, codeUrl: null }, { slackId: "U123" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("no code link");
  });

  test("omits demoUrl when the project has none", () => {
    const result = buildSubmission({ ...softwareProject, demoUrl: "" }, { slackId: "U123" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.demoUrl).toBeUndefined();
  });

  test("fails a hackatime submission with no named hackatime projects", () => {
    const result = buildSubmission({ ...softwareProject, hackatimeProjects: [] }, { slackId: "U123" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("hackatime");
  });

  test("builds a hardware submission with its journal, no images", () => {
    const result = buildSubmission(hardwareProject, { slackId: "U123" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.kind).toBe("hardware");
    expect(result.body.journal).toEqual([
      { title: "Day 1", content: "Soldered the board", loggedAt: "2026-08-10T00:00:00.000Z", hours: 3 },
    ]);
    expect(result.body.hackatimeProjects).toBeUndefined();
  });

  test("fails a hardware submission with an empty journal", () => {
    const result = buildSubmission({ ...hardwareProject, journal: [] }, { slackId: "U123" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("journal");
  });

  test("omits a journal entry's hours when null", () => {
    const result = buildSubmission(
      { ...hardwareProject, journal: [{ title: "Day 1", content: "x", loggedAt: "2026-08-10T00:00:00.000Z", hours: null }] },
      { slackId: "U123" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.journal?.[0].hours).toBeUndefined();
  });
});
