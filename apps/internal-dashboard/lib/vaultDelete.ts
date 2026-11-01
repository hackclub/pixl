const SETTLED_CODES = new Set(["23001", "23503"]);

export function vaultDeleteFailure(error: { code?: string; message?: string } | null): string | null {
  if (!error) return null;
  if (error.code && SETTLED_CODES.has(error.code))
    return "This goal already settled its chapter RE, so it can't be deleted. Hide it instead.";
  return "Couldn't delete that goal, nothing was changed.";
}
