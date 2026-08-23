import { describe, expect, test } from "bun:test";
import { buildAirtableFields, githubUsernameFromRepoUrl } from "./airtable";

const baseInput = {
  repoUrl: "https://github.com/octocat/spoon-knife",
  demoUrl: "https://octocat.github.io/spoon-knife",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  imageUrl: "https://cdn.example.com/shot.png",
  description: "A pixel garden that grows with your commits.",
  approvedHours: 12.5,
  systemNote: "",
  birthday: "2009-04-12",
  addressLine1: "1 Analytical Engine Way",
  addressLine2: "",
  city: "London",
  state: "",
  country: "United Kingdom",
  zip: "SW1A 1AA",
  auditSections: {
    "TECHNICAL FEATURES": "Custom WebSocket sync, no framework.",
    "HACKATIME EVIDENCE": "spoon-knife-game 8/1/2026-8/10/2026",
    "DEFLATION REASON": "",
    "AGE JUSTIFICATION": "",
    NOTES: "Clean ship, approved as claimed.",
  },
};

describe("githubUsernameFromRepoUrl", () => {
  test("extracts the username from a github.com repo URL", () => {
    expect(githubUsernameFromRepoUrl("https://github.com/octocat/spoon-knife")).toBe("octocat");
  });

  test("returns empty string for a non-github URL", () => {
    expect(githubUsernameFromRepoUrl("https://octocat.itch.io/spoon-knife")).toBe("");
  });

  test("returns empty string for a malformed URL", () => {
    expect(githubUsernameFromRepoUrl("not a url")).toBe("");
  });
});

describe("buildAirtableFields", () => {
  test("never includes the Unified-submission automation field", () => {
    const fields = buildAirtableFields(baseInput);
    expect(Object.keys(fields)).not.toContain("Automation - Submit to Unified YSWS");
    expect(Object.keys(fields).some((k) => k.startsWith("Automation -"))).toBe(false);
  });

  test("maps the core project + person fields", () => {
    const fields = buildAirtableFields(baseInput);
    expect(fields["Code URL"]).toBe(baseInput.repoUrl);
    expect(fields["Playable URL"]).toBe(baseInput.demoUrl);
    expect(fields["First Name"]).toBe("Ada");
    expect(fields["Last Name"]).toBe("Lovelace");
    expect(fields["Email"]).toBe("ada@example.com");
    expect(fields["Description"]).toBe(baseInput.description);
    expect(fields["GitHub Username"]).toBe("octocat");
    expect(fields["Optional - Override Hours Spent"]).toBe(12.5);
  });

  test("wraps the screenshot as an Airtable attachment reference", () => {
    const fields = buildAirtableFields(baseInput);
    expect(fields["Screenshot"]).toEqual([{ url: baseInput.imageUrl }]);
  });

  test("omits the Screenshot field entirely when there is no image", () => {
    const fields = buildAirtableFields({ ...baseInput, imageUrl: "" });
    expect(fields).not.toHaveProperty("Screenshot");
  });

  test("maps address + birthday straight through (caller is responsible for decrypting first)", () => {
    const fields = buildAirtableFields(baseInput);
    expect(fields["Address (Line 1)"]).toBe("1 Analytical Engine Way");
    expect(fields["City"]).toBe("London");
    expect(fields["Country"]).toBe("United Kingdom");
    expect(fields["Birthday"]).toBe("2009-04-12");
  });

  test("splits the audit note sections into their matching Airtable fields", () => {
    const fields = buildAirtableFields(baseInput);
    expect(fields["Justification - Specific Technical Features"]).toBe(
      "Custom WebSocket sync, no framework.",
    );
    expect(fields["Justification - Additional Justification"]).toBe(
      "Clean ship, approved as claimed.",
    );
    expect(fields["Optional - Override Hours Spent Justification"]).toBe(
      "spoon-knife-game 8/1/2026-8/10/2026",
    );
  });

  test("leaves Deflation/Age Justification blank when the audit note has no such section", () => {
    const fields = buildAirtableFields(baseInput);
    expect(fields["Justification - Deflation Justification"]).toBe("");
    expect(fields["Optional - Override Age Justification"]).toBe("");
  });

  test("carries the duplicate-check system note through when present", () => {
    const fields = buildAirtableFields({
      ...baseInput,
      systemNote: "Matches an existing ship in the cross-YSWS archive.",
    });
    expect(fields["Optional - Override Duplicate Justification"]).toBe(
      "Matches an existing ship in the cross-YSWS archive.",
    );
  });

  test("fields with no Pixl source stay unset rather than empty strings", () => {
    const fields = buildAirtableFields(baseInput);
    expect(fields).not.toHaveProperty("How did you hear about this?");
    expect(fields).not.toHaveProperty("What are we doing well?");
    expect(fields).not.toHaveProperty("How can we improve?");
    expect(fields).not.toHaveProperty("Justification - Hackatime Project Name(s) + Date Range(s)");
    expect(fields).not.toHaveProperty("Justification - Submitter Hackatime ID");
    expect(fields).not.toHaveProperty("Justification - Lapse Links, comma-separated");
    expect(fields).not.toHaveProperty("Justification - Alternate Tracking Method");
  });
});
