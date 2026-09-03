import { expect, test } from "bun:test";
import { ensurePixlChannelMembership } from "./pixlMembership.js";

test("joins a Slack user to #pixl when they are not a member", async () => {
  const calls: { channel: string; users: string }[] = [];
  const result = await ensurePixlChannelMembership("U0123456789", {
    conversations: {
      invite: async (args) => {
        calls.push(args);
        return { ok: true };
      },
    },
  });

  expect(result).toEqual({ kind: "joined" });
  expect(calls).toEqual([{ channel: "C0B5P4N0WHH", users: "U0123456789" }]);
});

test("accepts Slack's already-in-channel result", async () => {
  const result = await ensurePixlChannelMembership("U0123456789", {
    conversations: {
      invite: async () => ({ ok: false, error: "already_in_channel" }),
    },
  });

  expect(result).toEqual({ kind: "already_member" });
});

test("reports a Slack invite failure without treating it as enrolled", async () => {
  const result = await ensurePixlChannelMembership("U0123456789", {
    conversations: {
      invite: async () => ({ ok: false, error: "missing_scope" }),
    },
  });

  expect(result).toEqual({ kind: "failed", errorCode: "missing_scope" });
});
