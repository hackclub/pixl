import { Router } from "express";
import crypto from "crypto";
import { supabase, type UserRow } from "../db/client.js";
import { issueSessionToken, verifySessionToken } from "../auth/session.js";
import { activeBan } from "../moderation.js";
import { fetchSlackAvatar, fetchSlackDisplayName } from "../slackAvatar.js";
import { enrollSlackPlayerInPixl } from "../pixlSlack.js";
import { config } from "../config.generated.js";
import { encryptPII } from "../crypto.js";

const router = Router();

async function saveSlackAvatar(userId: string, slackId: string): Promise<void> {
  const url = await fetchSlackAvatar(slackId);
  if (!url) return;
  const { error } = await supabase.from("users").update({ avatar_url: url }).eq("id", userId);
  if (error) console.error("Failed to save slack avatar", error.message);
}

router.get("/auth/demo", async (req, res) => {
  if (process.env.ALLOW_DEMO_LOGIN !== "true") {
    return res.status(403).json({ error: "Demo login disabled" });
  }

  const name = (req.query.name as string)?.trim();
  if (!name) {
    return res.status(400).json({ error: "Missing ?name= query param" });
  }

  const demoOauthId = `demo_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

  const { data: existingUsers, error: lookupError } = await supabase
    .from("users")
    .select("*")
    .eq("oauth_provider", "demo")
    .eq("oauth_id", demoOauthId)
    .limit(1);

  if (lookupError) {
    console.error("Supabase lookup failed", lookupError);
    return res.status(500).json({ error: "Database error" });
  }

  let userId: string;
  let displayName: string;

  if (existingUsers && existingUsers.length > 0) {
    const existing = existingUsers[0] as UserRow;
    userId = existing.id;
    displayName = existing.display_name;
  } else {
    const { data: created, error: insertError } = await supabase
      .from("users")
      .insert({
        oauth_provider: "demo",
        oauth_id: demoOauthId,
        display_name: name,
        real_name: name,
        avatar_url: null,
      })
      .select()
      .single();

    if (insertError || !created) {
      console.error("Supabase insert failed", insertError);
      return res.status(500).json({ error: "Database error" });
    }

    const row = created as UserRow;
    userId = row.id;
    displayName = row.display_name;

    const { error: stateError } = await supabase
      .from("player_state")
      .insert({ user_id: userId });

    if (stateError) {
      console.error("Failed to seed player_state", stateError);
    }
  }

  const sessionToken = issueSessionToken({ userId, displayName });
  res.json({ token: sessionToken, name: displayName });
});

const HCA_BASE_URL = "https://auth.hackclub.com";
const CLIENT_ID = process.env.HCA_CLIENT_ID!;
const CLIENT_SECRET = process.env.HCA_CLIENT_SECRET!;
const REDIRECT_URI = process.env.HCA_REDIRECT_URI!;
// Every login used to request phone+address up front, even though nothing
// but a shop order ever needs them , everyone got HCA's address/phone
// consent screen just to sign in and play. General login now only asks for
// birthdate (needed broadly for YSWS age eligibility, not shop-specific);
// phone/address are requested separately, only when a player actually starts
// a purchase (see the verify-address flow below, which already existed for
// re-verifying a stale address and now also covers a player's first order).
const HCA_LOGIN_SCOPES = "openid profile slack_id birthdate basic_info";
const HCA_ADDRESS_SCOPES =
  "openid profile slack_id phone birthdate address basic_info";

// Maps OAuth `state` -> when it stops being valid, plus the web game's URL to
// redirect back to after login (only set when the login was started from a web
// export). Abandoned logins are never claimed, so they're swept on a timer.
//
// purpose distinguishes a normal login (creates/signs in a user, issues a
// session) from a "verify address" round trip started from shop checkout
// (re-authorizes with HCA to refresh the address on an *already* logged-in
// user, no new session). userId is only set for the latter.
interface PendingLogin {
  expiresAt: number;
  webRedirect?: string;
  purpose?: "verify_address";
  userId?: string;
}
const PENDING_LOGIN_TTL_MS = 10 * 60_000;
const pendingLogins = new Map<string, PendingLogin>();

setInterval(() => {
  const now = Date.now();
  for (const [state, pending] of pendingLogins) {
    if (pending.expiresAt <= now) pendingLogins.delete(state);
  }
}, 60_000).unref();

// The session JWT is handed to whatever web_redirect points at, so an
// unrestricted value is an account takeover: a link with someone else's host
// logs the attacker into the victim's account. Only origins we serve the game
// from are allowed.
//
// Keep this list to hosts that are live RIGHT NOW. A retired domain left in
// here is a standing liability: if it ever lapses and someone else registers
// it, this hands them real session tokens. The old pixl.rsvp trio was dropped
// on 2026-08-17 for exactly that reason, the game moved to *.hackclub.com and
// all three had gone 404.
const ALLOWED_REDIRECT_HOSTS = new Set(
  [
    new URL(config.urls.site).hostname,
    new URL(config.urls.play).hostname,
    ...(process.env.WEB_REDIRECT_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
  ].map((h) => h.toLowerCase()),
);

// Opt-in, not NODE_ENV based: prod doesn't set NODE_ENV, so keying off it would
// leave localhost redirects allowed on the live server.
const ALLOW_LOCAL_REDIRECT = process.env.ALLOW_LOCAL_REDIRECT === "true";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Returns the redirect stripped down to origin + path + query (host/protocol
// validated below; the query string is inert data the game round-trips to
// itself, e.g. the verify-address flow uses it to remember which item was
// mid-checkout), or null if it isn't one of ours.
function safeWebRedirect(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const isLocal = ALLOW_LOCAL_REDIRECT && LOCAL_HOSTS.has(host);
  if (!isLocal) {
    if (url.protocol !== "https:") return null;
    if (!ALLOWED_REDIRECT_HOSTS.has(host)) return null;
  }
  return `${url.origin}${url.pathname}${url.search}`;
}

interface HackClubTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

interface HcaAddress {
  id?: string;
  first_name?: string;
  last_name?: string;
  line_1?: string;
  line_2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  phone_number?: string;
  primary?: boolean;
}

interface HackClubMeResponse {
  identity: {
    id: string;
    first_name?: string;
    last_name?: string;
    primary_email?: string;
    slack_id?: string;
    // Confirmed against hackclub/auth's own jbuilder templates
    // (app/views/api/v1/identities/_identity.jb, _address.jb) , NOT the OIDC
    // standard claim names the "birthdate"/"address" scopes might suggest.
    // The "birthdate" scope's field is `birthday`, and "address" grants an
    // `addresses` ARRAY (one entry per address on file), not a single object.
    birthday?: string;
    addresses?: HcaAddress[];
    [key: string]: unknown;
  };
  scopes: string[];
}

function extractBirthday(identity: HackClubMeResponse["identity"]): string | null {
  const raw = identity.birthday;
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime()) || date > new Date() || date.getFullYear() < 1900) {
    console.warn("HCA birthday didn't parse as a date:", raw);
    return null;
  }
  return raw.slice(0, 10);
}

interface HcaAddressPatch {
  address_line1: string;
  address_line2: string;
  address_city: string;
  address_state: string;
  address_country: string;
  address_postal: string;
}

function extractAddress(identity: HackClubMeResponse["identity"]): HcaAddressPatch | null {
  const addresses = identity.addresses;
  if (!Array.isArray(addresses) || addresses.length === 0) return null;
  const addr = addresses.find((a) => a.primary) ?? addresses[0];
  const line1 = String(addr.line_1 ?? "").trim();
  const city = String(addr.city ?? "").trim();
  const country = String(addr.country ?? "").trim();
  const postal = String(addr.postal_code ?? "").trim();
  if (!line1 || !city || !country || !postal) {
    console.warn("HCA address missing expected fields, raw keys:", Object.keys(addr));
    return null;
  }
  return {
    address_line1: line1,
    address_line2: String(addr.line_2 ?? "").trim(),
    address_city: city,
    address_state: String(addr.state ?? "").trim(),
    address_country: country,
    address_postal: postal,
  };
}

function loginErrorPage(heading: string, detail: string, retry: string): string {
  return `<html><body style="font-family:sans-serif;text-align:center;margin-top:4rem;"><h2>${heading}</h2><p>${detail}</p><p><a href="${retry}">Try logging in again</a></p></body></html>`;
}

router.get("/auth/hackclub", (req, res) => {
  const requestedRedirect = req.query.web_redirect as string | undefined;
  let webRedirect: string | null = null;
  if (requestedRedirect) {
    webRedirect = safeWebRedirect(requestedRedirect);
    if (!webRedirect) {
      console.warn("Rejected web_redirect", requestedRedirect);
      return res.status(400).send("Invalid redirect target");
    }
  }

  const state = crypto.randomBytes(16).toString("hex");
  pendingLogins.set(state, {
    expiresAt: Date.now() + PENDING_LOGIN_TTL_MS,
    webRedirect: webRedirect ?? undefined,
  });

  const url = new URL(`${HCA_BASE_URL}/oauth/authorize`);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  // Must stay a subset of the scopes the HCA app is registered for, HCA
  // rejects the whole authorize request otherwise. "email"/"name"/
  // "verification_status" were never registered names.
  url.searchParams.set("scope", HCA_LOGIN_SCOPES);
  url.searchParams.set("state", state);

  res.redirect(url.toString());
});

// Re-authorizes with HCA to pull a fresh phone+address for an
// already-logged-in player, without touching their session , used for the
// "verify address" button on shop checkout (a stale address on file
// shouldn't silently ship wrong) and now also the first time a player starts
// an order at all, since general login no longer asks HCA for this.
// Deliberately not auto-triggered; the player has to click it / start a buy.
router.get("/auth/hackclub/verify-address", (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).send("Not logged in");

  const requestedRedirect = req.query.web_redirect as string | undefined;
  let webRedirect: string | null = null;
  if (requestedRedirect) {
    webRedirect = safeWebRedirect(requestedRedirect);
    if (!webRedirect) {
      console.warn("Rejected web_redirect", requestedRedirect);
      return res.status(400).send("Invalid redirect target");
    }
  }

  const state = crypto.randomBytes(16).toString("hex");
  pendingLogins.set(state, {
    expiresAt: Date.now() + PENDING_LOGIN_TTL_MS,
    webRedirect: webRedirect ?? undefined,
    purpose: "verify_address",
    userId: session.userId,
  });

  const url = new URL(`${HCA_BASE_URL}/oauth/authorize`);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", HCA_ADDRESS_SCOPES);
  url.searchParams.set("state", state);

  res.redirect(url.toString());
});

router.get("/auth/hackclub/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;

  const pending = state ? pendingLogins.get(state) : undefined;
  if (state) pendingLogins.delete(state);
  if (!code || !pending) {
    return res.status(400).send("Invalid OAuth state");
  }
  if (pending.expiresAt <= Date.now()) {
    return res.status(400).send("Login took too long, please try again");
  }

  const webRedirect = pending.webRedirect;

  const tokenRes = await fetch(`${HCA_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error("HCA token exchange failed", tokenRes.status, body);
    // HCA throttles the token endpoint ("slow your roll!") if you log in and
    // out a few times in a row. The code is spent either way, so the only way
    // through is a fresh login once their window clears.
    const throttled = tokenRes.status === 429 || body.includes("slow your roll");
    const retry =
      "/auth/hackclub" +
      (webRedirect ? `?web_redirect=${encodeURIComponent(webRedirect)}` : "");
    return res
      .status(throttled ? 429 : 502)
      .send(
        loginErrorPage(
          throttled ? "Hack Club Auth is rate limiting us" : "Login failed",
          throttled
            ? "Too many logins in a row. Give it a minute, then try again."
            : "Hack Club Auth wouldn't hand over your session.",
          retry,
        ),
      );
  }

  const tokens = (await tokenRes.json()) as HackClubTokenResponse;

  const meRes = await fetch(`${HCA_BASE_URL}/api/v1/me`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!meRes.ok) {
    console.error("HCA /me fetch failed", await meRes.text());
    return res.status(502).send("Failed to fetch user identity");
  }

  const me = (await meRes.json()) as HackClubMeResponse;
  const identity = me.identity;

  if (pending.purpose === "verify_address") {
    const addr = extractAddress(identity);
    if (addr && pending.userId) {
      const { error: addrErr } = await supabase
        .from("users")
        .update({
          address_line1: encryptPII(addr.address_line1),
          address_line2: encryptPII(addr.address_line2),
          address_city: encryptPII(addr.address_city),
          address_state: encryptPII(addr.address_state),
          address_country: encryptPII(addr.address_country),
          address_postal: encryptPII(addr.address_postal),
        })
        .eq("id", pending.userId);
      if (addrErr) console.error("Failed to refresh address from HCA", addrErr.message);
    }
    const target = webRedirect ?? config.urls.play;
    const dest = new URL(target);
    dest.searchParams.set("addr_verified", addr ? "1" : "0");
    return res.redirect(dest.toString());
  }

  // Which HCA scope actually carries name/email isn't documented, so say so
  // loudly if a login comes back without them rather than silently falling
  // through to a user_xxxxxxxx placeholder.
  if (!identity.first_name && !identity.primary_email) {
    console.warn(
      "HCA identity missing name and email, granted scopes:",
      me.scopes,
      "fields:",
      Object.keys(identity),
    );
  }
  let fullName = [identity.first_name, identity.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  // HCA doesn't always have a name on file (younger/incomplete accounts) ,
  // fall back to Slack's own directory before resorting to a generated
  // placeholder, since every player is a real Slack workspace member.
  if (!fullName && identity.slack_id) {
    const slackName = await fetchSlackDisplayName(identity.slack_id);
    if (slackName) fullName = slackName;
  }
  const displayNameFromHca =
    fullName ||
    identity.primary_email ||
    `user_${identity.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}`;

  const { data: existingUsers, error: lookupError } = await supabase
    .from("users")
    .select("*")
    .eq("oauth_provider", "hackclub")
    .eq("oauth_id", identity.id)
    .limit(1);

  if (lookupError) {
    console.error("Supabase lookup failed", lookupError);
    return res.status(500).send("Database error");
  }

  let userId: string;
  let displayName: string;
  let isNewUser = false;

  const hcaBirthday = extractBirthday(identity);
  const hcaAddress = extractAddress(identity);

  if (existingUsers && existingUsers.length > 0) {
    const existing = existingUsers[0] as UserRow;
    userId = existing.id;
    displayName = existing.display_name;
    const patch: Record<string, string> = {};
    if (identity.slack_id) patch.slack_id = identity.slack_id;
    if (identity.primary_email) patch.email = identity.primary_email;
    // Keep the real name in sync every login , it's the authoritative identity the
    // dashboard shows, and the player's display_name can drift from it.
    if (fullName) patch.real_name = fullName;
    if (identity.first_name) patch.first_name = identity.first_name;
    if (identity.last_name) patch.last_name = identity.last_name;
    // Birthday/address now come from HCA (the /account self-report form is
    // gone) , keep them in sync every login the same way name/email are.
    if (hcaBirthday) patch.birthday = encryptPII(hcaBirthday);
    if (hcaAddress) {
      patch.address_line1 = encryptPII(hcaAddress.address_line1);
      patch.address_line2 = encryptPII(hcaAddress.address_line2);
      patch.address_city = encryptPII(hcaAddress.address_city);
      patch.address_state = encryptPII(hcaAddress.address_state);
      patch.address_country = encryptPII(hcaAddress.address_country);
      patch.address_postal = encryptPII(hcaAddress.address_postal);
    }
    if (Object.keys(patch).length > 0) {
      void supabase
        .from("users")
        .update(patch)
        .eq("id", userId)
        .then(({ error: e }) => {
          if (e) console.error("Failed to backfill slack_id/email", e);
        });
    }
    if (identity.slack_id && !(existing as { avatar_url?: string | null }).avatar_url)
      void saveSlackAvatar(userId, identity.slack_id);
  } else {
    isNewUser = true;
    const { data: created, error: insertError } = await supabase
      .from("users")
      .insert({
        oauth_provider: "hackclub",
        oauth_id: identity.id,
        display_name: displayNameFromHca,
        real_name: fullName,
        first_name: identity.first_name ?? "",
        last_name: identity.last_name ?? "",
        avatar_url: null,
        slack_id: identity.slack_id ?? null,
        email: identity.primary_email ?? null,
        birthday: hcaBirthday ? encryptPII(hcaBirthday) : null,
        // The address columns are NOT NULL DEFAULT '' , writing null when HCA
        // has no address on file fails the insert and blocks the signup.
        // encryptPII returns "" for a missing value, which is what we want.
        address_line1: encryptPII(hcaAddress?.address_line1),
        address_line2: encryptPII(hcaAddress?.address_line2),
        address_city: encryptPII(hcaAddress?.address_city),
        address_state: encryptPII(hcaAddress?.address_state),
        address_country: encryptPII(hcaAddress?.address_country),
        address_postal: encryptPII(hcaAddress?.address_postal),
      })
      .select()
      .single();

    if (insertError || !created) {
      console.error("Supabase insert failed", insertError);
      return res.status(500).send("Database error");
    }

    const row = created as UserRow;
    userId = row.id;
    displayName = row.display_name;
    if (identity.slack_id) void saveSlackAvatar(userId, identity.slack_id);

    const { error: stateError } = await supabase
      .from("player_state")
      .insert({ user_id: userId });

    if (stateError) {
      console.error("Failed to seed player_state", stateError);
    }
  }

  const ban = await activeBan(userId);
  if (ban) {
    const heading = ban.expires_at
      ? `You've been temporarily banned from Pixl until ${new Date(ban.expires_at).toUTCString()}.`
      : "You've been permanently banned from Pixl.";
    const reason = ban.reason
      ? `<p>Reason: ${ban.reason.replace(/</g, "&lt;")}</p>`
      : "";
    return res
      .status(403)
      .send(
        `<html><body style="font-family:sans-serif;text-align:center;margin-top:4rem;"><h2>${heading}</h2>${reason}<p>If you believe this is a mistake, reach out to the Pixl team.</p></body></html>`,
      );
  }

  // Only a brand-new signup should get auto-invited , an existing player
  // logging back in is already (or deliberately isn't) in the channel.
  if (isNewUser && identity.slack_id) void enrollSlackPlayerInPixl(identity.slack_id);

  const sessionToken = issueSessionToken({ userId, displayName });

  const target = webRedirect ? safeWebRedirect(webRedirect) : null;
  if (webRedirect && !target) {
    return res.status(400).send("Invalid redirect target");
  }

  const localCallback = new URL(target ?? "http://localhost:7777/callback");
  localCallback.searchParams.set("token", sessionToken);
  localCallback.searchParams.set("name", displayName);
  if (isNewUser) localCallback.searchParams.set("new", "1");

  res.redirect(localCallback.toString());
});

export default router;
