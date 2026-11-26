import Link from "next/link";
import { PageHeader, buttonVariants } from "@/components/ui/primitives";
import { config, formatDate, submissionDeadline } from "@/app/_generated/config";
import { serverApi } from "@/lib/server-api";
import { CommitReminder } from "./_components/commit-reminder";
import { Feeds, type ActivityItem, type NewsItem } from "./_components/feeds";
import { HackatimeStrip } from "./_components/hackatime-strip";
import { HcaSyncedNotice } from "./_components/hca-notice";
import { ImportBox, type MacondoProject, type YswsShip } from "./_components/import-box";
import { JoinCodeBox, PendingInvites, type PendingInvite } from "./_components/list-boxes";
import { Legend, ProjectList } from "./_components/project-list";
import { SubmissionCountdown } from "./_components/submission-countdown";
import { loadBlackout, loadProjects, loadStats } from "./data";
import { TourReplayButton } from "./_tour/tour-provider";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ hca_synced?: string }> }) {
  const { hca_synced } = await searchParams;
  const [projects, stats, blackout, invites, ysws, macondo, activity, news] = await Promise.all([
    loadProjects(),
    loadStats(),
    loadBlackout(),
    serverApi<{ invites?: PendingInvite[] }>("/api/collaborations/pending"),
    serverApi<{ ok?: boolean; ships?: YswsShip[] }>("/api/projects/ysws-available"),
    serverApi<{ ok?: boolean; projects?: MacondoProject[] }>("/api/projects/macondo-available"),
    serverApi<{ activity?: ActivityItem[] }>("/api/activity"),
    serverApi<{ news?: NewsItem[] }>("/api/news"),
  ]);

  return (
    <>
      <PageHeader title="PROJECTS" sub="BUILD · JOURNAL · SHIP · GET PAID IN PIXELS.">
        <Legend projects={projects} />
        <TourReplayButton />
        <Link id="new-btn" className={buttonVariants()} href="/projects/new">
          + NEW PROJECT
        </Link>
      </PageHeader>
      <HcaSyncedNotice value={hca_synced} />
      <SubmissionCountdown
        className="mb-4"
        deadline={config.submissionDeadline}
        label={formatDate(submissionDeadline)}
      />
      <HackatimeStrip stats={stats} />
      <CommitReminder className="mb-4" />
      <PendingInvites invites={invites?.invites ?? []} />
      <JoinCodeBox />
      <ImportBox
        ships={ysws?.ok && Array.isArray(ysws.ships) ? ysws.ships : []}
        macondo={macondo?.ok && Array.isArray(macondo.projects) ? macondo.projects : []}
      />
      <ProjectList projects={projects} stats={stats} blackout={blackout} />
      <Feeds activity={activity?.activity ?? []} news={news?.news ?? []} />
    </>
  );
}
