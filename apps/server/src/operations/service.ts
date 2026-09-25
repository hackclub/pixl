import { supabase } from "../db/client.js";
import { config } from "../config.generated.js";
import { fetchTrackedSecondsBetween } from "../hackatime/api.js";
import {
  journalSecondsInWindow,
  playerBlackoutLabel,
  effectiveStatus,
  type EntryStatus,
  type OperationStatus,
  type PlayerBlackoutLabel,
  type RateMode,
} from "./domain.js";

export interface RpcResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  const { data, error } = await supabase.rpc<RpcResult>(fn, args);
  if (error || !data) {
    console.error(`[operations] ${fn} failed`, error?.message);
    return { ok: false, error: "server_error" };
  }
  return data;
}

interface OperationRow {
  id: number;
  slug: string;
  name: string;
  starts_at: string;
  ends_at: string;
  status: OperationStatus;
  rate_usd: string | number;
  rate_mode: RateMode;
  grace_period_hours: number;
}

export async function getOperation(slug: string): Promise<OperationRow | null> {
  const { data } = await supabase.from("operations").select("*").eq("slug", slug).maybeSingle();
  return (data as OperationRow | null) ?? null;
}

export function joinOperation(slug: string, projectId: number, userId: string): Promise<RpcResult> {
  return rpc("operation_join", { p_slug: slug, p_project_id: projectId, p_user_id: userId });
}

export function withdrawFromOperation(
  slug: string,
  projectId: number,
  userId: string,
): Promise<RpcResult> {
  return rpc("operation_withdraw", { p_slug: slug, p_project_id: projectId, p_user_id: userId });
}

interface ShipEntry {
  entry_id: number;
  operation_id: number;
  status: EntryStatus;
  window_start: string;
  window_end: string | null;
  fix_window_end: string | null;
}

interface EvidenceRow {
  user_id: string;
  role: "owner" | "collaborator";
  hackatime_base_s: number;
  journal_base_s: number;
  hackatime_fix_s: number;
  journal_fix_s: number;
  evidence_ok: boolean;
}

const unix = (d: Date) => Math.floor(d.getTime() / 1000);

export async function gatherEvidence(entry: ShipEntry, projectId: number): Promise<EvidenceRow[]> {
  if (!entry.window_end) return [];
  const baseStart = new Date(entry.window_start);
  const baseEnd = new Date(entry.window_end);
  const fixEnd = entry.fix_window_end ? new Date(entry.fix_window_end) : null;
  const hasFix = !!fixEnd && fixEnd.getTime() > baseEnd.getTime();

  const { data: project } = await supabase
    .from("projects")
    .select("user_id, hackatime_projects")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return [];
  const { data: collabs } = await supabase
    .from("project_collaborators")
    .select("user_id, hackatime_projects")
    .eq("project_id", projectId)
    .eq("status", "accepted");

  const people: { userId: string; role: "owner" | "collaborator"; linked: string[] }[] = [
    { userId: project.user_id as string, role: "owner", linked: (project.hackatime_projects as string[]) ?? [] },
    ...((collabs ?? []) as { user_id: string; hackatime_projects: string[] | null }[]).map((c) => ({
      userId: c.user_id,
      role: "collaborator" as const,
      linked: c.hackatime_projects ?? [],
    })),
  ];

  const { data: users } = await supabase
    .from("users")
    .select("id, slack_id, hackatime_token")
    .in("id", people.map((p) => p.userId));
  const userRow = new Map(
    ((users ?? []) as { id: string; slack_id: string | null; hackatime_token: string | null }[]).map(
      (u) => [u.id, u],
    ),
  );
  const { data: journals } = await supabase
    .from("project_journals")
    .select("user_id, hours, created_at")
    .eq("project_id", projectId);
  const allJournals = (journals ?? []) as { user_id: string; hours: number | null; created_at: string }[];

  return Promise.all(
    people.map(async (p) => {
      const u = userRow.get(p.userId);
      const windows = [{ startUnix: unix(baseStart), endUnix: unix(baseEnd) }];
      if (hasFix) windows.push({ startUnix: unix(baseEnd), endUnix: unix(fixEnd!) });
      const ht = await fetchTrackedSecondsBetween(
        u?.slack_id ?? null,
        u?.hackatime_token ?? null,
        p.linked,
        windows,
      );
      const mine = allJournals
        .filter((j) => j.user_id === p.userId)
        .map((j) => ({ hours: j.hours, createdAt: j.created_at }));
      return {
        user_id: p.userId,
        role: p.role,
        hackatime_base_s: ht.seconds[0] ?? 0,
        journal_base_s: journalSecondsInWindow(mine, baseStart, baseEnd),
        hackatime_fix_s: hasFix ? (ht.seconds[1] ?? 0) : 0,
        journal_fix_s: hasFix
          ? journalSecondsInWindow(mine, baseEnd, fixEnd!, { startExclusive: true })
          : 0,
        evidence_ok: ht.ok,
      };
    }),
  );
}

export async function recordShipForOperations(
  projectId: number,
  userId: string,
): Promise<{ ok: boolean; entries: number }> {
  const res = await rpc("operation_record_ship", { p_project_id: projectId, p_user_id: userId });
  if (!res.ok) return { ok: false, entries: 0 };
  const entries = (res.entries as ShipEntry[] | undefined) ?? [];
  for (const entry of entries) {
    if (!entry.window_end || entry.status === "ineligible" || entry.status === "approved") continue;
    try {
      const rows = await gatherEvidence(entry, projectId);
      if (rows.length === 0) continue;
      await rpc("operation_record_evidence", {
        p_entry_id: entry.entry_id,
        p_rows: rows,
      });
    } catch (e) {
      console.error("[operations] evidence failed", (e as Error)?.message ?? e);
    }
  }
  return { ok: true, entries: entries.length };
}

// The authoritative refresh for the review/settlement path: unlike
// recordShipForOperations (only ever triggered by a ship/reship event),
// this recomputes an entry's evidence on demand against the window's live
// upper bound, min(now(), operation.ends_at) - so a project shipped once,
// never reshipped, whose owner kept working right up to Blackout's end,
// still gets full credit for that work. Called from the dashboard's review
// decision action (apps/dashboard/lib/operationsReview.ts) via the
// /api/admin/operations/refresh-evidence route, so it runs on every review
// decision regardless of what the reviewer's browser does - never a
// frontend/manual-resync dependency.
export async function refreshEntryEvidence(
  entryId: number,
): Promise<{ ok: boolean; error?: string }> {
  const { data: row } = await supabase
    .from("operation_entries")
    .select("id, operation_id, project_id, status, window_start, first_qualified_ship_at, fix_window_end")
    .eq("id", entryId)
    .maybeSingle();
  if (!row) return { ok: false, error: "entry_not_found" };
  const entry = row as {
    id: number;
    operation_id: number;
    project_id: number;
    status: EntryStatus;
    window_start: string;
    first_qualified_ship_at: string | null;
    fix_window_end: string | null;
  };
  // Nothing to evaluate before the first ship, and a settled entry is
  // frozen (operation_record_evidence itself also guards per-contributor
  // rows on settled_at, this just avoids the wasted work).
  if (!entry.first_qualified_ship_at) return { ok: false, error: "not_shipped" };
  if (entry.status === "approved") return { ok: true };

  const { data: opRow } = await supabase
    .from("operations")
    .select("ends_at")
    .eq("id", entry.operation_id)
    .maybeSingle();
  if (!opRow) return { ok: false, error: "operation_not_found" };
  const endsAt = new Date((opRow as { ends_at: string }).ends_at);
  const windowEnd = new Date(Math.min(Date.now(), endsAt.getTime()));

  const shipEntry: ShipEntry = {
    entry_id: entry.id,
    operation_id: entry.operation_id,
    status: entry.status,
    window_start: entry.window_start,
    window_end: windowEnd.toISOString(),
    fix_window_end: entry.fix_window_end,
  };
  try {
    const rows = await gatherEvidence(shipEntry, entry.project_id);
    if (rows.length === 0) return { ok: true };
    const res = await rpc("operation_record_evidence", { p_entry_id: entry.id, p_rows: rows });
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  } catch (e) {
    console.error("[operations] refreshEntryEvidence failed", (e as Error)?.message ?? e);
    return { ok: false, error: "evidence_fetch_failed" };
  }
}

export interface PublicOperationView {
  slug: string;
  name: string;
  status: OperationStatus;
  startsAt: string;
  briefingUnlocked: boolean;
  endsAt?: string;
  rateUsd?: number;
  rateMode?: RateMode;
  gracePeriodHours?: number;
  power?: { approvedHours: number; approvedProjects: number; participants: number; powerUnits: number };
}

export async function getPublicOperation(slug: string): Promise<PublicOperationView | null> {
  const op = await getOperation(slug);
  if (!op) return null;
  const status = effectiveStatus({
    status: op.status,
    startsAt: new Date(op.starts_at),
    endsAt: new Date(op.ends_at),
  });
  const base: PublicOperationView = {
    slug: op.slug,
    name: op.name,
    status,
    startsAt: new Date(op.starts_at).toISOString(),
    briefingUnlocked: status !== "upcoming",
  };
  if (status === "upcoming") return base;

  const { data: stats } = await supabase.rpc<{
    entries: { approved: number };
    contributors: { approved_hours: number };
    participants: number;
    power_units: number;
  }>("operation_stats", {
    p_slug: slug,
    p_px_value_usd: config.economy.pixelValueUsd,
    p_base_payout_usd: config.economy.basePayoutUsd,
  });
  return {
    ...base,
    endsAt: new Date(op.ends_at).toISOString(),
    rateUsd: Number(op.rate_usd),
    rateMode: op.rate_mode,
    gracePeriodHours: op.grace_period_hours,
    power: stats
      ? {
          approvedHours: Number(stats.contributors?.approved_hours) || 0,
          approvedProjects: Number(stats.entries?.approved) || 0,
          participants: Number(stats.participants) || 0,
          powerUnits: Number(stats.power_units) || 0,
        }
      : undefined,
  };
}

export interface PlayerEntryView {
  projectId: number;
  label: PlayerBlackoutLabel;
  joinedAt: string;
  firstShipAt: string | null;
  graceDeadline: string | null;
}

export async function listPlayerEntries(slug: string, userId: string): Promise<PlayerEntryView[]> {
  const op = await getOperation(slug);
  if (!op) return [];
  const { data: rows } = await supabase
    .from("operation_entries")
    .select("project_id, status, joined_at, first_qualified_ship_at, grace_deadline, decided_by")
    .eq("operation_id", op.id)
    .eq("user_id", userId);
  const entries = (rows ?? []) as {
    project_id: number;
    status: EntryStatus;
    joined_at: string;
    first_qualified_ship_at: string | null;
    grace_deadline: string | null;
    decided_by: string;
  }[];
  if (entries.length === 0) return [];
  const { data: projects } = await supabase
    .from("projects")
    .select("id, status")
    .in("id", entries.map((e) => Number(e.project_id)));
  const statusOf = new Map(
    ((projects ?? []) as { id: number | string; status: string }[]).map((p) => [Number(p.id), p.status]),
  );
  return entries.map((e) => ({
    projectId: Number(e.project_id),
    label: playerBlackoutLabel(e.status, statusOf.get(Number(e.project_id)) ?? "draft", {
      systemDecided: e.decided_by === "system",
    }),
    joinedAt: e.joined_at,
    firstShipAt: e.first_qualified_ship_at,
    graceDeadline: e.status === "needs_changes" ? e.grace_deadline : null,
  }));
}
