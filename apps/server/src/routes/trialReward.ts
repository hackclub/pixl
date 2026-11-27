import { sql } from "../db/pgCompat.js";
import { trialItemCreditTarget } from "../trialPayout.js";

export type TrialClaim =
  | { ok: false; error: "not_found" | "nothing_to_claim" | "trial_missing" }
  | { ok: true; choice: "item" | "pixels"; trialLabel: string; pixels: number; item?: string };

export async function settleTrialReward(
  projectId: number,
  userId: string,
  choice: "item" | "pixels",
  client: typeof sql = sql,
): Promise<TrialClaim> {
  return client.begin(async (tx) => {
    const projects = await tx`select id, name, status, sidequest_id, trial_reward_choice,
      trial_held_px, trial_prize_px, approved_hours from projects
      where id = ${projectId} and user_id = ${userId} for update`;
    const project = projects[0];
    if (!project) return { ok: false as const, error: "not_found" as const };
    if (project.status !== "approved" || project.trial_reward_choice !== "pending")
      return { ok: false as const, error: "nothing_to_claim" as const };

    const trials = await tx`select name, reward, prize_shop_item_id from sidequests
      where id = ${project.sidequest_id}`;
    const trial = trials[0];
    if (!trial && choice === "item")
      return { ok: false as const, error: "trial_missing" as const };

    const held = Math.max(Number(project.trial_held_px) || 0, 0);
    const prize = Math.max(Number(project.trial_prize_px) || 0, 0);
    const beyond = Math.max(held - prize, 0);
    const hours = Number(project.approved_hours) || 0;
    const trialLabel = String(trial?.name || "this Trial");

    if (choice === "pixels") {
      await tx`select credit_project_pixels(${userId}::uuid, ${projectId}::bigint,
        ${held}::numeric, ${hours}::numeric, 'trial_reward')`;
      await tx`update projects set trial_reward_choice = 'pixels' where id = ${projectId}`;
      return { ok: true as const, choice, trialLabel, pixels: held };
    }

    let itemId: number | null = null;
    let itemName = String(trial?.reward || trial?.name || "Trial prize");
    if (trial?.prize_shop_item_id) {
      const items = await tx`select id, name from shop_items where id = ${trial.prize_shop_item_id}`;
      if (items[0]) {
        itemId = Number(items[0].id);
        itemName = String(items[0].name);
      }
    }
    const orders = await tx`insert into shop_orders
      (user_id, item_id, item_name, option, price, status)
      values (${userId}::uuid, ${itemId}, ${itemName}, ${`Trial: ${trial?.name}`}, ${prize}, 'pending')
      returning id`;
    await tx`update projects set trial_reward_choice = 'item',
      trial_prize_order_id = ${orders[0]!.id} where id = ${projectId}`;

    if (beyond > 0) {
      const earned = await tx`select coalesce(sum(amount), 0) as total from pixel_transactions
        where project_id = ${projectId} and user_id = ${userId}
          and reason in ('project_approved', 'review_reverted')`;
      const target = trialItemCreditTarget(Number(earned[0]!.total), held, prize);
      await tx`select credit_project_pixels(${userId}::uuid, ${projectId}::bigint,
        ${target}::numeric, ${hours}::numeric, 'trial_reward')`;
    }
    return { ok: true as const, choice, trialLabel, item: itemName, pixels: beyond };
  }) as Promise<TrialClaim>;
}
