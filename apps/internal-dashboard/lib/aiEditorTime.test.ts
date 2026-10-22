import { describe, expect, test } from "bun:test";
import { classifyAiEditorTime, type HackatimeBreakdown } from "./aiEditorTime";

function editor(name: string, seconds: number): HackatimeBreakdown {
  return { name, seconds, text: `${seconds}s`, percent: 0 };
}

describe("classifyAiEditorTime", () => {
  test("splits AI-tool editors from the rest by name match", () => {
    const result = classifyAiEditorTime([
      editor("Cursor", 600),
      editor("VS Code", 1200),
      editor("Neovim", 300),
    ]);
    expect(result.totalSeconds).toBe(2100);
    expect(result.aiSeconds).toBe(600);
    expect(result.aiEditors.map((e) => e.name)).toEqual(["Cursor"]);
  });

  test("matches case-insensitively and as a substring", () => {
    const result = classifyAiEditorTime([
      editor("windsurf", 100),
      editor("GitHub Copilot Chat", 200),
      editor("Claude Code", 300),
    ]);
    expect(result.aiSeconds).toBe(600);
    expect(result.aiEditors).toHaveLength(3);
  });

  test("returns zero split when there are no editors", () => {
    const result = classifyAiEditorTime([]);
    expect(result).toEqual({ totalSeconds: 0, aiSeconds: 0, aiEditors: [] });
  });

  test("ignores editors that aren't AI tools", () => {
    const result = classifyAiEditorTime([editor("IntelliJ IDEA", 500), editor("Vim", 100)]);
    expect(result.aiSeconds).toBe(0);
    expect(result.aiEditors).toEqual([]);
    expect(result.totalSeconds).toBe(600);
  });
});
