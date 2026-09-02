export interface PendingTicketEvent {
  ts: string;
  channel: string;
  user: string;
  text?: string;
  [key: string]: unknown;
}

/** msg_ts -> pending title-prompt info, held during the 3min title-prompt window. */
export const pendingTickets = new Map<
  string,
  { event: PendingTicketEvent; timer: ReturnType<typeof setTimeout> }
>();

/** "Set a title" prompt messages, keyed by ticket msg_ts, deleted once the
 * user sets/skips the title or the ticket gets resolved. */
export const titlePrompts = new Map<string, { channel: string; ts: string }>();

export const creatingTickets = new Set<string>();
export const processedHelpMsgs = new Set<string>();

/** Membership checks run on every button click; cache them so a rate-limited
 * conversations.members call can't stall the whole interaction flow each time. */
export const ticketChannelMembership = new Map<string, { ok: boolean; at: number }>();
export const MEMBERSHIP_TTL_MS = 5 * 60 * 1000;
