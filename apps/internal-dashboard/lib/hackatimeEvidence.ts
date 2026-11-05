export function linkedEvidenceNames(
  projects: { name: string }[],
  linked: ReadonlySet<string>,
): string[] {
  return [...new Set(projects.filter((p) => linked.has(p.name)).map((p) => p.name))];
}
