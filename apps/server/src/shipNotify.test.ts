import { afterEach, describe, expect, test } from "bun:test";
import { postShipToSlack } from "./shipNotify.js";

// F-7: project.name/description are typed by the shipping player, not
// staff, and land in the ship-alerts staff channel's mrkdwn blocks. Before
// the fix, naming a project "<!channel> free robux" mass-pinged that
// channel every time it was shipped or re-shipped.
const originalFetch = globalThis.fetch;
const originalToken = process.env.SLACK_BOT_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.SLACK_BOT_TOKEN;
  else process.env.SLACK_BOT_TOKEN = originalToken;
});

function captureSentBody(): { body: () => { text?: string; blocks?: unknown[] } | undefined } {
  let sent: { text?: string; blocks?: unknown[] } | undefined;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  return { body: () => sent };
}

describe("postShipToSlack (F-7 Slack mrkdwn injection)", () => {
  test("a project name containing <!channel> is not sent as a live channel-wide ping", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const capture = captureSentBody();

    await postShipToSlack(
      { id: 1, name: "<!channel> check this out", description: "cool game", image_url: null, repo_url: null, demo_url: null },
      "U123",
      3600,
      false,
    );

    const body = capture.body();
    expect(body?.text).not.toContain("<!channel>");
    expect(JSON.stringify(body?.blocks)).not.toContain("<!channel>");
  });

  test("a project description containing <!here> is escaped in the blocks", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const capture = captureSentBody();

    await postShipToSlack(
      { id: 2, name: "My Game", description: "<!here> vote for me", image_url: null, repo_url: null, demo_url: null },
      "U123",
      3600,
      false,
    );

    const blocksJson = JSON.stringify(capture.body()?.blocks);
    expect(blocksJson).not.toContain("<!here>");
    expect(blocksJson).toContain("&lt;!here&gt;");
  });

  test("a normal project name/description pass through readable", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const capture = captureSentBody();

    await postShipToSlack(
      { id: 3, name: "Pixel Painter", description: "a drawing app", image_url: null, repo_url: null, demo_url: null },
      "U123",
      3600,
      false,
    );

    const blocksJson = JSON.stringify(capture.body()?.blocks);
    expect(blocksJson).toContain("Pixel Painter");
    expect(blocksJson).toContain("a drawing app");
  });
});
