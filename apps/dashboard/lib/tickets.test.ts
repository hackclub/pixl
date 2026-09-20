import { describe, expect, test } from "bun:test";
import { ticketBlocks, type FullTicketRow } from "./tickets.js";

// F-7: a ticket's title/description are typed by the player who opened it,
// not staff, and land in this staff-facing card's mrkdwn text when it's
// posted/updated in the ticket channel. This file's ticketBlocks() is meant
// to mirror apps/pixorpheus/src/tickets/blocks.ts's ticketBlocks() exactly -
// that version escapes title/description via escapeMrkdwn, this one had
// drifted and didn't, so a ticket titled "<!channel>" mass-pinged the ticket
// channel every time the dashboard (not Pixorpheus) rendered its card.
function baseTicket(overrides: Partial<FullTicketRow>): FullTicketRow {
  return {
    msg_ts: "123.456",
    description: null,
    title: null,
    status: "open",
    opened_by_slack_id: "U1",
    claimed_by_slack_id: null,
    closed_by_slack_id: null,
    permalink: null,
    ticket_msg_ts: null,
    ticket_number: 1,
    title_prompt_ts: null,
    ...overrides,
  };
}

describe("ticketBlocks (F-7 Slack mrkdwn injection)", () => {
  test("a title containing <!channel> is escaped in the rendered card", () => {
    const blocks = ticketBlocks(baseTicket({ title: "<!channel> please help" }));
    const json = JSON.stringify(blocks);
    expect(json).not.toContain("<!channel>");
    expect(json).toContain("&lt;!channel&gt;");
  });

  test("a description containing <!here> is escaped when no title is set (falls back to description)", () => {
    const blocks = ticketBlocks(baseTicket({ description: "<!here> urgent bug" }));
    const json = JSON.stringify(blocks);
    expect(json).not.toContain("<!here>");
    expect(json).toContain("&lt;!here&gt;");
  });

  test("a forged link in the description can't render as a clickable link under the bot", () => {
    const blocks = ticketBlocks(
      baseTicket({ title: "Bug report", description: "<https://evil.example|click here>" }),
    );
    const json = JSON.stringify(blocks);
    expect(json).not.toContain("<https://evil.example|click here>");
  });

  test("normal title/description pass through readable", () => {
    const blocks = ticketBlocks(baseTicket({ title: "Can't log in", description: "It just spins forever" }));
    const json = JSON.stringify(blocks);
    expect(json).toContain("Can't log in");
    expect(json).toContain("It just spins forever");
  });
});

describe("ticketBlocks description truncation", () => {
  const quoted = (description: string) => {
    const blocks = ticketBlocks(baseTicket({ title: "t", description })) as { text?: { text: string } }[];
    return blocks.map((b) => b.text?.text ?? "").find((t) => t.startsWith(">")) ?? "";
  };
  const brokenEntity = /&(?!amp;|lt;|gt;)/;
  const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  test("plain text is cut to the same 2900 characters as before", () => {
    expect(quoted("a".repeat(5000))).toBe(`>${"a".repeat(2900)}`);
  });

  test("an ampersand at the cut is dropped whole, never left as a partial entity", () => {
    const text = quoted(`${"a".repeat(2897)}&tail`);
    expect(text).not.toMatch(brokenEntity);
    expect(text).toBe(`>${"a".repeat(2897)}`);
  });

  test("a < at the cut is dropped whole", () => {
    const text = quoted(`${"a".repeat(2898)}<!channel>`);
    expect(text).not.toMatch(brokenEntity);
    expect(text).toBe(`>${"a".repeat(2898)}`);
  });

  test("a > at the cut is dropped whole", () => {
    const text = quoted(`${"a".repeat(2898)}>tail`);
    expect(text).not.toMatch(brokenEntity);
    expect(text).toBe(`>${"a".repeat(2898)}`);
  });

  test("a description that escapes to exactly the limit is kept whole", () => {
    expect(quoted("&".repeat(580))).toBe(`>${"&amp;".repeat(580)}`);
    expect(quoted("&".repeat(581))).toBe(`>${"&amp;".repeat(580)}`);
  });

  test("the cut never leaves more than the limit after escaping", () => {
    for (const ch of ["&", "<", ">", "a", "&<>"]) {
      const text = quoted(ch.repeat(4000));
      expect(text.length - 1).toBeLessThanOrEqual(2900);
      expect(text).not.toMatch(brokenEntity);
    }
  });

  test("an emoji at the cut is not split into a lone surrogate", () => {
    const text = quoted(`${"a".repeat(2899)}\u{1F600}`);
    expect(text).not.toMatch(loneSurrogate);
  });
});
