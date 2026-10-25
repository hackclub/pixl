"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { guardedAction } from "@/lib/guard";
import { getLiveMode } from "@/lib/liveModeServer";
import {
  parseMoneyCents, parseBudgetDate, recordManualBudgetEntry,
  voidManualBudgetEntry, type LedgerDirection, type LedgerState,
} from "@/lib/budgetLedger";

function back(message: { error?: string; ok?: string }): never {
  const query = new URLSearchParams();
  if (message.error) query.set("error", message.error);
  if (message.ok) query.set("ok", message.ok);
  redirect("/budget?" + query.toString());
}

export const addManualBudget = guardedAction("budget.manual.add", "owner",
  async (access, formData: FormData): Promise<void> => {
    if (await getLiveMode()) back({ error: "Turn Live mode off to edit Budget." });
    const direction = String(formData.get("direction") ?? "") as LedgerDirection;
    const state = String(formData.get("state") ?? "") as LedgerState;
    const label = String(formData.get("label") ?? "").trim();
    const note = String(formData.get("note") ?? "").trim();
    const occurredOn = String(formData.get("occurredOn") ?? "").trim();
    const amountCents = parseMoneyCents(String(formData.get("amountUsd") ?? ""));
    if (direction !== "income" && direction !== "expense") back({ error: "Select income or expense." });
    if (state !== "settled" && state !== "planned") back({ error: "Select actual or planned." });
    if (label.length < 3 || label.length > 120) back({ error: "Use a label of 3–120 characters." });
    if (note.length > 500) back({ error: "Notes must be 500 characters or fewer." });
    if (amountCents === null) back({ error: "Enter a positive USD amount up to $999,999.99." });
    if (!parseBudgetDate(occurredOn, state === "planned")) back({ error: "Enter a valid date; future actual payments aren't allowed." });
    await recordManualBudgetEntry({
      actor: access.session.slackId, direction, state, label, note, amountCents, occurredOn,
    });
    revalidatePath("/budget");
    back({ ok: "Budget entry recorded. No real money or pixels were transferred." });
  });

export const voidManualBudget = guardedAction("budget.manual.void", "owner",
  async (access, formData: FormData): Promise<void> => {
    if (await getLiveMode()) back({ error: "Turn Live mode off to edit Budget." });
    const id = Number(formData.get("id"));
    const reason = String(formData.get("reason") ?? "").trim();
    if (!Number.isSafeInteger(id) || id < 1) back({ error: "Invalid entry ID." });
    if (reason.length < 5 || reason.length > 300) back({ error: "Enter a correction reason (5–300 characters)." });
    const saved = await voidManualBudgetEntry(id, access.session.slackId, reason);
    if (!saved) back({ error: "Entry missing or already voided." });
    revalidatePath("/budget");
    back({ ok: "Correction recorded without deleting the original entry." });
  });