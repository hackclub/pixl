import { notFound } from "next/navigation";
import {
  loadBlackout,
  loadCollaborators,
  loadHasBirthday,
  loadHours,
  loadJournal,
  loadProjects,
  loadStats,
  loadTimeline,
  loadTrials,
  loadWalletRe,
} from "../data";
import { serverFetch } from "@/lib/server-api";
import { projectEstimate, usdPerHourFor } from "../../calc/estimates";
import { projectCutoffMs, statsPath } from "../format";
import { isInReview } from "../types";
import { Collaborators } from "../_components/collaborators";
import { CollabView } from "../_components/collab-view";
import { DangerZone } from "../_components/danger-zone";
import { Journal } from "../_components/journal";
import { linkedSeconds } from "../_components/project-list";
import { ProjectEditor } from "../_components/project-editor";
import { PublicView, type PublicProject } from "../_components/public-view";
import { Timeline } from "../_components/timeline";

export const metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();

  // Your own and collaborated projects get the full page; anyone else's
  // project gets the read-only public view (the same fields Explore shows).
  const project = (await loadProjects()).find((p) => p.id === id);
  if (!project) {
    // The endpoint is public and only uses a session for has_upvoted, which
    // this view doesn't render. serverGet would answer a synthetic 401 for any
    // visitor without a login, so call it without a token.
    const pub = await serverFetch<PublicProject>(`/api/explore/projects/${id}`);
    if (pub.ok) return <PublicView data={pub.data} />;
    if (pub.status === 404 || pub.status === 400) notFound();
    throw new Error(`project ${id} could not be loaded (${pub.status})`);
  }

  const cutoffMs = projectCutoffMs(project.hours_extended_since);
  const [trials, stats, blackout, journal, collabs, hasBirthday] = await Promise.all([
    loadTrials(),
    loadStats(statsPath(cutoffMs)),
    loadBlackout(),
    loadJournal(id),
    loadCollaborators(id),
    loadHasBirthday(),
  ]);
  const locked = isInReview(project);

  if (project.is_owner === false) {
    const hours = await loadHours(id);
    return (
      <CollabView
        project={project}
        stats={stats}
        hours={hours}
        collaborators={collabs?.collaborators ?? []}
        journal={<Journal projectId={id} entries={journal} locked={locked} />}
      />
    );
  }

  const [timeline, re] = await Promise.all([loadTimeline(id), loadWalletRe()]);
  const htSeconds = linkedSeconds(project, stats);
  // Computed here, server side: the client only ever sees the resulting numbers.
  const estimate = projectEstimate({
    htSeconds,
    journalSeconds: project.journal_seconds,
    approvedHours: project.approved_hours,
    re: re ?? 0,
  });
  return (
    <ProjectEditor
      project={project}
      trials={trials}
      stats={stats}
      cutoffMs={cutoffMs}
      blackout={blackout}
      hasBirthday={hasBirthday}
      htSeconds={htSeconds}
      estimate={estimate}
      usdPerHour={usdPerHourFor(re ?? 0)}
      collaborators={
        collabs ? (
          <Collaborators projectId={id} collaborators={collabs.collaborators} isOwner={collabs.isOwner} joinCode={project.join_code} />
        ) : (
          <p className="text-sm text-faint">Couldn&apos;t load collaborators.</p>
        )
      }
      timeline={<Timeline data={timeline} />}
      journal={<Journal projectId={id} entries={journal} locked={locked} />}
      dangerZone={<DangerZone id={id} name={project.name} />}
    />
  );
}
