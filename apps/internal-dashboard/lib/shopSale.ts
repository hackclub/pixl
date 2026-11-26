// Sale end dates are stored as timestamptz, but the dashboard's
// datetime-local inputs have no timezone of their own. Treat the wall-clock
// value as UTC (the input is labelled that way) so an admin in any timezone
// schedules the same instant, matching the events forms' convention.

/** Stored instant → the "YYYY-MM-DDTHH:mm" a datetime-local input wants. */
export function saleEndsInputValue(value: unknown): string {
  if (value == null || value === "") return "";
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 16);
}

/** datetime-local value → an ISO instant, or null for "no end date". */
export function parseSaleEndsInput(raw: FormDataEntryValue | null): string | null {
  if (raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const d = new Date(`${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Human-readable UTC label for the dashboard's sale badges. */
export function saleEndsLabel(value: unknown): string | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Whether a row's sale is running right now. */
export function saleIsActive(
  discountPercent: unknown,
  endsAt: unknown,
  now: number = Date.now(),
): boolean {
  const pct = Number(discountPercent);
  if (!Number.isFinite(pct) || pct <= 0) return false;
  if (endsAt == null || endsAt === "") return true;
  const end = endsAt instanceof Date ? endsAt.getTime() : new Date(String(endsAt)).getTime();
  return Number.isFinite(end) ? end > now : false;
}
