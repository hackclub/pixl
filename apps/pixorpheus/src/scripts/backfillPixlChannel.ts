import { db } from "../db/client.js";
import { app } from "../slack/app.js";
import {
  backfillPixlChannelMembers,
  type PixlBackfillClient,
  type PixlBackfillSummary,
} from "../slack/pixlBackfill.js";

const PAGE_SIZE = 1_000;

interface SlackUserRow {
  readonly slack_id: string | null;
}

class PlayerQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlayerQueryError";
  }
}

const client: PixlBackfillClient = {
  conversations: {
    invite: (args) => app.client.conversations.invite(args),
    members: (args) => app.client.conversations.members(args),
  },
};

async function playerSlackIds(): Promise<(string | null)[]> {
  const ids: (string | null)[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await db()
      .from<SlackUserRow>("users")
      .select("slack_id")
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new PlayerQueryError(error.message);
    const rows = data ?? [];
    for (const row of rows) ids.push(row.slack_id);
    if (rows.length < PAGE_SIZE) return ids;
  }
}

function printSummary(summary: PixlBackfillSummary, apply: boolean): void {
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry_run",
      ...summary,
    }),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const summary = await backfillPixlChannelMembers(await playerSlackIds(), client, { apply });
  printSummary(summary, apply);
}

void main().catch((error: unknown) => {
  console.error("[pixl-membership] backfill failed", errorMessage(error));
  process.exitCode = 1;
});
