import Link from "next/link";
import { buttonVariants, pageSub, pageTitle } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { serverApi } from "@/lib/server-api";
import { CommitReminder } from "./_components/commit-reminder";
import { Feeds, type ActivityItem, type NewsItem } from "./_components/feeds";
import { HackatimeStrip } from "./_components/hackatime-strip";
import { HcaSyncedNotice } from "./_components/hca-notice";
import { ImportBox, type MacondoProject, type YswsShip } from "./_components/import-box";
import { JoinCodeBox, PendingInvites, type PendingInvite } from "./_components/list-boxes";
import { ProjectList } from "./_components/project-list";
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

  const availableShips = ysws?.ok && Array.isArray(ysws.ships) ? ysws.ships : [];
  const availableMacondo = macondo?.ok && Array.isArray(macondo.projects) ? macondo.projects : [];
  const importCount = availableShips.length + availableMacondo.length;

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 font-pixel text-[11px] uppercase tracking-[2px] text-dim">YOUR WORKSPACE / BUILDS</p>
          <h1 className={pageTitle}>PROJECTS</h1>
          <p className={cn(pageSub, "mt-2")}>BUILD IT. TRACK IT. SHIP IT.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/docs/shipping">
            SHIPPING GUIDE
          </Link>
          <TourReplayButton />
          <Link id="new-btn" className={buttonVariants()} href="/projects/new">
            + NEW PROJECT
          </Link>
        </div>
      </header>

      <HcaSyncedNotice value={hca_synced} />
      <HackatimeStrip stats={stats} />
      <PendingInvites invites={invites?.invites ?? []} />

      <ProjectList projects={projects} stats={stats} blackout={blackout} />

      <details className="group mt-6 border-2 border-stroke bg-panel-deep">
        <summary className="flex cursor-px list-none flex-wrap items-center justify-between gap-3 px-4 py-3 marker:hidden hover:bg-panel-2 [&::-webkit-details-marker]:hidden">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-pixel text-[14px] tracking-[1.5px] text-ink">MORE PROJECT TOOLS</span>
            {importCount ? (
              <span className="border border-stroke bg-teal px-2 py-0.5 text-[11px] font-bold text-btn-ink">
                {importCount} TO IMPORT
              </span>
            ) : null}
          </span>
          <span className="font-pixel text-[12px] text-dim group-open:hidden">JOIN / IMPORT +</span>
          <span className="hidden font-pixel text-[12px] text-dim group-open:inline">CLOSE −</span>
        </summary>
        <div className="grid gap-3 border-t-2 border-stroke p-3 lg:grid-cols-2 [&>div]:mb-0">
          <JoinCodeBox />
          <ImportBox ships={availableShips} macondo={availableMacondo} />
          {!importCount ? (
            <div className="flex items-center border-2 border-dashed border-stroke px-4 py-3 text-[13px] text-dim">
              No projects available to import right now.
            </div>
          ) : null}
        </div>
      </details>

      <CommitReminder className="mt-4" />
      <Feeds activity={activity?.activity ?? []} news={news?.news ?? []} />
    </>
  );
}
