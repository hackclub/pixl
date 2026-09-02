import Link from "next/link";
import { requirePagePerm, canView } from "@/lib/guard";
import { listProjects, collaboratorsByProject } from "@/lib/db";
import { StatusBadge, BeaconBadge } from "@/app/_components/ProjectBadges";
import { Badge } from "@/components/ui/badge";
import { slackHandles } from "@/lib/slack";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string }>;
}) {
  const access = await requirePagePerm(["review", "warn", "ban"]);
  // Admins (ban perm) see archived projects mixed into the main list; plain
  // reviewers only see active ones.
  const isAdmin = canView(access, ["ban"]);
  const { q, view } = await searchParams;
  const archived = view === "archived";
  const projects = await listProjects(q, {
    archived,
    includeArchived: !archived && isAdmin,
  });
  const handles = await slackHandles(projects.map((p) => p.users?.slack_id));
  const collaborators = await collaboratorsByProject(projects.map((p) => p.id));

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-6">
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">
          {archived ? "Archived projects" : "Projects"}
        </h1>
        <div className="flex gap-2">
          {access.isSuper && (
            <Button asChild variant="outline">
              <a href="/api/projects/export">Export approved (CSV)</a>
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href={archived ? "/projects" : "/projects?view=archived"}>
              {archived ? "← Active projects" : "View archive"}
            </Link>
          </Button>
        </div>
      </div>
      <form className="mb-5 flex gap-2">
        {archived && <input type="hidden" name="view" value="archived" />}
        <Input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search project names…"
          className="flex-1 min-w-0 max-w-72"
        />
        <Button type="submit">Search</Button>
      </form>
      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="p-3">Project</TableHead>
              <TableHead className="p-3">Status</TableHead>
              <TableHead className="p-3">Owner</TableHead>
              <TableHead className="p-3">Links</TableHead>
              <TableHead className="p-3">Hackatime</TableHead>
              <TableHead className="p-3">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="p-3 max-w-72">
                  <Link
                    href={`/projects/${p.id}`}
                    className="font-bold hover:text-brand"
                  >
                    {p.name}
                  </Link>
                  {p.description && (
                    <div className="text-xs text-muted-foreground truncate">{p.description}</div>
                  )}
                </TableCell>
                <TableCell className="p-3">
                  <div className="flex items-center gap-1.5">
                    <StatusBadge status={p.status} />
                    {p.is_peak && <BeaconBadge />}
                    {p.archived_at && <Badge variant="secondary">Archived</Badge>}
                  </div>
                </TableCell>
                <TableCell className="p-3">
                  {p.users ? (
                    <Link href={`/players/${p.user_id}`} className="font-bold hover:text-brand">
                      {p.users.real_name ||
                        (p.users.slack_id && handles.get(p.users.slack_id)) ||
                        p.users.display_name ||
                        p.users.slack_id}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{p.user_id}</span>
                  )}
                  {(collaborators.get(p.id)?.length ?? 0) > 0 && (
                    <div className="text-xs text-muted-foreground">
                      +{collaborators.get(p.id)!.length} collaborator
                      {collaborators.get(p.id)!.length === 1 ? "" : "s"}
                    </div>
                  )}
                </TableCell>
                <TableCell className="p-3">
                  <div className="flex gap-2">
                    {p.repo_url && (
                      <a
                        href={p.repo_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand font-bold underline"
                      >
                        repo
                      </a>
                    )}
                    {p.demo_url && (
                      <a
                        href={p.demo_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand font-bold underline"
                      >
                        demo
                      </a>
                    )}
                    {!p.repo_url && !p.demo_url && <span className="text-muted-foreground">-</span>}
                  </div>
                </TableCell>
                <TableCell className="p-3 text-foreground/70">
                  {p.hackatime_projects?.length ? p.hackatime_projects.join(", ") : "-"}
                </TableCell>
                <TableCell className="p-3 text-muted-foreground">
                  {new Date(p.created_at).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
            {projects.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell className="p-5 text-muted-foreground" colSpan={6}>
                  No projects found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
