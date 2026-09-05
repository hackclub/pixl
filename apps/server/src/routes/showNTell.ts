import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";

const router = Router();

// The Show & Tell voting page: one open round at a time (see the partial
// unique index on show_n_tell_rounds.is_open), CT members add existing
// shipped projects as entries from the dashboard, and any signed-in player
// can upvote as many entries as they like - once each, enforced by the
// unique (entry_id, user_id) constraint rather than trusting the client.
// Browsable signed out (same pattern as the shop catalog), voting requires
// a session.
router.get("/api/show-n-tell", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;

  const { data: round } = await supabase
    .from("show_n_tell_rounds")
    .select("id, title, opened_at")
    .eq("is_open", true)
    .maybeSingle();

  if (!round) return res.json({ ok: true, round: null, entries: [] });

  // pgCompat only supports one level of embedded relation select (see its
  // own header comment) - projects(...users(...)) would be two levels deep,
  // so the owner name is fetched separately below instead of nesting.
  const { data: entries, error } = await supabase
    .from("show_n_tell_entries")
    .select("id, project_id, projects(name, description, image_url, user_id)")
    .eq("round_id", round.id);
  if (error) {
    console.error("[show-n-tell] entries fetch failed", error);
    return res.status(500).json({ ok: false });
  }

  const entryIds = (entries ?? []).map((e) => e.id as number);
  const counts = new Map<number, number>();
  const mine = new Set<number>();
  if (entryIds.length > 0) {
    const { data: votes } = await supabase
      .from("show_n_tell_votes")
      .select("entry_id, user_id")
      .in("entry_id", entryIds);
    for (const v of votes ?? []) {
      const eid = v.entry_id as number;
      counts.set(eid, (counts.get(eid) ?? 0) + 1);
      if (session && v.user_id === session.userId) mine.add(eid);
    }
  }

  const ownerIds = [
    ...new Set(
      (entries ?? [])
        .map((e) => (e.projects as { user_id?: string } | null)?.user_id)
        .filter((id): id is string => !!id),
    ),
  ];
  const ownerName = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: owners } = await supabase
      .from("users")
      .select("id, display_name")
      .in("id", ownerIds);
    for (const u of owners ?? []) ownerName.set(u.id as string, (u.display_name as string) ?? "");
  }

  const result = (entries ?? [])
    .map((e) => {
      const p = e.projects as {
        name?: string;
        description?: string;
        image_url?: string;
        user_id?: string;
      } | null;
      return {
        id: e.id as number,
        projectId: e.project_id as number,
        name: p?.name ?? "",
        description: p?.description ?? "",
        imageUrl: p?.image_url ?? "",
        ownerName: (p?.user_id && ownerName.get(p.user_id)) || "",
        voteCount: counts.get(e.id as number) ?? 0,
        votedByMe: mine.has(e.id as number),
      };
    })
    .sort((a, b) => b.voteCount - a.voteCount);

  res.json({
    ok: true,
    round: { id: round.id, title: round.title, openedAt: round.opened_at },
    entries: result,
  });
});

// Toggle an upvote on/off - voting again removes it. One vote per (entry,
// user) is enforced by the DB unique constraint, this just decides insert
// vs delete based on current state rather than trusting a client flag.
router.post("/api/show-n-tell/entries/:id/vote", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const entryId = Number(req.params.id);
  if (!Number.isFinite(entryId)) return res.status(400).json({ ok: false });

  const { data: entry } = await supabase
    .from("show_n_tell_entries")
    .select("id, round_id, show_n_tell_rounds(is_open)")
    .eq("id", entryId)
    .maybeSingle();
  const roundOpen = !!(entry as { show_n_tell_rounds?: { is_open?: boolean } } | null)
    ?.show_n_tell_rounds?.is_open;
  if (!entry || !roundOpen)
    return res.status(400).json({ ok: false, error: "round_closed" });

  const { data: existing } = await supabase
    .from("show_n_tell_votes")
    .select("id")
    .eq("entry_id", entryId)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from("show_n_tell_votes").delete().eq("id", existing.id);
    if (error) return res.status(500).json({ ok: false });
    return res.json({ ok: true, voted: false });
  }

  const { error } = await supabase
    .from("show_n_tell_votes")
    .insert({ entry_id: entryId, user_id: session.userId });
  if (error) {
    console.error("[show-n-tell] vote insert failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true, voted: true });
});

export default router;
