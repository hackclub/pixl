import { sql } from "./pgCompat";

export interface TransferPixelsInput {
  fromUserId: string;
  toUserId: string;
  amount: number;
  /** Who performed the transfer, e.g. "Name (USLACK)". */
  actor: string;
  /** Human note stored in the ledger next to the actor. */
  note: string;
}

export type TransferPixelsResult =
  | { ok: true; fromBalance: number; toBalance: number }
  | { ok: false; error: string; balance?: number };

// Moves pixels between two wallets in one transaction. The debit, credit and
// both ledger rows commit together, so a failed transfer can never leave
// pixels missing from one side. The source has to hold the full amount: unlike
// adjust_user_pixels (which may leave a player in debt and cancel pending
// orders to cover it), a transfer has no reason to surprise either player.
export async function transferPixels(
  input: TransferPixelsInput,
  client: typeof sql = sql,
): Promise<TransferPixelsResult> {
  const amount = Math.round(Number(input.amount));
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(input.fromUserId) || !uuid.test(input.toUserId)) {
    return { ok: false, error: "Pick two valid players." };
  }
  if (input.fromUserId === input.toUserId) {
    return { ok: false, error: "Pick two different players." };
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, error: "Enter a whole number of pixels." };
  }

  return client.begin(async (tx) => {
    // Lock both wallets in a stable order, so two transfers in opposite
    // directions can't deadlock waiting on each other's source row.
    const ids = [input.fromUserId, input.toUserId].sort();
    const rows = [
      ...(await tx`select id, pixels from users where id = ${ids[0]} for update`),
      ...(await tx`select id, pixels from users where id = ${ids[1]} for update`),
    ];
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    const from = byId.get(input.fromUserId);
    const to = byId.get(input.toUserId);
    if (!from || !to) return { ok: false, error: "One of those players no longer exists." };

    const fromBalance = Number(from.pixels) || 0;
    if (fromBalance < amount) {
      return { ok: false, error: "Not enough pixels for this transfer.", balance: fromBalance };
    }

    const debited = await tx`
      update users set pixels = pixels - ${amount}
      where id = ${input.fromUserId}
      returning pixels`;
    const credited = await tx`
      update users set pixels = pixels + ${amount}
      where id = ${input.toUserId}
      returning pixels`;

    // Keep the note in created_by so the pixel log shows the reason next to
    // the transaction (same shape as manual grants/deductions).
    const createdBy = `${input.actor} , ${input.note}`;
    await tx`insert into pixel_transactions (user_id, project_id, amount, hours, reason, created_by)
      values (${input.fromUserId}, null, ${-amount}, 0, 'transfer_out', ${createdBy})`;
    await tx`insert into pixel_transactions (user_id, project_id, amount, hours, reason, created_by)
      values (${input.toUserId}, null, ${amount}, 0, 'transfer_in', ${createdBy})`;

    return {
      ok: true as const,
      fromBalance: Number(debited[0]?.pixels) || 0,
      toBalance: Number(credited[0]?.pixels) || 0,
    };
  });
}
