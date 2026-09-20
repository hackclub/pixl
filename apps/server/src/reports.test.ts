import { afterEach, describe, expect, test } from "bun:test";
import { postReportToSlack } from "./reports.js";

// F-7: a report's targetName (the reported player's own display name) and
// reason (the reporter's free text) are both player-controlled and land in
// a staff-facing Slack message. Before the fix, they were interpolated raw -
// a reporter typing "<!channel>" as their reason mass-pinged the whole
// report-viewers channel on every single report they filed, regardless of
// severity.
const originalFetch = globalThis.fetch;
const originalToken = process.env.SLACK_BOT_TOKEN;
const originalChannel = process.env.REPORT_SLACK_CHANNEL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.SLACK_BOT_TOKEN;
  else process.env.SLACK_BOT_TOKEN = originalToken;
  if (originalChannel === undefined) delete process.env.REPORT_SLACK_CHANNEL;
  else process.env.REPORT_SLACK_CHANNEL = originalChannel;
});

function captureSentText(): { text: () => string | undefined } {
  let sentText: string | undefined;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
    sentText = body.text;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  return { text: () => sentText };
}

describe("postReportToSlack (F-7 Slack mrkdwn injection)", () => {
  test("a reason containing <!channel> is not sent as a live channel-wide ping", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.REPORT_SLACK_CHANNEL = "C123";
    const capture = captureSentText();

    await postReportToSlack(1, "SomePlayer", "<!channel> please look now", null);

    const text = capture.text();
    expect(text).toBeDefined();
    expect(text).not.toContain("<!channel>");
    expect(text).toContain("&lt;!channel&gt;");
  });

  test("a reported player's display name containing <!here> is escaped", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.REPORT_SLACK_CHANNEL = "C123";
    const capture = captureSentText();

    await postReportToSlack(2, "<!here> troll", "spamming chat", null);

    const text = capture.text();
    expect(text).not.toContain("<!here> troll");
    expect(text).toContain("&lt;!here&gt; troll");
  });

  test("a forged link in the reason can't render as a clickable link under the bot", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.REPORT_SLACK_CHANNEL = "C123";
    const capture = captureSentText();

    await postReportToSlack(3, "SomePlayer", "<https://evil.example|Click here>", null);

    const text = capture.text();
    expect(text).not.toContain("<https://evil.example|Click here>");
  });

  test("a normal reason and name pass through readable, not literally html-escaped-looking", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.REPORT_SLACK_CHANNEL = "C123";
    const capture = captureSentText();

    await postReportToSlack(4, "Ada", "being mean in chat", null);

    const text = capture.text();
    expect(text).toContain("Ada");
    expect(text).toContain("being mean in chat");
  });
});
