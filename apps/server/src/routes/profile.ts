import { Router } from "express";
import { issueSessionToken } from "../auth/session.js";
import { containsBlocked, logViolation } from "../moderation.js";
import { db } from "../db/client.js";
import {
  approvedHoursFor,
  lifetimeRe,
  levelForRe,
  payoutUsdPerHour,
  pxPerHourFor,
  reForLevel,
  MAX_LEVEL,
} from "../xp.js";
import { decryptPII } from "../crypto.js";
import { beaconUnlocks } from "../beacons.js";
import { allowedImageUrl } from "../http/imageUrls.js";
import { z } from "zod";
import { validate, v, optStr, optBool, optNum } from "../http/validate.js";

const router = Router();

// Returns a human-readable rejection reason, or null when the name is fine.
export function nameProblem(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 2) return "That name is too short, use at least 2 characters.";
  if (name.length > 24) return "That name is too long, keep it under 24 characters.";
  if (!/^[\p{L}\p{N} ._'-]+$/u.test(name))
    return "Only letters, numbers, spaces and . _ ' - are allowed.";
  if (containsBlocked(name))
    return "That name isn't okay here. Pick something friendly: this is a warning.";
  return null;
}

router.post("/api/profile/name", validate({ query: v.noQuery, body: z.object({ name: optStr(200) }) }), async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false, reason: "Not signed in." });

  const raw = typeof req.body?.name === "string" ? req.body.name : "";
  const name = raw.trim().replace(/\s+/g, " ");
  const problem = nameProblem(name);
  if (problem) {
    if (containsBlocked(name)) logViolation(session.userId, "name", name);
    return res.json({ ok: false, reason: problem });
  }

  const { error } = await db
    .from("users")
    .update({ display_name: name })
    .eq("id", session.userId);
  if (error) {
    console.error("Failed to update display_name", error);
    return res.status(500).json({ ok: false, reason: "Database error." });
  }

  // The game shows the name embedded in its token (the WebSocket reads it
  // from there), so a real change re-issues the token for the same client -
  // but only on a change, and ending exactly when the old one would have:
  // renaming must never be a way to keep a session alive past its 14 days.
  // It also keeps the old token's iat: a fresh one would let a token
  // re-issued just after a revocation (while the revocation lookup is still
  // cached as "not revoked") outlive that revocation.
  if (name === session.displayName || session.exp === undefined || !session.iat) return res.json({ ok: true, name });
  const fresh = issueSessionToken(
    {
      userId: session.userId,
      displayName: name,
      client: session.client,
      ...(session.slackId ? { slackId: session.slackId } : {}),
    },
    { expiresAtSec: session.exp, issuedAtSec: session.iat },
  );
  res.json({ ok: true, name, token: fresh });
});

// Read-only wallet: current pixel balance and lifetime approved hours. Pixels
// are only ever changed server-side (by the dashboard on final approval), so
// the game just displays whatever this returns.
router.get("/api/profile/wallet", async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });

  const [{ data: user }, approvedHours, re, beacons] = await Promise.all([
    db.from("users").select("pixels").eq("id", session.userId).single(),
    approvedHoursFor(session.userId),
    lifetimeRe(session.userId),
    beaconUnlocks(session.userId),
  ]);
  const pixels = Math.round(Number(user?.pixels) || 0);
  // Beacon projects earn one Beacon-locked shop unlock each. Sent separately
  // from the shop catalog so the dashboard can show the count even when the
  // player's region has no Beacon-locked items listed.
  const beaconProjects = beacons.projects;
  const beaconUnlocksLeft = beacons.available;
  // Both are sent: hours is the raw work, RE is that work weighted by the tier
  // it was shipped at, and RE is what the level and the rate come from.
  res.json({
    ok: true,
    pixels,
    approvedHours,
    re,
    level: levelForRe(re),
    maxLevel: MAX_LEVEL,
    // Where the current level started and where the next one starts, so a
    // client can draw progress without re-implementing the level bands.
    reForCurrentLevel: reForLevel(levelForRe(re)),
    reForNextLevel: reForLevel(Math.min(levelForRe(re) + 1, MAX_LEVEL)),
    pxPerHour: pxPerHourFor(re),
    usdPerHour: payoutUsdPerHour(re),
    beaconProjects,
    beaconUnlocks: beaconUnlocksLeft,
    beaconSpent: Math.max(beaconProjects - beaconUnlocksLeft, 0),
  });
});

// Coding-experience answer Pixo asks for during arrival. Drives the starter-
// Trial recommendation (sidequests.ts) and how much the web first-project
// walkthrough explains. null = never asked. See drizzle/0050.
const EXPERIENCE_VALUES = ["beginner", "intermediate", "advanced"] as const;
type Experience = (typeof EXPERIENCE_VALUES)[number];

router.get("/api/profile/experience", async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });

  const { data, error } = await db
    .from("users")
    .select("coding_experience")
    .eq("id", session.userId)
    .maybeSingle();
  // Before 0050 the column doesn't exist, treat as "not asked yet".
  const raw = error ? null : (data?.coding_experience ?? null);
  const experience = EXPERIENCE_VALUES.includes(raw as Experience)
    ? (raw as Experience)
    : null;
  res.json({ ok: true, experience });
});

router.post("/api/profile/experience", validate({ query: v.noQuery, body: z.object({ experience: optStr(64) }) }), async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });

  const value = typeof req.body?.experience === "string" ? req.body.experience : "";
  if (!EXPERIENCE_VALUES.includes(value as Experience))
    return res.status(400).json({ ok: false, error: "bad_experience" });

  const { error } = await db
    .from("users")
    .update({ coding_experience: value })
    .eq("id", session.userId);
  if (error) {
    console.error("[profile] experience update failed", error.message);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true, experience: value });
});

// The player's own pixel ledger, newest first, with project names attached.
router.get("/api/profile/transactions", async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });

  const { data, error } = await db
    .from("pixel_transactions")
    .select("id, project_id, amount, hours, reason, created_at")
    .eq("user_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("[profile] transactions failed", error);
    return res.status(500).json({ ok: false });
  }
  const rows = data ?? [];
  const projectIds = [
    ...new Set(rows.map((t) => t.project_id).filter((x): x is number => x != null)),
  ];
  const names = new Map<number, string>();
  if (projectIds.length > 0) {
    const { data: projects } = await db
      .from("projects")
      .select("id, name")
      .in("id", projectIds);
    for (const p of projects ?? []) names.set(p.id as number, p.name as string);
  }
  res.json({
    ok: true,
    transactions: rows.map((t) => ({
      id: t.id,
      amount: Math.round(Number(t.amount) || 0),
      reason: t.reason,
      project: t.project_id != null ? (names.get(t.project_id as number) ?? "") : "",
      created_at: t.created_at,
    })),
  });
});

// Player-card photo settings. The photo itself goes through /api/uploads
// (or comes from Slack at sign-up); these just point the card at it.
router.get("/api/profile/card", async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });

  let { data: user, error } = await db
    .from("users")
    .select("avatar_url, card_pixelate")
    .eq("id", session.userId)
    .maybeSingle();
  if (error)
    ({ data: user } = (await db
      .from("users")
      .select("avatar_url")
      .eq("id", session.userId)
      .maybeSingle()) as { data: typeof user });
  res.json({
    ok: true,
    avatar_url: user?.avatar_url ?? "",
    pixelate: user?.card_pixelate ?? true,
  });
});

router.post("/api/profile/card-image", validate({ query: v.noQuery, body: z.object({ url: optStr(2000) }) }), async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });

  // Rendered on other players' pages, so only a Hack Club CDN upload or the
  // Slack photo the card was seeded with (http/imageUrls.ts): an arbitrary
  // host would log the IP of every player who views this card.
  const url = allowedImageUrl(req.body?.url, { avatar: true });
  if (!url) return res.status(400).json({ ok: false, error: "invalid_image_url" });
  const { error } = await db
    .from("users")
    .update({ avatar_url: url })
    .eq("id", session.userId);
  if (error) {
    console.error("[profile] card image update failed", error.message);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true });
});

// Cross-app onboarding progress, a single forward-only counter shared by the
// in-game first-run guide (apps/game/scripts/guide_hud.gd) and the web dashboard
// tour (apps/game/web/pixl.js) so they hand off to each other rather than
// running as two separate walkthroughs. 0 = new, 1 = game intro done (dashboard
// tour pending), 2 = fully onboarded.
const ONBOARDING_DONE = 2;

// Rollout gate: while the redesigned arrival flow was being tested, only these
// Slack IDs got it. Everyone else read as fully onboarded so neither the game
// nor the dashboard ran it. Empty set = allow everyone, flipped for launch.
// Both apps gate on this one endpoint, so this keeps the game and the
// dashboard in sync automatically.
const ONBOARDING_ALLOWLIST = new Set<string>([]);

router.get("/api/profile/onboarding", async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });

  const { data, error } = await db
    .from("users")
    .select("onboarding_step, slack_id")
    .eq("id", session.userId)
    .maybeSingle();

  // Not on the allowlist → report fully onboarded so onboarding never triggers.
  if (
    ONBOARDING_ALLOWLIST.size > 0 &&
    !ONBOARDING_ALLOWLIST.has(String(data?.slack_id ?? ""))
  ) {
    return res.json({ ok: true, step: ONBOARDING_DONE, done: true });
  }

  // Before the 0046 migration is applied the column doesn't exist, treat that
  // as "brand new" rather than failing the request.
  const step = error ? 0 : Math.max(0, Number(data?.onboarding_step) || 0);
  res.json({ ok: true, step, done: step >= ONBOARDING_DONE });
});

router.post("/api/profile/onboarding", validate({ query: v.noQuery, body: z.object({ step: optNum }) }), async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });

  const raw = Number(req.body?.step);
  if (!Number.isFinite(raw)) return res.status(400).json({ ok: false, error: "bad_step" });
  const want = Math.max(0, Math.min(ONBOARDING_DONE, Math.round(raw)));

  // Forward-only: a stale client (older tab, a replay) must never rewind a
  // player who's already further along.
  const { data: cur } = await db
    .from("users")
    .select("onboarding_step")
    .eq("id", session.userId)
    .maybeSingle();
  const step = Math.max(Math.max(0, Number(cur?.onboarding_step) || 0), want);

  const { error } = await db
    .from("users")
    .update({ onboarding_step: step })
    .eq("id", session.userId);
  if (error) {
    console.error("[profile] onboarding update failed", error.message);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true, step, done: step >= ONBOARDING_DONE });
});

router.post("/api/profile/card-pixelate", validate({ query: v.noQuery, body: z.object({ pixelate: optBool }) }), async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });

  const pixelate = req.body?.pixelate === true;
  const { error } = await db
    .from("users")
    .update({ card_pixelate: pixelate })
    .eq("id", session.userId);
  if (error) {
    console.error("[profile] card pixelate update failed", error.message);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true });
});

// Birthday + mailing address now come from Hack Club Auth at login (see
// src/routes/auth.ts's extractBirthday/extractAddress) rather than a
// self-report form, self-reporting a birthday would defeat the point of
// using it for the YSWS age-eligibility check below, so there's no write
// path for either field here anymore.
const ADDRESS_FIELDS = [
  "address_line1",
  "address_line2",
  "address_city",
  "address_state",
  "address_country",
  "address_postal",
] as const;

function hasAddress(row: Record<string, unknown>): boolean {
  return (
    String(row.address_line1 ?? "").trim() !== "" &&
    String(row.address_city ?? "").trim() !== "" &&
    String(row.address_country ?? "").trim() !== "" &&
    String(row.address_postal ?? "").trim() !== ""
  );
}

// Hack Club's YSWS programs are for under-19s. Matches the age math the
// dashboard's turnedNineteenSinceShipping already uses (lib/db.ts).
function ageOn(birthday: Date, at: Date): number {
  let age = at.getFullYear() - birthday.getFullYear();
  const m = at.getMonth() - birthday.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < birthday.getDate())) age--;
  return age;
}

router.get("/api/profile/eligibility", async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });

  const { data, error } = await db
    .from("users")
    .select(["birthday", ...ADDRESS_FIELDS, "phone"].join(", "))
    .eq("id", session.userId)
    .maybeSingle();
  if (error) {
    console.error("[profile] eligibility fetch failed", error.message);
    return res.status(500).json({ ok: false });
  }
  const row = (data ?? {}) as Record<string, unknown>;
  const birthday = decryptPII(row.birthday as string | null);
  let age: number | null = null;
  let yswsEligible = true;
  if (birthday) {
    const bday = new Date(birthday);
    if (!Number.isNaN(bday.getTime())) {
      age = ageOn(bday, new Date());
      yswsEligible = age < 19;
    }
  }
  res.json({ ok: true, birthday: birthday || null, age, yswsEligible, ...maskedAddress(row) });
});

// The street lines, postal code and phone never leave the server: a stolen
// session (or a mis-bound HCA flow) must not be enough to read a minor's
// home address. The Pixl Dashboard only shows city + country as a "this is
// roughly where we'd ship" hint, plus two flags for the checkout gate.
export function maskedAddress(row: Record<string, unknown>) {
  return {
    addressCity: decryptPII(row.address_city as string | null),
    addressCountry: decryptPII(row.address_country as string | null),
    hasAddress: hasAddress(row),
    hasPhone: String(decryptPII(row.phone as string | null) ?? "").trim() !== "",
  };
}

export default router;
