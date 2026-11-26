import { describe, expect, test } from "bun:test";
import { initialForm, toFields } from "./editor-state";

describe("project game category", () => {
  test("preserves a backfilled game's label when editing without changing platform", () => {
    const form = initialForm({
      id: 1912,
      name: "Block Runner",
      project_type: "hardware",
      kind: "software",
      is_game: true,
    });
    expect(form.isGame).toBe(true);
    const sent = toFields(form);
    expect(sent.isGame).toBe(true);
    expect(String(sent.projectType)).toBe("hardware");
    expect(sent.kind).toBe("software");
  });

  test("new submissions are not automatically labelled games", () => {
    const form = initialForm({ name: "Calculator" });
    expect(form.isGame).toBe(false);
    expect(toFields({ ...form, isGame: true }).isGame).toBe(true);
  });
});
