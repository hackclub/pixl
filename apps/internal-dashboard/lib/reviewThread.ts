// Pure helpers for the #pixl-checkpoint verdict posts, safe to import from
// client components (no db or server imports).

export const REVIEW_CHANNEL_ID = "C0C78RZMX1T";
export const SLACK_TS_RE = /^\d{10}\.\d{6}$/;
const WORKSPACE_URL = "https://hackclub.slack.com";

/** Link to the #pixl-checkpoint thread of a verdict post, or null when the ts is missing or malformed. */
export function reviewThreadUrl(ts: string | null | undefined): string | null {
  if (!ts || !SLACK_TS_RE.test(ts)) return null;
  return `${WORKSPACE_URL}/archives/${REVIEW_CHANNEL_ID}/p${ts.replace(".", "")}`;
}
