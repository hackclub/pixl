import { describe, expect, test } from "bun:test";
import { escapeMrkdwn, safeHttpUrl, slackLinkUrl } from "./slackEscape.js";

// F-7: staff-facing Slack messages (reports, ship alerts, ticket cards)
// interpolate player-controlled text (report reasons, project names/
// descriptions, ticket titles) directly into mrkdwn strings. Slack's mrkdwn
// parser treats &, <, > as syntax - unescaped, a player can mass-ping a
// staff channel (<!channel>, <!here>), spoof a mention, or render a
// misleading clickable link under the bot's own identity.
describe("escapeMrkdwn (F-7 Slack mrkdwn injection)", () => {
  test("escapes a channel-wide ping attempt", () => {
    expect(escapeMrkdwn("<!channel> read this")).toBe("&lt;!channel&gt; read this");
  });

  test("escapes an @here ping attempt", () => {
    expect(escapeMrkdwn("<!here> urgent")).toBe("&lt;!here&gt; urgent");
  });

  test("escapes a forged/misleading link", () => {
    expect(escapeMrkdwn("<https://evil.example|Open in dashboard>")).toBe(
      "&lt;https://evil.example|Open in dashboard&gt;",
    );
  });

  test("escapes a spoofed user mention", () => {
    expect(escapeMrkdwn("<@U12345|admin>")).toBe("&lt;@U12345|admin&gt;");
  });

  test("escapes a bare ampersand (must go first, or it would double-escape the entities above)", () => {
    expect(escapeMrkdwn("fish & chips")).toBe("fish &amp; chips");
  });

  test("ordinary text with no mrkdwn syntax passes through unchanged", () => {
    expect(escapeMrkdwn("my cool project")).toBe("my cool project");
  });
});

describe("slackLinkUrl", () => {
  test("keeps a normal URL and escapes only the ampersand", () => {
    expect(slackLinkUrl("https://github.com/a/b?x=1&y=2")).toBe("https://github.com/a/b?x=1&amp;y=2");
  });

  test("never emits link delimiters", () => {
    for (const raw of [
      "https://e.test/a><!channel>",
      "https://e.test/a|b",
      "https://e.test/?q=<x>#<y>",
      "https://us<er@e.test/",
    ]) {
      expect(slackLinkUrl(raw)).not.toMatch(/[<>|]/);
    }
  });

  test("rejects non-http(s) and unparseable values", () => {
    expect(slackLinkUrl("javascript:alert(1)")).toBeNull();
    expect(slackLinkUrl("data:text/html,x")).toBeNull();
    expect(slackLinkUrl("not a url")).toBeNull();
    expect(slackLinkUrl("")).toBeNull();
    expect(slackLinkUrl(null)).toBeNull();
  });
});

describe("safeHttpUrl", () => {
  test("normalizes valid http(s) URLs and rejects others", () => {
    expect(safeHttpUrl("https://e.test/a b")).toBe("https://e.test/a%20b");
    expect(safeHttpUrl("ftp://e.test/")).toBeNull();
  });
});
