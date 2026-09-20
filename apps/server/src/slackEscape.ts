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
