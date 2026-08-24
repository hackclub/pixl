import { describe, expect, test } from "bun:test";
import { barTrial, levelBarCells, linkedSeconds, nextStep, shippedSeconds, type Project, type Trial } from "./lib.ts";

describe("nextStep", () => {
  test("a project needing changes outranks everything else", () => {
    const projects: Project[] = [
      { name: "Old one", status: "approved" },
      { name: "Fixer", status: "needs_changes" },
      { name: "Draftee", status: "draft" },
    ];
    expect(nextStep(projects).h).toBe("Fix up Fixer");
  });

  test("a draft outranks a shipped-and-waiting project", () => {
    const projects: Project[] = [
      { name: "In review", status: "shipped" },
      { name: "WIP", status: "draft" },
    ];
    expect(nextStep(projects).h).toBe("Ship WIP");
  });

  test("all shipped, none draft: points at the review queue", () => {
    const projects: Project[] = [{ name: "In review", status: "shipped" }];
    expect(nextStep(projects).h).toBe("You're in the review queue");
  });

  test("no projects at all: points at the first-project doc", () => {
    expect(nextStep([]).href).toBe("/docs/first-project/");
  });

  test("everything approved: invites starting a new one", () => {
    const projects: Project[] = [{ name: "Done", status: "approved" }];
    expect(nextStep(projects).h).toBe("Start your next project");
  });
});

describe("levelBarCells", () => {
  const bands = [
    { throughLevel: 10, rePerLevel: 10 },
    { throughLevel: 50, rePerLevel: 35 },
  ];

  test("half filled halfway through the current band", () => {
    const cells = levelBarCells(bands, 45, 5, 50);
    expect(cells.filter(Boolean).length).toBe(10);
  });

  test("fully filled right at the level-up threshold", () => {
    expect(levelBarCells(bands, 50, 5, 50).every(Boolean)).toBe(true);
  });

  test("empty right after leveling up", () => {
    expect(levelBarCells(bands, 40, 5, 50).some(Boolean)).toBe(false);
  });
});

describe("linkedSeconds / shippedSeconds", () => {
  const stats = {
    connected: true,
    projects: [
      { name: "repo-a", seconds: 3600, secondsSinceCutoff: 1800 },
      { name: "repo-b", seconds: 7200 },
    ],
  };

  test("prefers secondsSinceCutoff when present", () => {
    const p: Project = { name: "P", status: "shipped", hackatime_projects: ["repo-a"] };
    expect(linkedSeconds(p, stats)).toBe(1800);
  });

  test("falls back to seconds with no cutoff figure", () => {
    const p: Project = { name: "P", status: "shipped", hackatime_projects: ["repo-b"] };
    expect(linkedSeconds(p, stats)).toBe(7200);
  });

  test("shippedSeconds excludes drafts", () => {
    const projects: Project[] = [
      { name: "Draft", status: "draft", hackatime_projects: ["repo-a"] },
      { name: "Shipped", status: "shipped", hackatime_projects: ["repo-b"] },
    ];
    expect(shippedSeconds(projects, stats)).toBe(7200);
  });

  test("disconnected stats: everything is zero", () => {
    const p: Project = { name: "P", status: "shipped", hackatime_projects: ["repo-a"] };
    expect(linkedSeconds(p, { connected: false, projects: [] })).toBe(0);
  });
});

describe("barTrial", () => {
  const trials: Trial[] = [
    { id: 1, name: "First", unlocked: true, completed: false },
    { id: 2, name: "Second", unlocked: true, completed: false },
  ];

  test("prefers the trial with a linked project", () => {
    const projects: Project[] = [{ name: "P", status: "draft", sidequest_id: 2 }];
    expect(barTrial(trials, projects)?.name).toBe("Second");
  });

  test("falls back to the first trial with no linked project", () => {
    expect(barTrial(trials, [])?.name).toBe("First");
  });

  test("null with no trials at all", () => {
    expect(barTrial([], [])).toBeNull();
  });
});
