export function ageLabel(iso: string | null | undefined, now = Date.now()): string {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(t)) return "";
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export interface OrderStamps {
  created_at: string;
  claimed_at: string | null;
  ordered_at: string | null;
  credited_at: string | null;
  shipped_at: string | null;
  done_at: string | null;
  flagged_at: string | null;
  fulfilled_at: string | null;
}

export function lastUpdated(o: OrderStamps): string {
  const stamps = [o.created_at, o.claimed_at, o.ordered_at, o.credited_at, o.shipped_at, o.done_at, o.flagged_at, o.fulfilled_at];
  let best: { raw: string; t: number } | null = null;
  for (const raw of stamps) {
    const t = raw ? new Date(raw).getTime() : NaN;
    if (Number.isNaN(t)) continue;
    if (!best || t > best.t) best = { raw: raw as string, t };
  }
  return best ? best.raw : o.created_at;
}

export type OrderCounts = Record<"pending" | "claimed" | "ordered" | "credited" | "shipped" | "done" | "cancelled" | "flagged" | "all", number>;

export function foldOrderCounts(rows: { status: string; n: number; flagged: number }[]): OrderCounts {
  const out: OrderCounts = { pending: 0, claimed: 0, ordered: 0, credited: 0, shipped: 0, done: 0, cancelled: 0, flagged: 0, all: 0 };
  for (const r of rows) {
    const n = Number(r.n) || 0;
    out.all += n;
    out.flagged += Number(r.flagged) || 0;
    if (r.status in out && r.status !== "flagged" && r.status !== "all") out[r.status as keyof OrderCounts] += n;
  }
  return out;
}
