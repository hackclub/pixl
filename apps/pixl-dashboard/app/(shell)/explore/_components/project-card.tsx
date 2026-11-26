// One project as a plain panel box. The title links to the project page
// (full view for your own projects, read-only public view for everyone
// else's).
import Link from "next/link";
import { SafeImage } from "@/components/safe-image";
import { Badge, panel } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { hours, statusInfo, timeAgo } from "../lib";
import type { ExploreProject, Owner } from "../types";
import { Avatar } from "./avatar";
import { voteBase, voteIcon } from "./card-styles";
import { UpvoteButton } from "./upvote-button";

const icon = (name: string) => `/img/pixl-ui/icon_${name}.png`;

const pixelated = "[image-rendering:pixelated]";

const STATUS_TONE = { shipped: "green", review: "teal", changes: "gold", draft: "default" } as const;

function Stat({ iconName, text, title }: { iconName: string; text: string; title?: string }) {
  return (
    <Badge title={title} className="gap-[6px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={icon(iconName)} alt="" className={cn("size-[13px] flex-none", pixelated)} />
      {text}
    </Badge>
  );
}

export function ProjectCard({ p, owner, canVote = true }: { p: ExploreProject; owner?: Owner | null; canVote?: boolean }) {
  const who: Owner = owner ?? p.owner ?? { display_name: p.owner_name };
  const st = statusInfo(p.status);
  const h = hours(p.hackatime_seconds);
  return (
    <article className={cn(panel, "flex flex-col")} aria-label={p.name}>
      <div className="aspect-[16/10] overflow-hidden border-b-2 border-stroke bg-panel-deep">
        <SafeImage player src={p.image_url} className="size-full object-cover" />
      </div>
      <div className="flex flex-1 flex-col gap-[12px] p-[16px]">
        <div className="flex items-start gap-[8px]">
          <Link
            href={`/projects/${Number(p.id)}`}
            className="min-w-0 flex-1 truncate font-pixel text-[19px] leading-[1.25] text-ink no-underline hover:text-ink hover:underline"
          >
            {p.name}
          </Link>
          {p.is_peak ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={cn("size-[20px] flex-none", pixelated)}
              src={icon("star")}
              alt="Beacon"
              title="Nominated as a standout project by a reviewer"
            />
          ) : null}
        </div>
        <div className="flex items-center gap-[9px] text-[13.5px] text-faint">
          <Avatar name={who.display_name} url={who.avatar_url} className="size-[28px] flex-none text-[13px]" />
          <span className="min-w-0 flex-1 truncate">
            by <b className="text-ink">{p.owner_name || who.display_name || "?"}</b>
          </span>
          <span className="flex-none">{timeAgo(p.created_at)}</span>
        </div>
        <div className="flex flex-wrap gap-[6px]">
          <Badge tone={STATUS_TONE[st.tone]} className="gap-[6px] uppercase">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={icon(st.icon)} alt="" className={cn("size-[13px] flex-none", pixelated)} />
            {st.label}
          </Badge>
          {p.level != null ? <Stat iconName="level" text={`LV ${p.level}`} /> : null}
          {h ? <Stat iconName="clock" text={h} /> : null}
        </div>
        <div className="mt-auto flex flex-wrap items-center justify-end gap-[8px]">
          {canVote ? (
            <UpvoteButton projectId={Number(p.id)} count={Number(p.upvotes ?? 0)} voted={!!p.has_upvoted} />
          ) : p.upvotes == null ? null : (
            <span className={cn(voteBase, "cursor-default")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={icon("upvote")} alt="" className={voteIcon} />
              <span>{Number(p.upvotes ?? 0)}</span>
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
