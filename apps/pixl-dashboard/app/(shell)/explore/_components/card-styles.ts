// Class strings shared by the project card (project-card.tsx) and its
// client-side upvote button, kept out of both so the server card and the
// "use client" button can import them without a client boundary in between.
import { cn } from "@/lib/cn";

// The upvote slot on the card: a button (upvote-button.tsx) or, when voting
// is off, a read-only count.
export const voteBase = cn(
  "inline-flex items-center gap-[6px] border-2 border-stroke bg-panel-2 px-[10px] py-[4px]",
  "font-pixel text-[14px] text-ink tabular-nums transition-[background-color] duration-[130ms]",
);

export const voteIcon = "size-[14px] [image-rendering:pixelated]";
