import { cookies } from "next/headers";
import { LIVE_MODE_COOKIE, LIVE_SHOW_REVIEWERS_COOKIE, isLiveModeValue } from "@/lib/liveMode";

export async function getLiveMode(): Promise<boolean> {
  return isLiveModeValue((await cookies()).get(LIVE_MODE_COOKIE)?.value);
}

/** True while live mode is on and the "Show reviewer names" button hasn't
 * been pressed - other reviewers' names render as "Reviewer" (see
 * reviewerName in lib/liveMode.ts). */
export async function getHideReviewers(): Promise<boolean> {
  const jar = await cookies();
  return (
    isLiveModeValue(jar.get(LIVE_MODE_COOKIE)?.value) &&
    jar.get(LIVE_SHOW_REVIEWERS_COOKIE)?.value !== "1"
  );
}
