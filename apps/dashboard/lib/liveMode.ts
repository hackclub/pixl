// Global "live mode": lets anyone on the team screen-share or stream the
// dashboard without leaking players' real identities (real names, emails,
// addresses, shipping details). The flag is a per-viewer cookie (no DB), set
// by the setLiveMode action in app/actions.ts and read on the server so the
// real values never reach the browser. Sections that are nothing but PII
// (fulfillment, Slack lookup, the CSV export) are blocked outright.

export const LIVE_MODE_COOKIE = "pixl_live_mode";

export function isLiveModeValue(v: string | undefined | null): boolean {
  return v === "1";
}

export const LIVE_HIDDEN = "Hidden (live mode)";

/** Stand-in for a person's name: the owner is "Builder", collaborators are
 * numbered by their position in the accepted-collaborator list. An id that's
 * in neither never falls back to a real name. */
export function liveAlias(userId: string, ownerId: string, collaboratorIds: string[]): string {
  if (userId === ownerId) return "Builder";
  const i = collaboratorIds.indexOf(userId);
  return i >= 0 ? `Contributor ${i + 1}` : "Contributor";
}

export type BuilderDetails = {
  fullName: string;
  email: string;
  ageLabel: string;
  country: string;
  address: string;
};

export function redactBuilderDetails(live: boolean, d: BuilderDetails): BuilderDetails {
  if (!live) return d;
  return {
    fullName: LIVE_HIDDEN,
    email: LIVE_HIDDEN,
    ageLabel: LIVE_HIDDEN,
    country: LIVE_HIDDEN,
    address: LIVE_HIDDEN,
  };
}

/** Name to show for a player. Live mode never uses real_name (or anything
 * derived from it, like a Slack handle): only the in-game name. */
export function liveName(
  live: boolean,
  user: { display_name?: string | null } | null | undefined,
  realName: string | null | undefined,
): string {
  if (!live) return realName ?? "";
  return user?.display_name || "Player";
}
