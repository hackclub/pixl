import Link from "next/link";
import { Badge, buttonVariants, card, panel } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { SafeImage } from "@/components/safe-image";
import { safeHttpUrl } from "@/lib/safe-url";
import { hours } from "../format";
import { isInReview, levelName, statusInfo, type BlackoutState, type HtStats, type Project } from "../types";
import { BlackoutChip } from "./blackout-chip";
import { CopyLinkButton } from "./copy-link";
import { noteStrip, statusChip, statusDot, type StatusTone } from "./styles";

/** Hackatime seconds behind a project's linked names, as the server reported them. */
export function linkedSeconds(p: Project, stats: HtStats | null): number {
  // In review the clock is stopped: show the snapshot taken at ship.
  if (isInReview(p) && p.hackatime_seconds != null)
    return Math.max(Number(p.hackatime_seconds) - (p.kind === "hardware" ? Number(p.journal_seconds) || 0 : 0), 0);
  if (!stats || !stats.connected) return 0;
  const linked = new Set(p.hackatime_projects || []);
  return stats.projects.filter((h) => linked.has(h.name)).reduce((s, h) => s + (h.secondsSinceCutoff ?? h.seconds), 0);
}

const LEGEND: [string, StatusTone, (p: Project) => boolean][] = [
  ["APPROVED", "approved", (p) => p.status === "approved" && !p.rejected_at],
  ["IN REVIEW", "shipped", (p) => isInReview(p)],
  ["NEEDS CHANGES", "needs", (p) => p.status === "needs_changes" || !!p.rejected_at || !!p.banned_at],
  ["DRAFTS", "draft", (p) => !p.status || p.status === "draft"],
];

export function Legend({ projects }: { projects: Project[] }) {
  if (!projects.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-dim">
      {LEGEND.map(([label, tone, match]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn(statusDot(tone), "mr-0")} />
          <span className="font-pixel text-[11px] tracking-[.5px]">{label}</span>
          <strong className="font-sans text-[13px] font-bold tabular-nums text-ink">{projects.filter(match).length}</strong>
        </span>
      ))}
    </div>
  );
}

function ProjectCard({ p, stats, blackout }: { p: Project; stats: HtStats | null; blackout: BlackoutState }) {
  const [label, tone] = statusInfo(p);
  const ht = linkedSeconds(p, stats);
  const journal = Number(p.journal_seconds) || 0;
  const repo = safeHttpUrl(p.repo_url);
  const demo = safeHttpUrl(p.demo_url);
  const htNames = (p.hackatime_projects || []).join(", ");
  const projectUrl = "/projects/" + p.id;

  return (
    <article className={cn(card, "flex min-w-0 flex-col overflow-hidden p-0 text-ink")}>
      <div className="flex min-w-0 gap-3 p-3 sm:gap-4 sm:p-4">
        <Link
          href={projectUrl}
          className="flex h-[92px] w-[104px] shrink-0 items-center justify-center overflow-hidden border-2 border-stroke bg-(--img-slot) font-pixel text-[10px] text-muted hover:text-gold-soft sm:h-[108px] sm:w-[124px]"
          aria-label={"Open " + p.name}
        >
          <SafeImage player src={p.image_url} className="size-full object-cover" fallback="NO IMAGE" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className={statusChip(tone)}>{label}</span>
            <Badge className="px-2 py-0.5 text-[11px]">{levelName(p.level)}</Badge>
            <BlackoutChip entry={blackout.entries[p.id]} />
          </div>
          <Link href={projectUrl} className="block break-words font-pixel text-[17px] leading-[1.4] text-ink hover:text-gold-soft">
            {p.name}
          </Link>
          {p.description ? (
            <p className="mt-1 line-clamp-2 text-[13px] leading-[1.45] text-dim">{p.description}</p>
          ) : (
            <p className="mt-1 text-[12px] text-faint">No description yet.</p>
          )}
        </div>
      </div>

      {(p.is_owner === false || p.trial_reward_choice === "pending" || p.pixels_earned) ? (
        <div className="flex flex-wrap gap-2 px-3 pb-3 sm:px-4">
          {p.is_owner === false ? <Badge>COLLABORATOR</Badge> : null}
          {p.trial_reward_choice === "pending" ? <Badge tone="gold">TRIAL REWARD WAITING</Badge> : null}
          {p.pixels_earned ? <Badge tone="green">+{Math.round(p.pixels_earned)} PX EARNED</Badge> : null}
        </div>
      ) : null}

      {p.status === "needs_changes" && p.review_note ? <div className={cn(noteStrip, "mx-3 mb-3 mt-0 sm:mx-4")}>{p.review_note}</div> : null}
      {p.rejected_at && p.reject_reason ? <div className={cn(noteStrip, "mx-3 mb-3 mt-0 sm:mx-4")}>{p.reject_reason}</div> : null}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t-2 border-stroke bg-panel-deep px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <strong className="font-pixel text-[17px] text-teal tabular-nums">{hours(ht + journal)}</strong>
            <span className="font-pixel text-[10px] uppercase tracking-[.5px] text-dim">tracked</span>
          </div>
          <p className="max-w-[180px] truncate text-[11px] text-faint" title={htNames || "No Hackatime project linked"}>
            {htNames || "No Hackatime project linked"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px]">
          {repo ? (
            <a className="font-bold text-ink hover:text-gold-soft" href={repo} target="_blank" rel="noopener noreferrer">
              CODE
            </a>
          ) : null}
          {demo ? (
            <a className="font-bold text-ink hover:text-gold-soft" href={demo} target="_blank" rel="noopener noreferrer">
              DEMO
            </a>
          ) : null}
          <CopyLinkButton id={p.id} variant="link" />
          <Link className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-[12px]")} href={projectUrl}>
            OPEN →
          </Link>
        </div>
      </div>
    </article>
  );
}

export function ProjectList({
  projects,
  stats,
  blackout,
}: {
  projects: Project[];
  stats: HtStats | null;
  blackout: BlackoutState;
}) {
  if (!projects.length) {
    return (
      <div className={cn(panel, "p-8 text-center")}>
        <h2 className="font-pixel text-2xl">NO PROJECTS YET</h2>
        <p className="mx-auto mt-2 max-w-xl text-dim">
          Log what you&apos;re building, link it to Hackatime, journal as you go, then ship it for review: approved hours
          pay out in pixels.
        </p>
        <Link className={cn(buttonVariants(), "mt-4")} href="/projects/new">
          + START YOUR FIRST PROJECT
        </Link>
      </div>
    );
  }
  return (
    <section aria-label="My projects">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-pixel text-[20px] tracking-[1px] text-ink">
          MY PROJECTS <span className="text-dim">({projects.length})</span>
        </h2>
        <Legend projects={projects} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2 lg:gap-4">
        {projects.map((p) => (
          <ProjectCard key={p.id} p={p} stats={stats} blackout={blackout} />
        ))}
      </div>
    </section>
  );
}
