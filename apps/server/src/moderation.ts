import { supabase } from "./db/client.js";
import { orValue } from "./db/pgCompat.js";
import { verifySessionToken } from "./auth/session.js";

// Normalized roots (see normalize below): lowercase, leetspeak folded, symbols
// stripped. Substring match, so common evasions like f.u-c_k or sh1t still hit.
const BLOCKED = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "cunt",
  "dick",
  "cock",
  "pussy",
  "whore",
  "slut",
  "siut",
  "faggot",
  "nigger",
  "nigga",
  "retard",
  "rape",
  "nazi",
  "hitler",
  "kys",
  "chink",
  "spic",
  "kike",
  "tranny",
  "wanker",
  "bastard",
  "douche",
  "penis",
  "vagina",
  "porn",
  "sexy",
  "jizz",
  "hentai",
  "blowjob",
  "handjob",
  "dildo",
  "milf",
  "boobs",
  "titties",
  "orgasm",
  "masturbat",
  "deepthroat",
];

// Insults matched as whole words only (substring would hit "father",
// "so fa table"…). Tokens are folded first, so fατ / f4t / faaat still count.
const BLOCKED_EXACT = [
  "fatty",
  "ugly",
  "dumbass",
  "idiot",
  "loser",
  "moron",
  "imbecile",
  "cum",
  "cums",
  "cumming",
  "cummed",
  "anal",
  "sex",
  "tits",
  "horny",
  "thot",
  "nudes",
  "nude",
  "fuk",
  "fuc",
  "fck",
  "fudk",
  "fux",
  "fack",
  "phuck",
  "dik",
  "dlck",
  "cok",
  "pnis",
  "ponis",
  "penus",
  "bich",
  "biatch",
  "shyt",
  "mf",
  "mfs",
  "mfer",
  "mfers",
];

// Cyrillic/Greek lookalikes folded to the latin letters they imitate, so
// "fατ" or "сунт" can't slip past the filter.
const HOMOGLYPHS: Record<string, string> = {
  "а": "a", "в": "b", "с": "c", "е": "e", "н": "h", "к": "k", "м": "m",
  "о": "o", "р": "p", "т": "t", "у": "y", "х": "x", "г": "r", "и": "n",
  "п": "n", "ѕ": "s", "ј": "j", "і": "i", "ԁ": "d", "ԛ": "q", "ѡ": "w",
  "α": "a", "β": "b", "γ": "y", "δ": "d", "ε": "e", "η": "n", "ι": "i",
  "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "σ": "s", "ς": "s", "τ": "t",
  "υ": "u", "χ": "x", "ω": "w", "μ": "u", "λ": "l", "θ": "o", "π": "n",
  "ϲ": "c", "ϳ": "j", "ϝ": "f", "ѵ": "v", "ъ": "b", "ь": "b", "ц": "u",
  "ø": "o", "ß": "s", "æ": "a", "œ": "o", "ł": "l", "đ": "d", "ð": "d",
  "ħ": "h", "þ": "p", "ŧ": "t", "ı": "i", "ŋ": "n", "ə": "e", "ǝ": "e",
  "ɑ": "a", "ɔ": "o", "ƒ": "f", "ɡ": "g", "ĸ": "k", "ſ": "s", "ʃ": "s",
  "ʒ": "z", "ɐ": "a", "ʇ": "t", "ʞ": "k", "ɟ": "f", "ɹ": "r", "ʍ": "w",
};

const LEET: Record<string, string> = {
  "@": "a", "4": "a", "0": "o", "1": "i", "!": "i", "|": "i",
  "3": "e", "5": "s", "$": "s", "7": "t", "8": "b", "9": "g", "6": "g",
};

// One character -> the latin letter it reads as, or "" for separators.
function foldChar(ch: string): string {
  let c = ch.toLowerCase();
  if (HOMOGLYPHS[c]) c = HOMOGLYPHS[c];
  c = c.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  if (c.length > 1) c = c[0] ?? "";
  if (HOMOGLYPHS[c]) c = HOMOGLYPHS[c];
  if (LEET[c]) c = LEET[c];
  return c >= "a" && c <= "z" ? c : "";
}

export function normalize(raw: string): string {
  let out = "";
  for (const ch of raw) out += foldChar(ch);
  return out;
}

function collapseRuns(flat: string): string {
  let out = "";
  for (let i = 0; i < flat.length; i++) if (flat[i] !== flat[i - 1]) out += flat[i];
  return out;
}

function isExactBlocked(foldedToken: string): boolean {
  if (foldedToken === "") return false;
  const collapsed = collapseRuns(foldedToken);
  return BLOCKED_EXACT.includes(foldedToken) || BLOCKED_EXACT.includes(collapsed);
}

export function containsBlocked(raw: string): boolean {
  const flat = normalize(raw);
  const collapsed = collapseRuns(flat);
  if (BLOCKED.some((bad) => flat.includes(bad) || collapsed.includes(bad))) return true;
  return raw
    .split(/\s+/)
    .some((token) => isExactBlocked(normalize(token)));
}

// Stars out every span whose folded letters spell a blocked word, across
// spaces, dots, leetspeak, homoglyphs and stretched letters ("s h 1 t",
// "fuuuck", "fατ" all get censored). Everything else is left intact.
export function censorChat(text: string): string {
  const chars = [...text];
  const flat: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    const f = foldChar(chars[i]);
    if (f !== "") {
      flat.push(f);
      map.push(i);
    }
  }
  const flatStr = flat.join("");
  const hit = new Set<number>();
  const markFlatRange = (from: number, to: number) => {
    for (let k = from; k < to && k < map.length; k++) hit.add(map[k]);
  };
  for (const bad of BLOCKED) {
    let idx = 0;
    while ((idx = flatStr.indexOf(bad, idx)) !== -1) {
      markFlatRange(idx, idx + bad.length);
      idx += 1;
    }
  }
  const cFlat: string[] = [];
  const cStart: number[] = [];
  for (let k = 0; k < flat.length; k++) {
    if (k === 0 || flat[k] !== flat[k - 1]) {
      cFlat.push(flat[k]);
      cStart.push(k);
    }
  }
  const cStr = cFlat.join("");
  for (const bad of BLOCKED) {
    let idx = 0;
    while ((idx = cStr.indexOf(bad, idx)) !== -1) {
      const from = cStart[idx];
      const to = idx + bad.length < cStart.length ? cStart[idx + bad.length] : flat.length;
      markFlatRange(from, to);
      idx += 1;
    }
  }
  // Exact-word insults: mark whole tokens (runs of foldable chars) whose
  // folded form is on the exact list.
  let tokenStart = -1;
  let tokenFolded = "";
  const flushToken = (end: number) => {
    if (tokenStart >= 0 && isExactBlocked(tokenFolded))
      for (let i = tokenStart; i < end; i++) hit.add(i);
    tokenStart = -1;
    tokenFolded = "";
  };
  for (let i = 0; i < chars.length; i++) {
    const f = foldChar(chars[i]);
    if (f === "") flushToken(i);
    else {
      if (tokenStart < 0) tokenStart = i;
      tokenFolded += f;
    }
  }
  flushToken(chars.length);

  if (hit.size === 0) return text;

  const starred = [...hit].sort((a, b) => a - b);
  for (let n = 1; n < starred.length; n++) {
    const a = starred[n - 1];
    const b = starred[n];
    if (b - a > 1 && b - a <= 6) {
      let onlySeparators = true;
      for (let i = a + 1; i < b; i++)
        if (foldChar(chars[i]) !== "") {
          onlySeparators = false;
          break;
        }
      if (onlySeparators) for (let i = a + 1; i < b; i++) hit.add(i);
    }
  }
  return chars.map((ch, i) => (hit.has(i) ? "*" : ch)).join("");
}

const WARN_AFTER = 3;
const BAN_AFTER = 7;

// No fallback here on purpose, a hardcoded default would silently route
// player Slack IDs and violation text to whatever domain happens to be
// baked in if the env var is ever unset, rather than failing closed.
const EXTERNAL_DM_URL = process.env.EXTERNAL_DM_URL;

// Slack DM as Pixo (same external API the dashboard uses). Fire-and-forget:
// moderation must never fail because the DM did.
async function dmSlack(userId: string, text: string): Promise<void> {
  const key = process.env.EXTERNAL_API_KEY;
  if (!key || !EXTERNAL_DM_URL) return;
  const { data: user } = await supabase
    .from("users")
    .select("slack_id")
    .eq("id", userId)
    .maybeSingle();
  const slackId = (user?.slack_id as string) ?? "";
  if (!slackId) return;
  try {
    await fetch(EXTERNAL_DM_URL, {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ userId: slackId, message: text }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    console.error("moderation dm failed", e);
  }
}

export interface ViolationOutcome {
  count: number;
  warned: boolean;
  banned: boolean;
}

// Log a chat violation and escalate: from the 3rd violation on the player is
// warned every time, at the 7th they're banned automatically.
export async function recordChatViolation(
  userId: string,
  content: string,
): Promise<ViolationOutcome> {
  await supabase
    .from("violations")
    .insert({ user_id: userId, kind: "chat", content });
  const { count } = await supabase
    .from("violations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", "chat");
  const n = count ?? 0;

  if (n >= BAN_AFTER) {
    const existing = await activeBan(userId);
    if (!existing) {
      const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
      const reason = `Automatic 1-week ban: ${n} chat filter violations.`;
      await supabase.from("bans").insert({
        user_id: userId,
        reason,
        banned_by: "Auto-mod",
        expires_at: expiresAt,
      });
      const { data: recent } = await supabase
        .from("violations")
        .select("content")
        .eq("user_id", userId)
        .eq("kind", "chat")
        .order("created_at", { ascending: false })
        .limit(5);
      const list =
        (recent ?? []).map((v) => `• "${v.content}"`).join("\n") || "(none on record)";
      const body =
        `You've been banned from Pixl for 1 week after ${n} chat filter violations.\n\n` +
        `Your most recent flagged messages:\n${list}\n\n` +
        `Your ban lifts automatically on ${new Date(expiresAt).toUTCString()}. ` +
        `If you believe this is a mistake, contact the Pixl team.`;
      await supabase.from("notifications").insert({
        user_id: userId,
        title: "Banned from Pixl (1 week)",
        body,
      });
      await dmSlack(userId, `You've been banned from Pixl for 1 week.\n\n${body}`);
      return { count: n, warned: false, banned: true };
    }
    return { count: n, warned: true, banned: false };
  }
  if (n >= WARN_AFTER) {
    const body = `Warning ${n}/${BAN_AFTER}: keep the chat clean. At ${BAN_AFTER} violations you're banned automatically.`;
    await supabase.from("notifications").insert({
      user_id: userId,
      title: "Chat warning",
      body,
    });
    await dmSlack(userId, `⚠ ${body}`);
    return { count: n, warned: true, banned: false };
  }
  return { count: n, warned: false, banned: false };
}

// Fire-and-forget moderation log; the dashboard reads these.
export function logViolation(
  userId: string,
  kind: "chat" | "name",
  content: string,
): void {
  void supabase
    .from("violations")
    .insert({ user_id: userId, kind, content })
    .then(({ error }) => {
      if (error) console.error("Failed to log violation", error);
    });
}

export interface BanRow {
  id: number;
  user_id: string;
  reason: string;
  banned_by: string;
  expires_at: string | null;
  lifted_at: string | null;
  created_at: string;
}

export type BanLookup = { ok: true; ban: BanRow | null } | { ok: false };

export async function lookupActiveBan(userId: string): Promise<BanLookup> {
  const { data, error } = await supabase
    .from("bans")
    .select("*")
    .eq("user_id", userId)
    .is("lifted_at", null)
    .or(`expires_at.is.null,expires_at.gt.${orValue(new Date().toISOString())}`)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("Failed to check bans", error);
    return { ok: false };
  }
  return { ok: true, ban: (data && (data[0] as BanRow)) ?? null };
}

// Returns the active ban for a user, or null. A ban is active while it hasn't
// been lifted and either never expires or expires in the future.
export async function activeBan(userId: string): Promise<BanRow | null> {
  const result = await lookupActiveBan(userId);
  return result.ok ? result.ban : null;
}

// A signed, unexpired JWT only ever proved who someone was *when it was
// issued* - every plain HTTP route just checked the signature and moved on,
// so a player banned mid-session (their token has up to 14 days left, see
// issueSessionToken) could keep shipping, buying, voting, uploading, etc.
// through every route that never independently re-checked ban status. The
// WebSocket path already re-checks (activeBan at connect, sweepBans while
// connected) - this brings HTTP requests to the same standard, in one place
// instead of a bespoke check bolted onto dozens of routes.
//
// A short in-memory cache keeps this from adding a DB round-trip to every
// single request; a newly-banned player can make a few more requests within
// the cache window, same trade-off sweepBans already makes on the WS side.
const BAN_CACHE_TTL_MS = 30_000;
const BAN_CACHE_MAX = 50_000;

export type BanState = "banned" | "clear" | "unknown";

export function createBanStateCache(
  lookup: (userId: string) => Promise<BanState>,
  ttlMs = BAN_CACHE_TTL_MS,
  now: () => number = Date.now,
) {
  const cache = new Map<string, { banned: boolean; at: number }>();
  return async function banState(userId: string): Promise<BanState> {
    const cached = cache.get(userId);
    if (cached && now() - cached.at < ttlMs) return cached.banned ? "banned" : "clear";
    const fresh = await lookup(userId);
    if (fresh === "unknown") return cached?.banned ? "banned" : "unknown";
    if (cache.size >= BAN_CACHE_MAX) {
      for (const [id, entry] of cache) if (now() - entry.at >= ttlMs) cache.delete(id);
    }
    cache.set(userId, { banned: fresh === "banned", at: now() });
    return fresh;
  };
}

const currentBanState = createBanStateCache(async (userId) => {
  const result = await lookupActiveBan(userId);
  if (!result.ok) return "unknown";
  return result.ban ? "banned" : "clear";
});

export interface EnforceActiveBansDeps {
  banState?: (userId: string) => Promise<BanState>;
  verify?: (token: string) => ReturnType<typeof verifySessionToken>;
}

// Express middleware, mounted globally in index.ts. Reads the same
// `?token=` every route already reads; a request with no token, or one that
// fails signature/expiry verification, is left untouched - that's the
// existing per-route "not authenticated" handling's job, not this
// middleware's. This only ever acts on a token that verifies successfully
// but names a currently-banned user, which every route handler skips being
// reached for entirely.
export function enforceActiveBans(deps: EnforceActiveBansDeps = {}) {
  const banState = deps.banState ?? currentBanState;
  const verify = deps.verify ?? verifySessionToken;
  return async (
    req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction,
  ): Promise<void> => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) return next();
    const session = verify(token);
    if (!session) return next();
    let state: BanState;
    try {
      state = await banState(session.userId);
    } catch {
      state = "unknown";
    }
    if (state === "banned") {
      res.status(403).json({ ok: false, error: "banned" });
      return;
    }
    if (state === "unknown" && req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Retry-After", "5");
      res.status(503).json({ ok: false, error: "ban_check_unavailable" });
      return;
    }
    next();
  };
}
