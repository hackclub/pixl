import { unstable_rethrow } from "next/navigation";

// Turns a failed server action call into a sentence a reviewer can act on,
// instead of letting it bubble to app/error.tsx ("Something broke") and wipe
// the form. Rethrows redirect()/notFound() signals first, so an action that
// redirects (to the next project, or back with ?error=) still navigates.
//
// `what` finishes "Couldn't ...", e.g. "submit this verdict".
// A tab left open across a deploy calls an action id the new build doesn't
// have. The server logs "Failed to find Server Action"; the browser throws
// 'Server Action "..." was not found on the server'. Both are matched.
const STALE = /failed to find server action|was not found on the server|older or newer deployment/i;

export function isStaleDeployError(e: unknown): boolean {
  return STALE.test(e instanceof Error ? e.message : String(e ?? ""));
}
const NETWORK = /failed to fetch|networkerror|load failed|network request failed|fetch failed/i;
// Next strips thrown messages from server actions in production builds.
// React's minified form of the same message is "Minified React error #441".
const REDACTED = /omitted in production|server components render|minified react error #441/i;

export function actionErrorMessage(e: unknown, what: string): string {
  unstable_rethrow(e);
  const message = e instanceof Error ? e.message : String(e ?? "");
  const digest =
    e && typeof e === "object" && "digest" in e && typeof e.digest === "string" ? e.digest : null;

  if (STALE.test(message))
    return `Couldn't ${what}: the dashboard was updated since you opened this page. Your notes are kept in this browser, so reload the page and try again.`;
  if (NETWORK.test(message))
    return `Couldn't ${what}: the dashboard didn't answer (connection dropped, or a deploy is in progress). Your notes are still here. Wait a few seconds, reload to check whether it went through, then try again.`;
  if (!message || REDACTED.test(message))
    return `Couldn't ${what}: the server hit an error part way through.${digest ? ` Reference ${digest} is in the server log.` : ""} Your notes are still here. Reload to check whether it went through before trying again, and tell an owner if it keeps happening.`;
  return `Couldn't ${what}: ${message}`;
}
