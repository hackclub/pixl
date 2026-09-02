// Shop item options support named groups (e.g. "Color", "Storage", "RAM"), each
// with its own choices. To avoid a DB migration these are stored in the existing
// `options: string[]` column, one element per group, encoded as
// "GroupName: choiceA, choiceB". A group with no name is just "choiceA, choiceB".
// Legacy items (a flat list of loose choices) still parse , they collapse into a
// single unnamed group.

export interface OptionGroup {
  name: string;
  choices: string[];
}

export function parseOptionGroups(options: string[]): OptionGroup[] {
  const named: OptionGroup[] = [];
  const loose: string[] = [];
  for (const raw of options ?? []) {
    const o = String(raw);
    const idx = o.indexOf(":");
    if (idx > 0) {
      const name = o.slice(0, idx).trim();
      const choices = o
        .slice(idx + 1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (choices.length) named.push({ name, choices });
    } else {
      const c = o.trim();
      if (c) loose.push(c);
    }
  }
  if (loose.length) named.unshift({ name: "", choices: loose });
  return named;
}

export function serializeGroups(groups: OptionGroup[]): string[] {
  const out: string[] = [];
  for (const g of groups) {
    const choices = g.choices
      .map((c) => String(c).trim())
      .filter(Boolean)
      // 40, not 20 - the Indie Game of Your Choice picklist alone has 27.
      .slice(0, 40);
    if (choices.length === 0) continue;
    const name = String(g.name ?? "").trim();
    out.push(name ? `${name}: ${choices.join(", ")}` : choices.join(", "));
    if (out.length >= 20) break;
  }
  return out;
}
