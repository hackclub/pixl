// Copy for the notice shown after the Hackatime connect flow returns with
// ?hackatime=connected|failed (&hackatime_reason=..., see apps/server
// src/routes/hackatime.ts). Without it a failed connect looks like a reload.
const FAILED: Record<string, string> = {
  account_mismatch:
    "Couldn't connect Hackatime: that Hackatime account is linked to a different Slack account than your Pixl one. Log out of hackatime.hackclub.com, log back in with the same Slack account you use here, then try again.",
  no_slack_id:
    "Couldn't connect Hackatime: your Hackatime account isn't linked to Slack. Link Slack in your Hackatime settings, then try again.",
};
const FAILED_DEFAULT = "Couldn't connect Hackatime. Try again in a bit, and ask in the help channel if it keeps failing.";

export function hackatimeReturnNotice(
  outcome: string | null,
  reason: string | null,
): { text: string; bad: boolean } | null {
  if (outcome === "connected") return { text: "Hackatime connected.", bad: false };
  if (outcome !== "failed") return null;
  return { text: reason && Object.hasOwn(FAILED, reason) ? FAILED[reason] : FAILED_DEFAULT, bad: true };
}
