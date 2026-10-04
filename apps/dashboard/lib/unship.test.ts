import { describe, expect, test } from "bun:test";
import { unshipResetFields } from "./unship";

describe("unshipResetFields", () => {
  const f = unshipResetFields() as Record<string, unknown>;

  test("sends the project back to an editable draft", () => {
    expect(f.status).toBe("draft");
    expect(f.shipped_at).toBeNull();
  });

  test("clears every first-pass field so a stale verdict (e.g. a ban proposal) can't survive a reship", () => {
    expect(f.first_pass_by).toBe("");
    expect(f.first_pass_at).toBeNull();
    expect(f.first_pass_note).toBe("");
    expect(f.first_pass_hours).toBeNull();
    expect(f.first_pass_verdict).toBeNull();
  });

  test("clears second-pass state, the checklist and any spot-check mark", () => {
    expect(f.second_pass_by).toBe("");
    expect(f.second_pass_at).toBeNull();
    expect(f.second_pass_note).toBe("");
    expect(f.second_pass_hours).toBeNull();
    expect(f.second_pass_verdict).toBeNull();
    expect(f.second_pass_telescreen_checked).toBe(false);
    expect(f.second_pass_hours_deflated).toBe(false);
    expect(f.second_pass_heartbeats_added).toBe(false);
    expect(f.spot_checked_at).toBeNull();
    expect(f.spot_checked_by).toBe("");
  });

  test("clears review notes, claims and any shared draft", () => {
    expect(f.review_note).toBe("");
    expect(f.review_note_by).toBe("");
    expect(f.approved_hours).toBeNull();
    expect(f.reviewing_by).toBe("");
    expect(f.reviewing_at).toBeNull();
    expect(f.review_draft).toBeNull();
    expect(f.review_draft_by).toBe("");
    expect(f.review_draft_at).toBeNull();
    expect(f.reverted_at).toBeNull();
  });

  test("never touches the player's own content", () => {
    for (const k of ["name", "description", "repo_url", "demo_url", "image_url", "ship_note", "user_id"])
      expect(k in f).toBe(false);
  });

  test("returns a fresh object each call", () => {
    expect(unshipResetFields()).not.toBe(unshipResetFields());
  });
});
