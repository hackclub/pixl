import { describe, expect, test } from "bun:test";
import { parseMacondoProject } from "./client.js";

describe("Macondo project parsing", () => {
  test("keeps the project identity, links, owner, and journal history", () => {
    const project = parseMacondoProject({
      id: 42,
      name: "Pocket synth",
      description: "A tiny hardware synth.",
      type: "hardware",
      repository_url: "https://github.com/example/pocket-synth",
      demo_url: "https://example.com/demo",
      thumbnail_url: "https://cdn.example.com/synth.png",
      created_at: "2026-08-01T12:00:00.000Z",
      has_shipped: true,
      owner: { slack_id: "U123" },
      journals: [
        {
          id: 7,
          short_brief: "Designed the board",
          long_brief: "I finished the first PCB layout.",
          hours: 3.5,
          created_at: "2026-08-02T12:00:00.000Z",
          archived: false,
        },
      ],
    });

    expect(project).toEqual({
      id: 42,
      name: "Pocket synth",
      description: "A tiny hardware synth.",
      type: "hardware",
      repoUrl: "https://github.com/example/pocket-synth",
      demoUrl: "https://example.com/demo",
      thumbnailUrl: "https://cdn.example.com/synth.png",
      createdAt: "2026-08-01T12:00:00.000Z",
      ownerSlackId: "U123",
      hasShipped: true,
      journals: [
        {
          id: 7,
          title: "Designed the board",
          content: "I finished the first PCB layout.",
          hours: 3.5,
          createdAt: "2026-08-02T12:00:00.000Z",
          archived: false,
        },
      ],
    });
  });

  test("rejects a project without a usable owner or id", () => {
    expect(parseMacondoProject({ id: "not-a-number", owner: { slack_id: "U123" } })).toBeNull();
    expect(parseMacondoProject({ id: 42, owner: {} })).toBeNull();
  });

  test("preserves long journal content", () => {
    const content = `  ${"x".repeat(6001)}  `;
    const project = parseMacondoProject({
      id: 42,
      name: "Long journal",
      created_at: "2026-08-01T12:00:00.000Z",
      owner: { slack_id: "U123" },
      journals: [
        {
          id: 7,
          long_brief: content,
          created_at: "2026-08-02T12:00:00.000Z",
        },
      ],
    });

    expect(project?.journals[0]?.content).toBe(content);
  });
});
