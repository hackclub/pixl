import { createHmac } from "crypto";
import { sql } from "./db/pgCompat.js";

// Forwards project notifications to the Little Guy relay (a desktop pet that
// pops them up for players who linked it). drizzle/0201_little_guy_notify.sql
// raises a pg_notify on 'little_guy' for project notifications and review
// claims; this listens for them, signs each one and POSTs it to the relay.
//
// Fails closed: without both env vars nothing is listened to or sent. The key
// only ever lives in this env, never in the database. NOTIFY isn't queued, so
// anything raised while this server is down is dropped - the player's pixl
// inbox still has it.
const TIMEOUT_MS = 5000;

interface LittleGuyEvent {
  id: string;
  slack_ids: string[];
  kind: string;
  title: string;
  project: string | null;
}

function isEvent(v: unknown): v is LittleGuyEvent {
  const e = v as LittleGuyEvent;
  return (
    typeof e?.id === "string" &&
    Array.isArray(e.slack_ids) &&
    e.slack_ids.every((s) => typeof s === "string") &&
    typeof e.kind === "string" &&
    typeof e.title === "string"
  );
}

// The relay checks x-little-guy-signature = HMAC-SHA256(key, `${ts}.${body}`)
// and rejects stale timestamps, so a captured request can't be replayed later.
async function forward(url: string, key: string, event: LittleGuyEvent): Promise<void> {
  const body = JSON.stringify(event);
  const ts = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", key).update(`${ts}.${body}`).digest("hex");
  try {
    const res = await fetch(`${url}/webhook/pixl`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-little-guy-timestamp": ts,
        "x-little-guy-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) console.error(`[little-guy] relay returned ${res.status} for ${event.id}`);
  } catch (e: unknown) {
    console.error("[little-guy]", e instanceof Error ? e.message : e);
  }
}

export async function startLittleGuyForwarder(): Promise<void> {
  const url = process.env.LITTLE_GUY_URL?.replace(/\/+$/, "");
  const key = process.env.LITTLE_GUY_API_KEY;
  if (!url || !key) return;
  try {
    // postgres.js keeps a dedicated connection for this and re-LISTENs on
    // reconnect by itself
    await sql.listen(
      "little_guy",
      (payload) => {
        let event: unknown;
        try {
          event = JSON.parse(payload);
        } catch {
          return;
        }
        if (isEvent(event)) void forward(url, key, event);
      },
      () => console.log("[little-guy] listening for project notifications"),
    );
  } catch (e: unknown) {
    console.error("[little-guy] LISTEN failed, not forwarding", e instanceof Error ? e.message : e);
  }
}
