import type { HackatimeBreakdown } from "@/lib/hackatime";

// Editor names Hackatime reports for AI-native/AI-assisted tools, matched
// case-insensitively as a substring (Hackatime's editor field is whatever
// the maker's Wakatime-compatible plugin reports, so "Claude Code" and
// "claude-code.nvim" both need to land in the same bucket).
const AI_EDITOR_PATTERNS = ["cursor", "windsurf", "copilot", "claude"];

export interface AiEditorTime {
  totalSeconds: number;
  aiSeconds: number;
  aiEditors: HackatimeBreakdown[];
}

// Splits a Hackatime editor breakdown into time spent in AI-assisted editors
// vs everything else, so a reviewer can compare it against the maker's own
// AI declaration and the per-commit AI-authorship heuristic.
export function classifyAiEditorTime(editors: HackatimeBreakdown[]): AiEditorTime {
  const aiEditors = editors.filter((e) =>
    AI_EDITOR_PATTERNS.some((p) => e.name.toLowerCase().includes(p)),
  );
  return {
    totalSeconds: editors.reduce((s, e) => s + e.seconds, 0),
    aiSeconds: aiEditors.reduce((s, e) => s + e.seconds, 0),
    aiEditors,
  };
}
