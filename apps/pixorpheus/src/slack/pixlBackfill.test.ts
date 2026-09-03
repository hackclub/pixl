import { expect, test } from "bun:test";
import { backfillPixlChannelMembers } from "./pixlBackfill.js";

test("reports missing members without inviting them during a dry run", async () => {
  const invitations: { channel: string; users: string; force?: boolean }[] = [];
  const result = await backfillPixlChannelMembers(
    ["U0123456789", "UABCDEFGHIJ", "not-a-slack-id", null],
    {
      conversations: {
        invite: async (args) => {
          invitations.push(args);
          return { ok: true };
        },
        members: async () => ({ members: ["U0123456789"] }),
      },
    },
    { apply: false },
  );

  expect(result).toEqual({
    alreadyMember: 1,
    eligible: 2,
    failed: 0,
    invited: 0,
    missing: 1,
    skipped: 2,
  });
  expect(invitations).toEqual([]);
});

test("invites only the missing Slack users in a forced batch", async () => {
  const invitations: { channel: string; users: string; force?: boolean }[] = [];
  const result = await backfillPixlChannelMembers(
    ["U0123456789", "UABCDEFGHIJ", "U9876543210"],
    {
      conversations: {
        invite: async (args) => {
          invitations.push(args);
          return { ok: true };
        },
        members: async () => ({ members: ["U0123456789"] }),
      },
    },
    { apply: true },
  );

  expect(result).toEqual({
    alreadyMember: 1,
    eligible: 3,
    failed: 0,
    invited: 2,
    missing: 2,
    skipped: 0,
  });
  expect(invitations).toEqual([
    { channel: "C0B5P4N0WHH", force: true, users: "UABCDEFGHIJ,U9876543210" },
  ]);
});

test("collects every page of existing #pixl members before deciding whom to invite", async () => {
  const cursors: (string | undefined)[] = [];
  const result = await backfillPixlChannelMembers(
    ["U0123456789", "UABCDEFGHIJ"],
    {
      conversations: {
        invite: async () => ({ ok: true }),
        members: async (args) => {
          cursors.push(args.cursor);
          return args.cursor
            ? { members: ["UABCDEFGHIJ"] }
            : { members: ["U0123456789"], response_metadata: { next_cursor: "page-2" } };
        },
      },
    },
    { apply: false },
  );

  expect(cursors).toEqual([undefined, "page-2"]);
  expect(result.missing).toBe(0);
});
