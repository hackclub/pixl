// First-pass metadata on a 'shipped' row can only be from an older cycle.
// A new first-pass verdict moves the project out of 'shipped'.
export function hasCurrentFirstPass(p: { status: string; first_pass_by?: string | null }): boolean {
  return p.status !== "shipped" && Boolean(p.first_pass_by);
}

export function currentFirstPassAt(status: string, at: string | null): string | null {
  return status === "shipped" ? null : at;
}
