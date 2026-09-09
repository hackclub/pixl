"use client";

import { useState } from "react";
import { saveFormConfig } from "@/app/actions";
import { PendingButton } from "@/app/_components/PendingButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import type { FormConfigRow, FormQuestion } from "@/lib/db";

// A datetime-local input wants "YYYY-MM-DDTHH:mm" in local time, not the ISO
// UTC string form_configs.close_at stores - this only affects the editor's
// own display, saveFormConfig re-converts to UTC on submit.
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function FormEditor({ config }: { config: FormConfigRow }) {
  const [title, setTitle] = useState(config.title);
  const [description, setDescription] = useState(config.description);
  const [closeAt, setCloseAt] = useState(toLocalInputValue(config.close_at));
  const [questions, setQuestions] = useState<FormQuestion[]>(
    config.questions.length ? config.questions : [{ key: "", label: "" }],
  );

  const updateQuestion = (i: number, patch: Partial<FormQuestion>) =>
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  const removeQuestion = (i: number) => setQuestions((qs) => qs.filter((_, idx) => idx !== i));
  const addQuestion = () => setQuestions((qs) => [...qs, { key: "", label: "" }]);

  const closed = !!config.close_at && new Date(config.close_at).getTime() <= Date.now();

  return (
    <Card className="p-4 md:p-5 gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
          /form/{config.form_key}
        </span>
        {closed && (
          <span className="text-xs font-medium text-rose-600">closed - submissions blocked</span>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {config.updated_by ? `last edited by ${config.updated_by}` : "never edited"}
        </span>
      </div>

      <form action={saveFormConfig} className="space-y-4">
        <input type="hidden" name="formKey" value={config.form_key} />
        <input type="hidden" name="questionsJson" value={JSON.stringify(questions)} />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Title</Label>
            <Input name="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Closes at (leave blank for open-ended)</Label>
            <Input
              type="datetime-local"
              name="closeAt"
              value={closeAt}
              onChange={(e) => setCloseAt(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Description</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            name="description"
            rows={2}
            className="text-sm resize-y"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Questions</Label>
          {questions.map((q, i) => (
            <div key={i} className="flex gap-2 items-start">
              <Input
                placeholder="key (e.g. message)"
                value={q.key}
                onChange={(e) => updateQuestion(i, { key: e.target.value })}
                className="w-40 shrink-0 font-mono text-xs"
              />
              <Input
                placeholder="Question shown to the submitter"
                value={q.label}
                onChange={(e) => updateQuestion(i, { label: e.target.value })}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => removeQuestion(i)}
                disabled={questions.length <= 1}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addQuestion}>
            Add question
          </Button>
        </div>

        <PendingButton size="sm" pendingText="Saving…">
          Save
        </PendingButton>
      </form>
    </Card>
  );
}
