import { requirePagePerm } from "@/lib/guard";
import { listFormSubmissions, listFormConfigs } from "@/lib/db";
import { decideFormSubmission, saveFormConfig } from "@/app/actions";
import { PendingButton } from "@/app/_components/PendingButton";
import { FormEditor } from "./FormEditor";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

function dateLabel(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Every public, no-account form submission (pixl.hackclub.com/form/*, see
// apps/server/src/routes/forms.ts) lands here for accept/reject. Submitters
// never got a Pixl account - decideFormSubmission DMs them directly by the
// Slack id they verified via Hack Club Auth at submit time.
export default async function FormsPage() {
  await requirePagePerm(["forms"]);
  const [submissions, configs] = await Promise.all([listFormSubmissions(), listFormConfigs()]);
  const pending = submissions.filter((s) => s.status === "pending");
  const decided = submissions.filter((s) => s.status !== "pending");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Forms</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Submissions from the public forms at pixl.hackclub.com/form/* - submitters verify their
          real Slack identity but never get a Pixl account, so accept/reject DMs them directly.
        </p>
      </div>

      <div>
        <div className="text-sm font-medium text-muted-foreground mb-3">Form settings</div>
        <div className="grid gap-4">
          {configs.map((c) => (
            <FormEditor key={c.form_key} config={c} />
          ))}
          <Card className="p-4 md:p-5 gap-3">
            <div className="text-sm font-medium">New form</div>
            <form action={saveFormConfig} className="flex gap-2 items-end flex-wrap">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground block">
                  Form key (used in the URL, e.g. "review" for /form/review)
                </label>
                <Input name="formKey" placeholder="my-form" className="w-56" required pattern="[a-z0-9_-]{1,50}" />
              </div>
              <input type="hidden" name="title" value="" />
              <input type="hidden" name="description" value="" />
              <input type="hidden" name="closeAt" value="" />
              <input type="hidden" name="questionsJson" value="[]" />
              <PendingButton size="sm" variant="outline" pendingText="Creating…">
                Create
              </PendingButton>
            </form>
          </Card>
        </div>
      </div>

      <div>
        <div className="text-sm font-medium text-muted-foreground mb-3">
          {pending.length} pending
        </div>
        {pending.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground text-sm">Nothing pending.</Card>
        ) : (
          <div className="grid gap-4">
            {pending.map((s) => (
              <Card key={s.id} className="p-4 md:p-5 gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{s.name || s.slack_id}</span>
                  <Badge variant="secondary">{s.form_key}</Badge>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {dateLabel(s.created_at)}
                  </span>
                </div>
                <div className="space-y-2 text-sm">
                  {Object.entries(s.answers).map(([key, value]) => (
                    <div key={key}>
                      <div className="text-xs font-medium text-muted-foreground">{key}</div>
                      <div className="whitespace-pre-wrap break-words">{value}</div>
                    </div>
                  ))}
                </div>
                <form action={decideFormSubmission} className="flex flex-col gap-2 pt-2 border-t border-border">
                  <input type="hidden" name="id" value={s.id} />
                  <Textarea
                    name="note"
                    placeholder="Optional note, included in the DM…"
                    rows={2}
                    className="text-sm resize-y"
                  />
                  <div className="flex gap-2">
                    <PendingButton
                      name="decision"
                      value="accepted"
                      size="sm"
                      className="bg-mint text-ink border-transparent hover:bg-mint/90"
                      pendingText="Accepting…"
                    >
                      Accept
                    </PendingButton>
                    <PendingButton
                      name="decision"
                      value="rejected"
                      size="sm"
                      variant="outline"
                      pendingText="Rejecting…"
                      className="text-rose-600 border-rose-200 dark:border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                    >
                      Reject
                    </PendingButton>
                  </div>
                </form>
              </Card>
            ))}
          </div>
        )}
      </div>

      {decided.length > 0 && (
        <div>
          <div className="text-sm font-medium text-muted-foreground mb-3">Decided</div>
          <Card className="overflow-hidden py-0 divide-y divide-border">
            {decided.map((s) => (
              <div key={s.id} className="p-3.5 flex items-center gap-3 flex-wrap">
                <span className="font-medium">{s.name || s.slack_id}</span>
                <Badge variant="secondary">{s.form_key}</Badge>
                <Badge variant={s.status === "accepted" ? "success" : "destructive"}>
                  {s.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  by {s.decided_by} · {dateLabel(s.decided_at)}
                </span>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
