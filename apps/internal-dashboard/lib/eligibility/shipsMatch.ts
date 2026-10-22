import type { ShipsEvidence } from "./engine";
import type { ShipsEntry, ShipsView } from "./ships";

export type UnifiedMapping =
  | { kind: "none" }
  | { kind: "mapped"; stagingId: string; unifiedId: string }
  | { kind: "empty"; stagingId: string }
  | { kind: "missing"; stagingId: string }
  | { kind: "duplicate"; stagingId: string; unifiedId: string }
  | { kind: "unavailable"; stagingId: string };

export interface MatchTarget {
  mapping: UnifiedMapping;
  repoKey: string | null;
  playerSlackId: string | null;
}

const DAY_S = 86400;

function sameSlack(entry: ShipsEntry, slack: string | null): boolean | null {
  if (!entry.slackId || !slack) return null;
  return entry.slackId.toUpperCase() === slack.toUpperCase();
}

function approvalOf(entry: ShipsEntry, nowMs: number): { ok: boolean; why: string } {
  if (entry.approvedAt == null) return { ok: false, why: "Found in Ships without an approval timestamp." };
  if (entry.approvedAt * 1000 > nowMs + DAY_S * 1000) return { ok: false, why: "Found in Ships with an approval date in the future." };
  return { ok: true, why: "" };
}

function siblingsOf(entry: ShipsEntry, view: ShipsView): { count: number; hours: number } {
  const others = (entry.repoKey ? (view.snapshot?.byRepo.get(entry.repoKey) ?? []) : []).filter((e) => e.id !== entry.id);
  return { count: others.length, hours: others.reduce((s, e) => s + e.hours, 0) };
}

function evidenceOf(entry: ShipsEntry, matchedBy: "record_id" | "repo_slack", nowMs: number, view: ShipsView, extra = ""): ShipsEvidence {
  const a = approvalOf(entry, nowMs);
  if (!a.ok) {
    return {
      state: "approval_unconfirmed",
      recordId: entry.id,
      matchedBy,
      hours: entry.hours,
      approvedAt: entry.approvedAt,
      githubUsername: entry.githubUsername,
      siblings: siblingsOf(entry, view),
      note: `${a.why} ${entry.hours}h listed.`,
    };
  }
  return {
    state: "approved",
    recordId: entry.id,
    matchedBy,
    hours: entry.hours,
    approvedAt: entry.approvedAt,
    githubUsername: entry.githubUsername,
    siblings: siblingsOf(entry, view),
    note: `Found in Ships · ${entry.hours}h approved${extra}`,
  };
}

const blank = (state: ShipsEvidence["state"], note: string, recordId: string | null = null): ShipsEvidence => ({
  state,
  recordId,
  matchedBy: null,
  hours: null,
  approvedAt: null,
  note,
});

export function matchShips(view: ShipsView, target: MatchTarget, nowMs: number = Date.now()): ShipsEvidence {
  const snap = view.snapshot;
  if (!snap) return blank("unavailable", "Ships has not been reached yet.");

  const m = target.mapping;
  if (m.kind === "unavailable") {
    return blank("unavailable", "The Airtable record could not be read, so its Unified record id is unknown.", m.stagingId);
  }
  if (m.kind === "duplicate") {
    return blank("ambiguous", "More than one PIXL project maps to this Unified record.", m.unifiedId);
  }
  if (m.kind === "missing") {
    return blank("no_record", "The Airtable staging record no longer exists, so it cannot be matched to Ships.", m.stagingId);
  }
  if (m.kind === "empty") {
    return blank("no_record", "The Airtable record has no Unified record id yet, so it cannot be matched to Ships.", m.stagingId);
  }
  if (m.kind === "mapped") {
    const id = m.unifiedId;
    if (snap.ambiguousIds.has(id)) return blank("ambiguous", "Ships lists this Unified record more than once.", id);
    if (snap.invalidIds.has(id)) return blank("ambiguous", "Ships has a malformed entry for this Unified record.", id);
    const entry = snap.byId.get(id);
    if (!entry) return blank("not_found", "The Unified record is not present in the current Ships dataset.", id);
    if (!target.repoKey || !entry.repoKey || entry.repoKey !== target.repoKey) {
      return blank("identity_mismatch", "The Ships entry for this Unified record points at a different repository.", id);
    }
    if (sameSlack(entry, target.playerSlackId) === false) {
      return blank("identity_mismatch", "The Ships entry for this Unified record belongs to a different Slack user.", id);
    }
    return evidenceOf(entry, "record_id", nowMs, view, " (matched by Unified record id)");
  }

  if (!target.repoKey) return blank("no_record", "No Airtable record id and no repository to match on.");
  const candidates = snap.byRepo.get(target.repoKey) ?? [];
  if (candidates.length === 0) return blank("no_record", "No Airtable record id stored and no Ships entry for this repository.");
  const mine = candidates.filter((c) => sameSlack(c, target.playerSlackId) === true);
  if (mine.length === 1) return evidenceOf(mine[0]!, "repo_slack", nowMs, view, " (matched by repository and Slack id)");
  return blank(
    "ambiguous",
    mine.length > 1
      ? "Several Ships entries share this repository and Slack id."
      : "A Ships entry exists for this repository but the participant cannot be verified (no Airtable record id, no Slack id).",
  );
}
