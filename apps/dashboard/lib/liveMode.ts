// "Live mode" for the review pages: lets a reviewer screen-share or stream a
// review without leaking builder identity. The flag is a per-reviewer cookie
// (no DB), set by the setLiveMode action in app/actions.ts.

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
