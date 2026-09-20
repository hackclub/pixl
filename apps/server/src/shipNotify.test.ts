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

describe("postShipToSlack (Slack link injection through URL fields)", () => {
  const attack = "https://example.test/path><!channel><https://evil.test|Open review";
  const project = (over: Record<string, string | null>) => ({
    id: 9,
    name: "Game",
    description: "d",
    image_url: null,
    repo_url: null,
    demo_url: null,
    ...over,
  });

  test("a demo URL cannot break out of the link or forge a second one", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const capture = captureSentBody();
    await postShipToSlack(project({ demo_url: attack }), "U123", 3600, false);
    const json = JSON.stringify(capture.body()?.blocks);
    expect(json).not.toContain("<!channel>");
    expect(json).not.toContain("<https://evil.test");
    const fields = (capture.body()?.blocks as { fields?: { text: string }[] }[]).find((b) => b.fields)!.fields!;
    const demo = fields.find((f) => f.text.startsWith("*Demo URL:*"))!.text;
    expect(demo.match(/</g)).toHaveLength(1);
    expect(demo.match(/>/g)).toHaveLength(1);
    expect(demo.match(/\|/g)).toHaveLength(1);
  });

  test("a repo URL cannot break out of the link either", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const capture = captureSentBody();
    await postShipToSlack(project({ repo_url: attack }), "U123", 3600, false);
    const json = JSON.stringify(capture.body()?.blocks);
    expect(json).not.toContain("<!channel>");
    expect(json).not.toContain("<https://evil.test");
  });

  test("the button URL is normalized and cannot carry Slack syntax", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const capture = captureSentBody();
    await postShipToSlack(project({ demo_url: attack }), "U123", 3600, false);
    const actions = (capture.body()?.blocks as { elements?: { url?: string }[] }[]).find((b) => b.elements)!.elements!;
    for (const el of actions) expect(el.url).not.toMatch(/[<>]/);
  });

  test("a non-http URL is not linked", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const capture = captureSentBody();
    await postShipToSlack(project({ repo_url: "javascript:alert(1)", demo_url: "not a url" }), "U123", 3600, false);
    const json = JSON.stringify(capture.body()?.blocks);
    expect(json).not.toContain("javascript:");
    expect(json).toContain("Invalid link");
  });

  test("legitimate URLs still render as links", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const capture = captureSentBody();
    await postShipToSlack(
      project({ repo_url: "https://github.com/a/b?tab=readme&x=1", demo_url: "https://demo.example.test/play" }),
      "U123",
      3600,
      false,
    );
    const json = JSON.stringify(capture.body()?.blocks);
    expect(json).toContain("<https://github.com/a/b?tab=readme&amp;x=1|Open repo>");
    expect(json).toContain("<https://demo.example.test/play|Open demo>");
  });

  test("an owner id that is not a Slack id is not turned into a mention", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const capture = captureSentBody();
    await postShipToSlack(project({}), "U1|<!channel>", 3600, false);
    expect(JSON.stringify(capture.body()?.blocks)).not.toContain("<!channel>");
  });
});

describe("postShipToSlack description truncation", () => {
  const brokenEntity = /&(?!amp;|lt;|gt;)/;

  async function sentDescription(description: string): Promise<string> {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const capture = captureSentBody();
    await postShipToSlack(
      { id: 20, name: "Game", description, image_url: null, repo_url: null, demo_url: null },
      "U123",
      3600,
      false,
    );
    const blocks = capture.body()?.blocks as { text?: { text: string } }[];
    const section = blocks.map((b) => b.text?.text ?? "").find((t) => t.startsWith("*Game*\n"))!;
    return section.slice("*Game*\n".length);
  }

  test("plain text is cut to the same 2500 characters as before", async () => {
    expect(await sentDescription("a".repeat(5000))).toBe("a".repeat(2500));
  });

  test("an ampersand at the cut is dropped whole, never left as a partial entity", async () => {
    const text = await sentDescription(`${"a".repeat(2497)}&tail`);
    expect(text).not.toMatch(brokenEntity);
    expect(text).toBe("a".repeat(2497));
  });

  test("a < at the cut is dropped whole", async () => {
    const text = await sentDescription(`${"a".repeat(2498)}<!channel>`);
    expect(text).not.toMatch(brokenEntity);
    expect(text).toBe("a".repeat(2498));
  });

  test("a > at the cut is dropped whole", async () => {
    const text = await sentDescription(`${"a".repeat(2498)}>tail`);
    expect(text).not.toMatch(brokenEntity);
    expect(text).toBe("a".repeat(2498));
  });

  test("a description that escapes to exactly the limit is kept whole", async () => {
    expect(await sentDescription("&".repeat(500))).toBe("&amp;".repeat(500));
    expect(await sentDescription("&".repeat(501))).toBe("&amp;".repeat(500));
  });
});
