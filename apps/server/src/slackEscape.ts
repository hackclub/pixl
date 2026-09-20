// Slack mrkdwn treats &, <, > as syntax (mentions, channel refs, links). Any
// player-controlled string (report reason, project name/description, a
// display name) headed into a staff-facing Slack message's text/mrkdwn field
// must go through this first, or it can mass-ping via <!channel>/<!here>,
// spoof a mention (<@U123|fake>), or render a misleading clickable link
// under the bot's identity. Mirrors apps/pixorpheus/src/slack/escape.ts's
// escapeMrkdwn exactly - kept as a separate copy since apps/server and
// apps/pixorpheus are built/deployed independently and don't share code.
export function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeMrkdwnWithin(text: string, max: number): string {
  let out = "";
  for (const ch of text) {
    const escaped = escapeMrkdwn(ch);
    if (out.length + escaped.length > max) break;
    out += escaped;
  }
  return out;
}

export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

export function slackLinkUrl(raw: string | null | undefined): string | null {
  const href = safeHttpUrl(raw);
  if (!href) return null;
  return href.replace(/&/g, "&amp;").replace(/</g, "%3C").replace(/>/g, "%3E").replace(/\|/g, "%7C");
}
