"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/guard";
import { BLACKOUT_SLUG, operationRpc } from "@/lib/operations";

const ERRORS: Record<string, string> = {
  operation_not_found: "That operation doesn't exist.",
  operation_ended: "That operation has already ended.",
  not_paused: "It isn't paused.",
  must_extend_later: "The new end has to be later than the current end.",
  would_cut_shipped_entries:
    "That would cut off entries that already shipped, pick a later end (or use End now).",
  start_locked: "The start can't move once the operation has begun or anyone has joined.",
  ends_before_start: "The end has to be after the start.",
  invalid_settings: "Rate and grace period must be 0 or more.",
  slug_taken: "An operation with that slug already exists.",
  unknown_action: "Unknown action.",
  server_error: "Something went wrong.",
};

function parseUtc(raw: FormDataEntryValue | null): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const withSeconds = /T\d\d:\d\d$/.test(s) ? `${s}:00` : s;
  const d = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(withSeconds) ? withSeconds : `${withSeconds}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function actor(access: Awaited<ReturnType<typeof requirePerm>>): string {
  return `${access.session.name} (${access.session.slackId})`;
}

function back(slug: string, msg: { ok?: string; error?: string }): never {
  const q = new URLSearchParams();
  if (slug !== BLACKOUT_SLUG) q.set("slug", slug);
  if (msg.ok) q.set("ok", msg.ok);
  if (msg.error) q.set("error", msg.error);
  const qs = q.toString();
  redirect(`/operations${qs ? `?${qs}` : ""}`);
}

export async function createOperation(formData: FormData): Promise<void> {
  const access = await requirePerm("operations");
  const slug = String(formData.get("slug") ?? "").trim() || BLACKOUT_SLUG;
  const name = String(formData.get("name") ?? "").trim();
  const startsAt = parseUtc(formData.get("startsAt"));
  const endsAt = parseUtc(formData.get("endsAt"));
  const rateUsd = Number(formData.get("rateUsd") ?? 5);
  const graceHours = Math.trunc(Number(formData.get("graceHours") ?? 72));
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) back(slug, { error: "Slug must be lowercase letters, numbers and dashes." });
  if (!name) back(slug, { error: "Give the operation a name." });
  if (!startsAt || !endsAt) back(slug, { error: "Start and end are required." });
  if (!Number.isFinite(rateUsd) || !Number.isFinite(graceHours))
    back(slug, { error: ERRORS.invalid_settings });
  const res = await operationRpc.create({
    slug, name, startsAt: startsAt!, endsAt: endsAt!, rateUsd, graceHours, by: actor(access),
  });
  if (!res.ok) back(slug, { error: ERRORS[String(res.error)] ?? "Couldn't create it." });
  revalidatePath("/operations");
  back(slug, { ok: "Operation created. It opens for entries at its start time." });
}

export async function operationControl(formData: FormData): Promise<void> {
  const access = await requirePerm("operations");
  const slug = String(formData.get("slug") ?? BLACKOUT_SLUG);
  const action = String(formData.get("action") ?? "");
  if (!["pause", "resume", "extend", "end", "edit"].includes(action))
    back(slug, { error: ERRORS.unknown_action });

  if (action === "end" && formData.get("confirmEnd") !== "1")
    back(slug, { error: "Tick the confirmation box to end the operation." });

  const endsAt = parseUtc(formData.get("endsAt"));
  if (action === "extend" && !endsAt) back(slug, { error: "Pick the new end time." });

  const rate = String(formData.get("rateUsd") ?? "").trim();
  const grace = String(formData.get("graceHours") ?? "").trim();
  const res = await operationRpc.adminUpdate({
    slug,
    action: action as "pause" | "resume" | "extend" | "end" | "edit",
    by: actor(access),
    endsAt: action === "extend" || action === "edit" ? endsAt : null,
    startsAt: action === "edit" ? parseUtc(formData.get("startsAt")) : null,
    name: action === "edit" ? String(formData.get("name") ?? "").trim() || null : null,
    rateUsd: action === "edit" && rate !== "" ? Number(rate) : null,
    graceHours: action === "edit" && grace !== "" ? Math.trunc(Number(grace)) : null,
    note: String(formData.get("note") ?? "").trim(),
  });
  if (!res.ok) back(slug, { error: ERRORS[String(res.error)] ?? "Couldn't apply that change." });
  revalidatePath("/operations");
  back(slug, {
    ok:
      action === "pause" ? "Paused: no new entries. Entered projects can still ship."
      : action === "resume" ? "Resumed."
      : action === "extend" ? "End extended. Existing entries keep their recorded timestamps."
      : action === "end" ? "Operation ended. Entries that already shipped are still reviewed and paid."
      : "Saved. Rate and grace changes only apply to entries created from now on.",
  });
}
