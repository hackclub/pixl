import { PIXL_MAIN_CHANNEL } from "../constants.js";
import { isSlackUserId } from "./pixlMembership.js";

const INVITE_BATCH_SIZE = 100;
const INVITE_BATCH_DELAY_MS = 1_250;

export interface PixlBackfillClient {
  readonly conversations: {
    readonly invite: (args: {
      readonly channel: string;
      readonly force: boolean;
      readonly users: string;
    }) => Promise<{ readonly ok?: boolean }>;
    readonly members: (args: {
      readonly channel: string;
      readonly cursor?: string;
      readonly limit: number;
    }) => Promise<{
      readonly members?: readonly string[];
      readonly response_metadata?: { readonly next_cursor?: string };
    }>;
  };
}

export interface PixlBackfillOptions {
  readonly apply: boolean;
  readonly delay?: (milliseconds: number) => Promise<void>;
}

export interface PixlBackfillSummary {
  readonly alreadyMember: number;
  readonly eligible: number;
  readonly failed: number;
  readonly invited: number;
  readonly missing: number;
  readonly skipped: number;
}

function uniqueSlackUserIds(candidateIds: readonly (string | null)[]): string[] {
  return [
    ...new Set(
      candidateIds.flatMap((candidateId) =>
        typeof candidateId === "string" && isSlackUserId(candidateId) ? [candidateId] : [],
      ),
    ),
  ];
}

async function existingPixlMemberIds(client: PixlBackfillClient): Promise<Set<string>> {
  const members = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await client.conversations.members({
      channel: PIXL_MAIN_CHANNEL,
      cursor,
      limit: 200,
    });
    for (const memberId of page.members ?? []) members.add(memberId);
    const nextCursor = page.response_metadata?.next_cursor?.trim();
    cursor = nextCursor || undefined;
  } while (cursor);
  return members;
}

function batches(ids: readonly string[]): string[][] {
  const result: string[][] = [];
  for (let index = 0; index < ids.length; index += INVITE_BATCH_SIZE) {
    result.push(ids.slice(index, index + INVITE_BATCH_SIZE));
  }
  return result;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function backfillPixlChannelMembers(
  candidateIds: readonly (string | null)[],
  client: PixlBackfillClient,
  options: PixlBackfillOptions,
): Promise<PixlBackfillSummary> {
  const eligibleIds = uniqueSlackUserIds(candidateIds);
  const existingIds = await existingPixlMemberIds(client);
  const missingIds = eligibleIds.filter((slackId) => !existingIds.has(slackId));
  const summary = {
    alreadyMember: eligibleIds.length - missingIds.length,
    eligible: eligibleIds.length,
    failed: 0,
    invited: 0,
    missing: missingIds.length,
    skipped: candidateIds.length - eligibleIds.length,
  };
  if (!options.apply) return summary;

  const delay = options.delay ?? wait;
  const invitationBatches = batches(missingIds);
  for (const [index, batch] of invitationBatches.entries()) {
    try {
      const response = await client.conversations.invite({
        channel: PIXL_MAIN_CHANNEL,
        force: true,
        users: batch.join(","),
      });
      if (response.ok === true) summary.invited += batch.length;
      else summary.failed += batch.length;
    } catch (error) {
      console.error("[pixl-membership] backfill invite failed", error);
      summary.failed += batch.length;
    }
    if (index < invitationBatches.length - 1) await delay(INVITE_BATCH_DELAY_MS);
  }
  return summary;
}
