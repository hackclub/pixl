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
