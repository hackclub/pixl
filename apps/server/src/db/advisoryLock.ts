import type { TransactionSql } from "postgres";
import { sql } from "./pgCompat.js";

// Runs `fn` inside a transaction holding a Postgres advisory lock scoped to
// `key`, so two concurrent requests that would otherwise both read stale
// state (a balance, an existing-vote check) before either writes run one
// after the other instead. This is deliberately lighter than a real row
// lock, it exists for the cases here (a derived balance, a check across
// two different vote tables) that don't map to one lockable row.
export async function withLock<T>(
  key: string,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${key}))`;
    return fn(tx);
  }) as Promise<T>;
}
