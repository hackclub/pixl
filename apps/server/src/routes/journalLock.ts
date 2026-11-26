import type { TransactionSql } from "postgres";
import { sql } from "../db/pgCompat.js";

export async function withWritableJournalProject<T>(
  projectId: number,
  write: (tx: TransactionSql) => Promise<T>,
  client: typeof sql = sql,
): Promise<{ ok: true; value: T } | { ok: false; reason: "not_found" | "project_in_review" }> {
  return client.begin(async (tx) => {
    const rows = await tx`select status from projects where id = ${projectId} for update`;
    if (!rows.length) return { ok: false as const, reason: "not_found" as const };
    if (["shipped", "second_review", "fraud_review"].includes(String(rows[0]!.status)))
      return { ok: false as const, reason: "project_in_review" as const };
    return { ok: true as const, value: await write(tx) };
  }) as Promise<{ ok: true; value: T } | { ok: false; reason: "not_found" | "project_in_review" }>;
}
