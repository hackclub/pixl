// Metadata for the first-time reviewer guidelines gate (see requireGuidelinesAck
// in guard.ts). Kept JSX-free so server code (guard.ts, actions.ts) can import
// it cheaply. The actual page content lives in guidelinesContent.tsx (rendered
// inline in the dashboard) and the last page is a recap of the rules that
// matter most for reviewing.
//
// The content is a SNAPSHOT of Hack Club's live guidelines. When Hack Club
// updates them, refresh guidelinesContent.tsx and bump GUIDELINES_VERSION so
// every reviewer is forced to read the changes again.
//
// Source (latest, live): https://hackclub.gitbook.io/ysws-project-submission-guidelines
export const GUIDELINES_VERSION = 1;

export const MIN_SECONDS_PER_PAGE = 10;

export const GUIDELINES_LIVE_URL =
  "https://hackclub.gitbook.io/ysws-project-submission-guidelines";
