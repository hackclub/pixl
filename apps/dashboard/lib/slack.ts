const API = "https://slack.com/api";

function botToken(): string {
  const t = process.env.SLACK_BOT_TOKEN;
  if (!t) throw new Error("SLACK_BOT_TOKEN is not set");
  return t;
}

// Some Web API methods (users.info in particular) silently fail to read
// their params from a JSON body , form-encoding is what actually works for
// every method, so that's what we send. Complex values (arrays/objects, e.g.
// chat.postMessage's `blocks`) get JSON-stringified into their form field,
// which Slack expects.
function toFormBody(body: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    params.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  return params;
}

async function slackCall(
  method: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: toFormBody(body),
  });
  const json = (await res.json()) as Record<string, unknown> & {
    ok: boolean;
    error?: string;
  };
  if (!json.ok) throw new Error(`Slack ${method} failed: ${json.error}`);
  return json;
}

const HANDLE_TTL = 10 * 60_000;

// Workspace-wide id -> profile photo map, for filling player cards.
export async function slackAvatars(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!process.env.SLACK_BOT_TOKEN) return map;
  try {
    let cursor = "";
    for (let page = 0; page < 20; page++) {
      const res = (await slackCall("users.list", { limit: 200, cursor })) as {
        members?: { id?: string; profile?: { image_512?: string; image_192?: string } }[];
        response_metadata?: { next_cursor?: string };
      };
      for (const u of res.members ?? []) {
        const img = u.profile?.image_512 || u.profile?.image_192;
        if (u.id && img) map.set(u.id, img);
      }
      cursor = res.response_metadata?.next_cursor ?? "";
      if (!cursor) break;
    }
  } catch (e) {
    console.error("slack avatars failed", (e as Error).message);
  }
  return map;
}

// Resolve a single id -> "@handle" via one users.info call (cheap and fast),
// cached per-id. This replaces crawling the whole workspace with users.list,
// which paginated up to 20 rate-limited calls and stalled the review page.
const idHandleCache = new Map<string, { at: number; handle: string | null }>();

export async function slackHandle(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const hit = idHandleCache.get(id);
  if (hit && Date.now() - hit.at < HANDLE_TTL) return hit.handle;
  let handle: string | null = null;
  if (process.env.SLACK_BOT_TOKEN) {
    try {
      const res = (await slackCall("users.info", { user: id })) as {
        user?: { name?: string; profile?: { display_name?: string } };
      };
      const h = res.user?.profile?.display_name || res.user?.name;
      handle = h ? `@${h}` : null;
    } catch (e) {
      console.error("slack users.info failed", (e as Error).message);
    }
  }
  idHandleCache.set(id, { at: Date.now(), handle });
  return handle;
}

export async function slackHandles(
  ids: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, string>();
  await Promise.all(
    uniq.map(async (id) => {
      const h = await slackHandle(id);
      if (h) out.set(id, h);
    }),
  );
  return out;
}

// Per-id avatar lookup (one users.info call per id, cached) - for small lists
// like the Forms tab where crawling the whole workspace via slackAvatars()
// above would be overkill.
const idAvatarCache = new Map<string, { at: number; url: string | null }>();

export async function slackAvatarsFor(
  ids: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, string>();
  if (!process.env.SLACK_BOT_TOKEN) return out;
  await Promise.all(
    uniq.map(async (id) => {
      const hit = idAvatarCache.get(id);
      let url: string | null;
      if (hit && Date.now() - hit.at < HANDLE_TTL) {
        url = hit.url;
      } else {
        const profile = await getSlackUserProfile(id).catch(() => null);
        url = profile?.image192 || profile?.image512 || null;
        idAvatarCache.set(id, { at: Date.now(), url });
      }
      if (url) out.set(id, url);
    }),
  );
  return out;
}

export interface SlackUserProfile {
  id: string;
  teamId?: string;
  name?: string;
  realName?: string;
  displayName?: string;
  email?: string;
  phone?: string;
  title?: string;
  skype?: string;
  timezone?: string;
  timezoneLabel?: string;
  timezoneOffset?: number;
  statusText?: string;
  statusEmoji?: string;
  image192?: string;
  image512?: string;
  isAdmin: boolean;
  isOwner: boolean;
  isPrimaryOwner: boolean;
  isBot: boolean;
  isRestricted: boolean;
  isUltraRestricted: boolean;
  deleted: boolean;
  updated?: number;
}

// Full profile for the Slack Lookup admin tool , everything users.info hands
// back, normalized into one flat shape. Returns null on any failure (bad id,
// user_not_found, etc.) so the page can show a plain "not found" instead of
// crashing.
export async function getSlackUserProfile(id: string): Promise<SlackUserProfile | null> {
  try {
    const res = (await slackCall("users.info", { user: id })) as {
      user?: {
        id: string;
        team_id?: string;
        name?: string;
        real_name?: string;
        deleted?: boolean;
        is_admin?: boolean;
        is_owner?: boolean;
        is_primary_owner?: boolean;
        is_bot?: boolean;
        is_restricted?: boolean;
        is_ultra_restricted?: boolean;
        updated?: number;
        tz?: string;
        tz_label?: string;
        tz_offset?: number;
        profile?: {
          display_name?: string;
          real_name?: string;
          email?: string;
          phone?: string;
          title?: string;
          skype?: string;
          status_text?: string;
          status_emoji?: string;
          image_192?: string;
          image_512?: string;
        };
      };
    };
    const u = res.user;
    if (!u) return null;
    return {
      id: u.id,
      teamId: u.team_id,
      name: u.name,
      realName: u.profile?.real_name || u.real_name,
      displayName: u.profile?.display_name,
      email: u.profile?.email,
      phone: u.profile?.phone,
      title: u.profile?.title,
      skype: u.profile?.skype,
      timezone: u.tz,
      timezoneLabel: u.tz_label,
      timezoneOffset: u.tz_offset,
      statusText: u.profile?.status_text,
      statusEmoji: u.profile?.status_emoji,
      image192: u.profile?.image_192,
      image512: u.profile?.image_512,
      isAdmin: !!u.is_admin,
      isOwner: !!u.is_owner,
      isPrimaryOwner: !!u.is_primary_owner,
      isBot: !!u.is_bot,
      isRestricted: !!u.is_restricted,
      isUltraRestricted: !!u.is_ultra_restricted,
      deleted: !!u.deleted,
      updated: u.updated,
    };
  } catch (e) {
    console.error("getSlackUserProfile failed", (e as Error).message);
    return null;
  }
}

// Post to a channel as the dashboard bot (bot must be invited to the channel).
export async function postToChannel(channel: string, text: string): Promise<void> {
  await slackCall("chat.postMessage", { channel, text, unfurl_links: false });
}

// Relays a DM through Pixorpheus's external DM API. Only used when BOTH
// EXTERNAL_DM_URL and EXTERNAL_API_KEY are set , otherwise we DM straight from
// the dashboard's Slack bot (see dmUser). No hardcoded host fallback: an unset
// URL must never silently POST player DMs to some other deployment.
async function dmViaPixorpheus(url: string, key: string, userId: string, text: string): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ userId, message: text }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {}
    throw new Error(`Pixorpheus DM failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
}

// All player-facing DMs (warns, bans, project approve/reject/ban, shipping
// tracking, notices). By default these go out directly from the dashboard's
// Slack bot , the same token the tickets/avatar helpers already use , so DMs
// don't depend on a separate Pixorpheus process being deployed and reachable.
// Set EXTERNAL_DM_URL (+ EXTERNAL_API_KEY) to route through Pixorpheus instead.
export async function dmUser(slackUserId: string, text: string): Promise<void> {
  const url = process.env.EXTERNAL_DM_URL;
  const key = process.env.EXTERNAL_API_KEY;
  if (url && key) {
    await dmViaPixorpheus(url, key, slackUserId, text);
    return;
  }
  // chat.postMessage with a user id as the channel opens (or reuses) the IM.
  await slackCall("chat.postMessage", { channel: slackUserId, text });
}
