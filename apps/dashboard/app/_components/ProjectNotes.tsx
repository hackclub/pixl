import { addProjectNote } from "@/app/actions";
import { PendingButton } from "@/app/_components/PendingButton";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectNoteRow } from "@/lib/db";

// Free-form internal notes any reviewer can leave on a project - not tied to
// a verdict, just context for whoever looks at this project next. Shared
// between the project detail page and the review page, since reviewers work
// from both.
export function ProjectNotes({
  projectId,
  notes,
  className = "",
}: {
  projectId: number;
  notes: ProjectNoteRow[];
  className?: string;
}) {
  return (
    <div className={className}>
      <h2 className="text-lg font-semibold text-foreground tracking-tight mb-3">Reviewer notes</h2>
      <Card className="p-4">
        <form action={addProjectNote} className="flex flex-col gap-2 mb-4">
          <input type="hidden" name="projectId" value={projectId} />
          <Textarea
            name="body"
            required
            maxLength={2000}
            rows={2}
            placeholder="Leave a note for whoever looks at this project next…"
            className="text-sm"
          />
          <label className="block font-normal">
            <span className="block text-xs font-medium text-muted-foreground mb-1">
              Screenshot (optional)
            </span>
            <input
              name="image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
            />
          </label>
          <PendingButton variant="secondary" pendingText="Adding…" className="self-start">
            Add note
          </PendingButton>
        </form>
        {notes.length === 0 ? (
          <div className="text-sm text-muted-foreground">No notes yet.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {notes.map((n) => (
              <div key={n.id} className="text-sm border-t border-border pt-3 first:border-t-0 first:pt-0">
                <div className="whitespace-pre-wrap break-words">{n.body}</div>
                {n.image_url && (
                  <a href={n.image_url} target="_blank" rel="noreferrer" className="inline-block mt-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={n.image_url}
                      alt=""
                      className="max-h-48 rounded border border-border object-cover"
                    />
                  </a>
                )}
                <div className="text-xs text-muted-foreground mt-1">
                  {n.author} · {new Date(n.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
