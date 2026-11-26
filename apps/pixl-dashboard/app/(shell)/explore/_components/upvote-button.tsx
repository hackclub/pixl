"use client";

// Upvote pill on a project card. Click again to take the vote back.
import { useState } from "react";
import { useAction } from "@/components/use-action";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/lib/guarded-action-core";
import { removeUpvote, upvoteProject } from "../actions";
import { upvoteError } from "../lib";
import { voteBase, voteIcon } from "./card-styles";

type Vote = { upvotes: number; hasUpvoted: boolean };

export function UpvoteButton({ projectId, count, voted }: { projectId: number; count: number; voted: boolean }) {
  const [state, setState] = useState<Vote>({ upvotes: count, hasUpvoted: voted });
  const [err, setErr] = useState<string | null>(null);
  const add = useAction(upvoteProject);
  const remove = useAction(removeUpvote);
  const pending = add.pending || remove.pending;

  async function toggle() {
    setErr(null);
    const res: ActionResult<Vote> = state.hasUpvoted ? await remove.run({ projectId }) : await add.run({ projectId });
    if (res.ok) setState(res.data);
    else setErr(upvoteError(res.error));
  }

  return (
    <>
      <button
        type="button"
        className={cn(
          voteBase,
          "cursor-px disabled:cursor-default",
          "enabled:hover:bg-panel-deep",
          state.hasUpvoted && "bg-gold text-btn-ink enabled:hover:bg-gold-soft",
        )}
        onClick={toggle}
        disabled={pending}
        aria-pressed={state.hasUpvoted}
        aria-label={state.hasUpvoted ? "Remove your upvote" : "Upvote this project"}
        title={state.hasUpvoted ? "Remove your upvote" : "Upvote this project"}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/img/pixl-ui/icon_upvote.png" alt="" className={voteIcon} />
        <span>{state.upvotes}</span>
      </button>
      {err ? (
        <span role="alert" className="text-[12.5px] leading-[1.3] font-semibold text-bad">
          {err}
        </span>
      ) : null}
    </>
  );
}
