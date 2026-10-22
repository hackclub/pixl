"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Markdown } from "@/components/markdown";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Notice, panel } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { deleteJournal, editJournal, postJournal } from "../collab-actions";
import { projectError, projectErrorWith } from "../errors";
import { journalTextLength, timeAgo } from "../format";
import type { JournalEntry } from "../types";
import { journalDraftKey as draftKey } from "@/lib/local-state";
import { JournalForm, type JournalDraft } from "./journal-form";
import { hint } from "./styles";

function readDraft(id: number): JournalDraft {
  try {
    const raw = localStorage.getItem(draftKey(id));
    if (raw) {
      const d = JSON.parse(raw);
      return { title: String(d.title ?? ""), content: String(d.content ?? ""), hours: Number(d.hours) || 0 };
    }
  } catch {
    // drafts are a convenience only
  }
  return { title: "", content: "", hours: 0 };
}

export function Journal({ projectId, entries, locked }: { projectId: number; entries: JournalEntry[]; locked: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<JournalDraft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  useEffect(() => setDraft(readDraft(projectId)), [projectId]);

  function saveDraft(d: JournalDraft) {
    try {
      localStorage.setItem(draftKey(projectId), JSON.stringify(d));
    } catch {
      // ignore
    }
  }

  async function post(d: JournalDraft) {
    setPending(true);
    const r = await postJournal({ projectId, entry: d });
    setPending(false);
    if (!r.ok) {
      setMsg({ tone: "bad", text: projectErrorWith(r.error, r.details, { contentLength: journalTextLength(d.content) }) });
      return false;
    }
    try {
      localStorage.removeItem(draftKey(projectId));
    } catch {
      // ignore
    }
    setMsg({ tone: "good", text: "Entry posted!" });
    router.refresh();
    return true;
  }

  async function save(id: string, d: JournalDraft) {
    setPending(true);
    const r = await editJournal({ projectId, entryId: id, entry: d });
    setPending(false);
    if (!r.ok) {
      setMsg({ tone: "bad", text: projectErrorWith(r.error, r.details, { contentLength: journalTextLength(d.content) }) });
      return false;
    }
    setEditing(null);
    setMsg({ tone: "good", text: "Entry updated!" });
    router.refresh();
    return true;
  }

  async function remove() {
    if (!deleting) return;
    setPending(true);
    const r = await deleteJournal({ projectId, entryId: deleting });
    setPending(false);
    setDeleting(null);
    setMsg(r.ok ? { tone: "good", text: "Entry deleted." } : { tone: "bad", text: projectError(r.error) });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <p className={hint()}>
        Journaling is optional, but it&apos;s the best way to protect your payout: entries justify your hours to a reviewer, so a
        journaled project rarely gets deflated. Don&apos;t re-enter hours Hackatime already tracked; the hours field is only for time it
        missed (planning, hardware work, art...).
      </p>
      {locked ? (
        <Notice>This project is in review, so its journal is locked until the review is done.</Notice>
      ) : draft ? (
        <JournalForm key="new" initial={draft} submitLabel="POST ENTRY" pending={pending} onSubmit={post} onDraft={saveDraft} />
      ) : null}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {entries.length === 0 ? (
        <p className="py-3 text-center text-sm text-faint">No entries yet, journal as you build, reviewers read these.</p>
      ) : (
        entries.map((e) => {
          const id = String(e.id);
          if (editing === id)
            return (
              <JournalForm
                key={id}
                initial={{ title: e.title ?? "", content: e.content, hours: Number(e.hours) || 0 }}
                submitLabel="SAVE"
                pending={pending}
                onSubmit={(d) => save(id, d)}
                onCancel={() => setEditing(null)}
              />
            );
          return (
            <div key={id} className={cn(panel, "px-[14px] py-[12px]")}>
              <div className="mb-[6px] flex flex-wrap items-center gap-[10px] text-[12px] text-faint">
                <span>{timeAgo(e.created_at)}</span>
                {e.edited_at ? <span className="text-faint">(edited)</span> : null}
                {e.hours ? <span className="text-teal">{Number(e.hours).toFixed(1)}h</span> : null}
                {!locked ? (
                  <span className="ml-auto flex gap-2">
                    <button type="button" className="underline" onClick={() => setEditing(id)}>
                      edit
                    </button>
                    <button type="button" className="underline" onClick={() => setDeleting(id)}>
                      delete
                    </button>
                  </span>
                ) : null}
              </div>
              {e.title ? <div className="mb-1 font-bold">{e.title}</div> : null}
              <Markdown source={e.content} />
            </div>
          );
        })
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this journal entry?"
        confirmLabel="Delete"
        danger
        pending={pending}
        onConfirm={remove}
      />
    </div>
  );
}
