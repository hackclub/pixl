import { describe, expect, test } from "bun:test";
import { linkedEvidenceNames } from "./hackatimeEvidence";

describe("linkedEvidenceNames", () => {
  test("only requests spans and lapses for linked projects", () => {
    const projects = [
      { name: "unrelated-large", seconds: 999999 },
      { name: "linked-a", seconds: 0 },
      { name: "unrelated-small", seconds: 30 },
      { name: "linked-b", seconds: 200 },
      { name: "linked-a", seconds: 10 },
    ];
    expect(linkedEvidenceNames(projects, new Set(["linked-a", "linked-b"])))
      .toEqual(["linked-a", "linked-b"]);
  });

  test("returns no detail requests for accounts without linked projects", () => {
    expect(linkedEvidenceNames([{ name: "another" }], new Set())).toEqual([]);
  });
});
