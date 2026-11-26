/** Display name for a staff label, either an actorName()-style
 * "Name (SlackID)" or a bare Slack id: the "(SlackID)" suffix is dropped. */
export function staffName(label: string | null | undefined, fallback = "Reviewer"): string {
  if (!label) return fallback;
  return label.replace(/\s*\([^)]*\)\s*$/, "") || fallback;
}
