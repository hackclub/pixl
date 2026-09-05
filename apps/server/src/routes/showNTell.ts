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

  // Which of these projects the signed-in viewer collaborates on (accepted
  // only) - combined with the owner check below to flag entries they can't
  // vote for, same rule the vote endpoint enforces server-side.
  const myCollabProjectIds = new Set<number>();
  if (session && entryIds.length > 0) {
    const { data: collabRows } = await supabase
      .from("project_collaborators")
      .select("project_id")
      .in(
        "project_id",
        (entries ?? []).map((e) => e.project_id as number),
      )
      .eq("user_id", session.userId)
      .eq("status", "accepted");
    for (const c of collabRows ?? []) myCollabProjectIds.add(c.project_id as number);
  }

  const result = (entries ?? [])
    .map((e) => {
      const p = e.projects as {
        name?: string;
        description?: string;
        image_url?: string;
        user_id?: string;
      } | null;
      const projectId = e.project_id as number;
      return {
        id: e.id as number,
        projectId,
        name: p?.name ?? "",
        description: p?.description ?? "",
        imageUrl: p?.image_url ?? "",
        ownerName: (p?.user_id && ownerName.get(p.user_id)) || "",
        voteCount: counts.get(e.id as number) ?? 0,
        votedByMe: mine.has(e.id as number),
        isOwn: !!session && (p?.user_id === session.userId || myCollabProjectIds.has(projectId)),
      };
    })
    .sort((a, b) => b.voteCount - a.voteCount);

  res.json({
    ok: true,
    round: { id: round.id, title: round.title, openedAt: round.opened_at },
    entries: result,
  });
});

// Toggle an upvote on/off - voting again on the SAME entry removes it.
// Voting on a DIFFERENT entry in the same round moves the vote there instead
// of stacking (one live vote per round, per user), and voting for your own
// entry (owner or an accepted collaborator) is rejected outright.
router.post("/api/show-n-tell/entries/:id/vote", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const entryId = Number(req.params.id);
  if (!Number.isFinite(entryId)) return res.status(400).json({ ok: false });

  // pgCompat resolves an embedded relation's FK by singularizing the related
  // TABLE name ("show_n_tell_rounds" -> "show_n_tell_round_id"), which doesn't
  // match this table's actual column (round_id) - that embed silently errors
  // (never checked below) and made every vote fail with round_closed. Two
  // plain queries instead, same workaround already used in the GET handler
  // above for the same reason.
  const { data: entry } = await supabase
    .from("show_n_tell_entries")
    .select("id, round_id, project_id")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) return res.status(400).json({ ok: false, error: "round_closed" });
  const { data: round } = await supabase
    .from("show_n_tell_rounds")
    .select("is_open")
    .eq("id", entry.round_id as number)
    .maybeSingle();
  if (!round?.is_open) return res.status(400).json({ ok: false, error: "round_closed" });

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

  // Can't upvote your own entry - checks both the project owner and any
  // accepted collaborator on it.
  const { data: project } = await supabase
    .from("projects")
    .select("user_id")
    .eq("id", entry.project_id as number)
    .maybeSingle();
  if (project?.user_id === session.userId)
    return res.status(400).json({ ok: false, error: "own_project" });
  const { data: collab } = await supabase
    .from("project_collaborators")
    .select("id")
    .eq("project_id", entry.project_id as number)
    .eq("user_id", session.userId)
    .eq("status", "accepted")
    .maybeSingle();
  if (collab) return res.status(400).json({ ok: false, error: "own_project" });

  // Only one live vote per round, per user - drop any existing vote this
  // user has on another entry in the same round before adding the new one.
  const { data: roundEntries } = await supabase
    .from("show_n_tell_entries")
    .select("id")
    .eq("round_id", entry.round_id as number);
  const roundEntryIds = (roundEntries ?? []).map((e) => e.id as number);
  if (roundEntryIds.length > 0) {
    const { error: clearError } = await supabase
      .from("show_n_tell_votes")
      .delete()
      .eq("user_id", session.userId)
      .in("entry_id", roundEntryIds);
    if (clearError) {
      console.error("[show-n-tell] clearing prior round vote failed", clearError);
      return res.status(500).json({ ok: false });
    }
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
