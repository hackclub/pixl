import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";
import { communityEnergy, topChapterContributors } from "../xp.js";
import { addNotification } from "./notifications.js";

const router = Router();

interface VaultReward {
  icon?: string;
  label?: string;
}

interface VaultLevelRow {
  id: number;
  level: number;
  energy_required: number;
  title: string;
  blurb: string;
  rewards: unknown;
  position: number;
  unlocked_at: string | null;
  top1_re: number;
  top2_re: number;
  top3_re: number;
}

const CHAPTER_LEADERBOARD_SIZE = 10;

// Whoever contributed the most RE toward a chapter's Vault goal gets a flat
// RE bonus once that chapter's level unlocks - top1_re/top2_re/top3_re on the
// row, credited once via vault_chapter_awards (unique per level+rank and per
// level+user, so a retry can't double-pay). See drizzle/0146.
async function settleChapterAward(level: VaultLevelRow, windowStart: Date | null) {
  const totalReward = level.top1_re + level.top2_re + level.top3_re;
  if (totalReward <= 0) {
    // Nothing to award, but still mark the chapter closed so its window ends.
    await supabase
      .from("vault_levels")
      .update({ unlocked_at: new Date().toISOString() })
      .eq("id", level.id)
      .is("unlocked_at", null);
    return;
  }

  const top = await topChapterContributors(windowStart, 3);
  const rewardByRank = [level.top1_re, level.top2_re, level.top3_re];

  // Claim the level first (only if still unclaimed) so two concurrent
  // requests can't both compute a leaderboard and try to award it twice.
  const { data: claimed } = await supabase
    .from("vault_levels")
    .update({ unlocked_at: new Date().toISOString() })
    .eq("id", level.id)
    .is("unlocked_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return;

  for (let i = 0; i < top.length; i++) {
    const { userId } = top[i];
    const reAwarded = rewardByRank[i];
    if (!reAwarded) continue;
    const { error } = await supabase.from("vault_chapter_awards").insert({
      vault_level_id: level.id,
      user_id: userId,
      award_rank: i + 1,
      re_awarded: reAwarded,
    });
    if (error) {
      console.error("[vault] chapter award insert failed", error);
      continue;
    }
    await addNotification(
      userId,
      "Vault chapter reward",
      `You shipped the most Restoration Energy toward "${level.title}" this chapter (#${i + 1}). +${reAwarded} bonus RE.`,
    );
  }
}

async function displayInfoFor(userIds: string[]): Promise<Map<string, { displayName: string; avatarUrl: string | null }>> {
  const out = new Map<string, { displayName: string; avatarUrl: string | null }>();
  if (userIds.length === 0) return out;
  const { data } = await supabase
    .from("users")
    .select("id, display_name, avatar_url")
    .in("id", userIds);
  for (const u of data ?? [])
    out.set(u.id as string, {
      displayName: String(u.display_name ?? "Someone"),
      avatarUrl: (u.avatar_url as string | null) ?? null,
    });
  return out;
}

// The Core Vault: the community's pooled Restoration Energy recovers vault
// levels for everyone. A level unlocks once the total energy crosses its
// threshold, the rewards are equipment the Core has finally recovered, plus
// a bonus RE prize for whoever contributed the most to that chapter.
router.get("/api/vault", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const [energy, { data: rows }] = await Promise.all([
    communityEnergy(),
    supabase
      .from("vault_levels")
      .select("id, level, energy_required, title, blurb, rewards, position, unlocked_at, top1_re, top2_re, top3_re")
      .eq("active", true)
      .order("position", { ascending: true })
      .order("level", { ascending: true }),
  ]);

  const rawLevels = (rows ?? []) as VaultLevelRow[];

  // A level is "unlocked" once community energy has crossed its threshold.
  // The first time that's true for a level that hasn't recorded its winners
  // yet, settle the chapter award before responding, same lazy-on-read
  // pattern referral codes use for assignment.
  let windowStart: Date | null = null;
  for (const level of rawLevels) {
    const unlocked = energy >= Number(level.energy_required);
    if (unlocked && !level.unlocked_at) {
      await settleChapterAward(level, windowStart);
      level.unlocked_at = new Date().toISOString();
    }
    windowStart = level.unlocked_at ? new Date(level.unlocked_at) : windowStart;
  }

  const winnerIds = rawLevels.filter((l) => l.unlocked_at).map((l) => l.id);
  const { data: allAwards } = winnerIds.length
    ? await supabase
        .from("vault_chapter_awards")
        .select("vault_level_id, user_id, award_rank, re_awarded")
        .in("vault_level_id", winnerIds)
    : { data: [] as { vault_level_id: number; user_id: string; award_rank: number; re_awarded: number }[] };
  const awardsByLevel = new Map<number, { user_id: string; award_rank: number; re_awarded: number }[]>();
  for (const a of allAwards ?? []) {
    const list = awardsByLevel.get(a.vault_level_id as number) ?? [];
    list.push(a as { user_id: string; award_rank: number; re_awarded: number });
    awardsByLevel.set(a.vault_level_id as number, list);
  }

  // The chapter currently in progress: the first not-yet-unlocked level. Its
  // window opened when the previous level unlocked (or the beginning, for
  // the very first chapter). Show a live leaderboard for it so players can
  // see the race before it closes.
  let openWindowStart: Date | null = null;
  let openLevelId: number | null = null;
  for (const level of rawLevels) {
    if (!level.unlocked_at) {
      openLevelId = level.id;
      break;
    }
    openWindowStart = new Date(level.unlocked_at);
  }
  const liveTop = openLevelId
    ? await topChapterContributors(openWindowStart, CHAPTER_LEADERBOARD_SIZE)
    : [];

  const allUserIds = [
    ...liveTop.map((t) => t.userId),
    ...[...awardsByLevel.values()].flat().map((a) => a.user_id),
  ];
  const displayInfo = await displayInfoFor([...new Set(allUserIds)]);

  const chapterLeaderboard = liveTop.map((t) => ({
    userId: t.userId,
    displayName: displayInfo.get(t.userId)?.displayName ?? "Someone",
    avatarUrl: displayInfo.get(t.userId)?.avatarUrl ?? null,
    re: t.re,
  }));

  const levels = rawLevels.map((l) => ({
    level: Number(l.level),
    title: String(l.title ?? ""),
    blurb: String(l.blurb ?? ""),
    energyRequired: Number(l.energy_required),
    rewards: (Array.isArray(l.rewards) ? l.rewards : []) as VaultReward[],
    unlocked: Boolean(l.unlocked_at),
    topReward: { first: l.top1_re, second: l.top2_re, third: l.top3_re },
    winners: (awardsByLevel.get(l.id) ?? [])
      .sort((a, b) => a.award_rank - b.award_rank)
      .map((a) => ({
        rank: a.award_rank,
        userId: a.user_id,
        displayName: displayInfo.get(a.user_id)?.displayName ?? "Someone",
        avatarUrl: displayInfo.get(a.user_id)?.avatarUrl ?? null,
        re: a.re_awarded,
      })),
  }));

  const currentLevel = levels.reduce((m, l) => (l.unlocked ? Math.max(m, l.level) : m), 0);
  const next = levels.find((l) => !l.unlocked) ?? null;

  res.json({
    ok: true,
    energy,
    currentLevel,
    nextRequired: next ? next.energyRequired : null,
    levels,
    chapterLeaderboard,
  });
});

export default router;
