// Who can see and answer the NPS survey, and which wave a response belongs to.
// Kept free of Express and the database so it is easy to test.
//
// NPS_MODE:
//   off      nobody (the default, also used for any unknown value)
//   preview  only the Slack IDs in NPS_PREVIEW_SLACK_IDS (comma separated)
//   live     every signed-in player
export type NpsMode = "off" | "preview" | "live";

export function npsMode(raw: string | undefined): NpsMode {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "preview" || v === "live" ? v : "off";
}

export function parseSlackIds(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^[UW][A-Z0-9]{5,}$/.test(s)),
  );
}

export function canUseNps(mode: NpsMode, previewIds: Set<string>, slackId: string | undefined): boolean {
  if (mode === "live") return true;
  if (mode === "preview") return !!slackId && previewIds.has(slackId);
  return false;
}

// One wave per calendar month (UTC), so a player can be asked again later
// without overwriting an earlier answer.
export function npsWave(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

// The areas a player can rate from 1 to 5. Keys are stored in nps_responses.ratings.
export const NPS_AREAS = ["onboarding", "reviews", "shop", "communication"] as const;
export type NpsArea = (typeof NPS_AREAS)[number];

export type NpsBucket = "promoter" | "passive" | "detractor";

export function npsBucket(score: number): NpsBucket {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

// NPS = % promoters - % detractors, rounded, -100..100. Null when there are no answers.
export function npsScore(scores: number[]): number | null {
  if (scores.length === 0) return null;
  const promoters = scores.filter((s) => npsBucket(s) === "promoter").length;
  const detractors = scores.filter((s) => npsBucket(s) === "detractor").length;
  return Math.round(((promoters - detractors) / scores.length) * 100);
}
