import { PIXL_REVIEW_CHANNEL } from "../constants.js";
import { sql } from "../db/pgCompat.js";
import { app } from "../slack/app.js";
import {
  backfillPixlChannelMembers,
  type PixlBackfillClient,
} from "../slack/pixlBackfill.js";

const client: PixlBackfillClient = {
  conversations: {
    invite: (args) => app.client.conversations.invite(args),
    members: (args) => app.client.conversations.members(args),
  },
};

// Everyone who has ever sent a project to review (owners) or had one approved
// (owners and accepted collaborators).
async function reviewedPlayerSlackIds(): Promise<(string | null)[]> {
  const rows = await sql<{ slack_id: string | null }[]>`
    select distinct u.slack_id
    from users u
    where u.id in (
      select p.user_id from projects p
      where p.shipped_at is not null or p.first_shipped_at is not null or p.status = 'approved'
      union
      select c.user_id from project_collaborators c
      join projects p on p.id = c.project_id
      where c.status = 'accepted' and p.status = 'approved'
    )
  `;
  return rows.map((row) => row.slack_id);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const summary = await backfillPixlChannelMembers(await reviewedPlayerSlackIds(), client, {
    apply,
    channel: PIXL_REVIEW_CHANNEL,
  });
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry_run", channel: PIXL_REVIEW_CHANNEL, ...summary }));
  process.exit(0);
}

void main().catch((error: unknown) => {
  console.error("[review-channel] backfill failed", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
