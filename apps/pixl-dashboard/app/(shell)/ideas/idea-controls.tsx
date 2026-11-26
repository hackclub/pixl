"use client";

// Interactive bits of an idea card: vote buttons, delete, apply.
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/primitives";
import { useAction } from "@/components/use-action";
import { cn } from "@/lib/cn";
import { applyToIdea, deleteIdea, voteIdea } from "./actions";
import { applyError, voteError, type Idea } from "./ideas-lib";

const inlineError = "text-[12.5px] text-bad";
const voteBtn = cn(
  "inline-flex cursor-px items-center gap-[5px] border-2 border-stroke bg-panel-2 px-[11px] py-1",
  "font-pixel text-[13px] font-semibold text-dim disabled:cursor-default",
  "transition-[background-color] duration-[120ms] enabled:hover:bg-panel-deep",
);

export function VoteGroup({ idea }: { idea: Idea }) {
  const [up, setUp] = useState({ n: idea.upvotes || 0, on: idea.has_upvoted });
  const [down, setDown] = useState({ n: idea.downvotes || 0, on: idea.has_downvoted });
  const [msg, setMsg] = useState<string | null>(null);
  const vote = useAction(voteIdea);
  const locked = up.on || down.on || vote.pending;

  async function cast(dir: "up" | "down") {
    if (locked) return;
    setMsg(null);
    const res = await vote.run({ id: Number(idea.id), dir });
    if (!res.ok) return setMsg(voteError(res.error, dir));
    if (dir === "up") setUp({ n: res.data.upvotes ?? up.n + 1, on: true });
    else setDown({ n: res.data.downvotes ?? down.n + 1, on: true });
  }

  return (
    <span className="flex flex-col gap-1">
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          className={cn(
            voteBtn,
            "enabled:hover:bg-[color-mix(in_srgb,var(--gold)_22%,var(--panel-2))]",
            up.on && "border-gold bg-gold text-btn-ink",
          )}
          disabled={locked}
          aria-label="Upvote this idea"
          title={up.on ? "You upvoted this" : "Upvote this idea"}
          onClick={() => cast("up")}
        >
          ▲ <span>{up.n}</span>
        </button>
        <button
          type="button"
          className={cn(
            voteBtn,
            "enabled:hover:bg-[color-mix(in_srgb,var(--bad)_22%,var(--panel-2))]",
            down.on && "border-bad bg-bad text-btn-ink",
          )}
          disabled={locked}
          aria-label="Downvote this idea"
          title={down.on ? "You downvoted this" : "Downvote this idea"}
          onClick={() => cast("down")}
        >
          ▼ <span>{down.n}</span>
        </button>
      </span>
      {msg ? (
        <span className={inlineError} role="alert">
          {msg}
        </span>
      ) : null}
    </span>
  );
}

export function DeleteIdeaButton({
  id,
  className = buttonVariants({ variant: "dark" }),
}: {
  id: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const del = useAction(deleteIdea);

  async function confirm() {
    const res = await del.run({ id });
    if (res.ok) setOpen(false);
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        DELETE
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this idea?"
        confirmLabel="Delete"
        danger
        pending={del.pending}
        onConfirm={confirm}
      >
        {del.error ? <p className={inlineError}>Couldn&apos;t delete that idea.</p> : null}
      </ConfirmDialog>
    </>
  );
}

export function ApplyButton({ id }: { id: number }) {
  const [applied, setApplied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const apply = useAction(applyToIdea);

  async function run() {
    if (applied) return;
    setMsg(null);
    const res = await apply.run({ id });
    if (res.ok) {
      setApplied(true);
      setMsg("Applied! Link up on Slack once the poster reaches out.");
    } else setMsg(applyError(res.error));
  }

  return (
    <>
      <button
        type="button"
        className={cn(
          buttonVariants({ variant: "teal" }),
          "mt-1.5 self-start",
          applied && "cursor-default bg-panel-2 text-faint hover:bg-panel-2 disabled:hover:bg-panel-2",
        )}
        disabled={applied || apply.pending}
        onClick={run}
      >
        {applied ? "APPLIED" : apply.pending ? "APPLYING..." : "APPLY"}
      </button>
      <div className={applied || !msg ? "text-xs text-faint" : inlineError} role="status">
        {msg ?? "Link up on Slack if the poster reaches out"}
      </div>
    </>
  );
}
