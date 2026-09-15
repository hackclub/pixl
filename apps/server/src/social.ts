import { supabase } from "./db/client.js";
import { orValue } from "./db/pgCompat.js";

export interface FriendRow {
  requester_id: string;
  addressee_id: string;
  status: string;
  created_at: string;
}

// Every id these routes take comes off a request body and lands in a uuid
// column. Rejecting a malformed one here keeps a bad id a 400 instead of a
// Postgres cast error, which is the difference an error-oracle probe reads.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUserId(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export async function rowBetween(
  a: string,
  b: string,
): Promise<FriendRow | null> {
  const { data, error } = await supabase
    .from("friends")
    .select("*")
    .or(
      `and(requester_id.eq.${orValue(a)},addressee_id.eq.${orValue(b)}),` +
        `and(requester_id.eq.${orValue(b)},addressee_id.eq.${orValue(a)})`,
    )
    .limit(1);
  if (error) {
    console.error("[friends] pair query failed", error);
    return null;
  }
  return ((data ?? [])[0] as FriendRow) ?? null;
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  const row = await rowBetween(a, b);
  return row?.status === "accepted";
}
