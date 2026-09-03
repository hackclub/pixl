import { PIXL_MAIN_CHANNEL } from "../constants.js";

export interface SlackConversationClient {
  readonly conversations: {
    readonly invite: (args: {
      readonly channel: string;
      readonly users: string;
    }) => Promise<{ readonly ok?: boolean; readonly error?: string }>;
  };
}

export type PixlMembershipResult =
  | { readonly kind: "joined" }
  | { readonly kind: "already_member" }
  | { readonly kind: "failed"; readonly errorCode: string | null };

export function isSlackUserId(value: string): boolean {
  return /^[UW][A-Z0-9]{5,20}$/.test(value);
}

function slackErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  if ("error" in error && typeof error.error === "string") return error.error;
  if (!("data" in error) || typeof error.data !== "object" || error.data === null) return null;
  return "error" in error.data && typeof error.data.error === "string" ? error.data.error : null;
}

function resultForError(errorCode: string | null): PixlMembershipResult {
  return errorCode === "already_in_channel"
    ? { kind: "already_member" }
    : { kind: "failed", errorCode };
}

export async function ensurePixlChannelMembership(
  slackUserId: string,
  client: SlackConversationClient,
): Promise<PixlMembershipResult> {
  try {
    const result = await client.conversations.invite({
      channel: PIXL_MAIN_CHANNEL,
      users: slackUserId,
    });
    if (result.ok === true) return { kind: "joined" };
    return resultForError(result.error ?? null);
  } catch (error) {
    return resultForError(slackErrorCode(error));
  }
}
