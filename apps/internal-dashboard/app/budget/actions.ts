"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { guardedAction } from "@/lib/guard";
import { getLiveMode } from "@/lib/liveModeServer";
import { sql } from "@/lib/pgCompat";
import { createBudgetEntry, voidBudgetEntry } from "@/lib/budget";
import { BUDGET_CATEGORIES, parseUsdToCents, type BudgetCategory, type Direction, type EntryState } from "@/lib/budgetMath";

function back(message: { ok?: string; error?: string }): never {
  const q = new URLSearchParams();
  if (message.ok) q.set("ok", message.ok);
  if (message.error) q.set("error", message.error);
  redirect(`/budget?${q.toString()}`);
}

async function requireLedger(): Promise<void> {
  const r = await sql<{ available: boolean }[]>`SELECT to_regclass('public.budget_entries') IS NOT NULL AS available`;
  if (!r[0]?.available) back({ error: "The Budget ledger migration hasn't been approved or applied yet." });
  if (await getLiveMode()) back({ error: "Turn Live mode off to edit the private budget ledger." });
}

function validDate(raw: string, allowFuture: boolean): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const d = new Date(raw + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().startsWith(raw) && (allowFuture || d <= new Date());
}

export const addBudgetEntry = guardedAction("budget.add", "owner", async (access, formData: FormData): Promise<void> => {
  await requireLedger();
  const direction = String(formData.get("direction") ?? "") as Direction;
  const category = String(formData.get("category") ?? "") as BudgetCategory;
  const state = String(formData.get("state") ?? "") as EntryState;
  const amountCents = parseUsdToCents(String(formData.get("amountUsd") ?? ""));
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const evidenceUrl = String(formData.get("evidenceUrl") ?? "").trim();
  const occurredOn = String(formData.get("occurredOn") ?? "").trim();

  if (!BUDGET_CATEGORIES[category] || BUDGET_CATEGORIES[category].direction !== direction)
    back({ error: "Choose a valid income or expense category." });
  if (state !== "settled" && state !== "planned") back({ error: "Choose recorded or planned." });
  if (amountCents === null) back({ error: "Enter a positive USD amount with at most two decimals." });
  if (title.length < 3 || title.length > 140) back({ error: "Description title must be 3–140 characters." });
  if (description.length > 2000) back({ error: "Notes must be 2,000 characters or fewer." });
  if (!validDate(occurredOn, state === "planned")) back({ error: "Enter a valid date. Future dates are only allowed for planned transactions." });
  if (evidenceUrl.length > 500) back({ error: "Evidence link is too long." });
  if (evidenceUrl) {
    try {
      const url = new URL(evidenceUrl);
      if (!["https:", "http:"].includes(url.protocol)) back({ error: "Evidence link must use HTTPS or HTTP." });
    } catch {
      back({ error: "Evidence link must be a valid URL." });
    }
  }
  await createBudgetEntry({
    direction, category, state, amountCents: amountCents!, title,
    description, evidenceUrl, occurredOn, createdBy: access.session.slackId,
  });
  revalidatePath("/budget");
  back({ ok: "Budget entry recorded. No payment was initiated." });
});

export const voidBudgetRecord = guardedAction("budget.void", "owner", async (access, formData: FormData): Promise<void> => {
  await requireLedger();
  const id = Number(formData.get("id"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!Number.isSafeInteger(id) || id <= 0) back({ error: "Invalid entry." });
  if (reason.length < 5 || reason.length > 500) back({ error: "Provide a 5–500 character correction reason." });
  const changed = await voidBudgetEntry(id, access.session.slackId, reason);
  if (!changed) back({ error: "Entry wasn't found or was already voided." });
  revalidatePath("/budget");
  back({ ok: "Entry voided with its audit history preserved." });
});
