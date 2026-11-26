import { sql } from "./pgCompat";
import type { NpsRow } from "./npsMath";

// Every NPS answer, newest first, with a few yes/no facts about the player used
// to split the results. No name, Slack ID or user ID leaves this function: the
// answers are shown without who gave them.
export async function listNpsRows(): Promise<NpsRow[]> {
  const rows = await sql`
    SELECT r.wave, r.score, r.reason, r.fix_text, r.ratings, r.created_at,
      EXISTS (SELECT 1 FROM projects p WHERE p.user_id = r.user_id AND p.status = 'approved') AS has_approved,
      EXISTS (SELECT 1 FROM shop_orders o WHERE o.user_id = r.user_id AND o.status <> 'cancelled') AS has_order,
      (EXISTS (SELECT 1 FROM admins a WHERE a.slack_id = u.slack_id)
        OR EXISTS (SELECT 1 FROM fulfillers f WHERE f.slack_user_id = u.slack_id)
        OR EXISTS (SELECT 1 FROM helpers h WHERE h.slack_user_id = u.slack_id)) AS is_staff
    FROM nps_responses r
    JOIN users u ON u.id = r.user_id
    ORDER BY r.created_at DESC
    LIMIT 5000`;
  return rows.map((r) => {
    const raw = typeof r.ratings === "string" ? safeJson(r.ratings) : r.ratings;
    const ratings: Record<string, number> = {};
    if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "number") ratings[k] = v;
    }
    return {
      wave: String(r.wave),
      score: Number(r.score),
      reason: String(r.reason ?? ""),
      fixText: String(r.fix_text ?? ""),
      ratings,
      createdAt: new Date(r.created_at as string).toISOString(),
      hasApproved: r.has_approved === true,
      hasOrder: r.has_order === true,
      isStaff: r.is_staff === true,
    };
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
