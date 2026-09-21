"use client";

import { useRef } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { updateSecondPassChecklist } from "@/app/actions";

const ITEMS = [
  { field: "second_pass_telescreen_checked", label: "Checked in Telescreen" },
  { field: "second_pass_hours_deflated", label: "Hours deflated (if needed)" },
  { field: "second_pass_heartbeats_added", label: "Heartbeats added to justification" },
] as const;

export function SecondPassChecklist({
  projectId,
  values,
  hackatimeUserId,
}: {
  projectId: number;
  values: { second_pass_telescreen_checked: boolean; second_pass_hours_deflated: boolean; second_pass_heartbeats_added: boolean };
  /** Hackatime's own numeric user id for this project's submitter (see
   * HackatimeReport.hackatimeUserId in lib/hackatime.ts) - NOT the Pixl user
   * id or Slack id. Empty when Hackatime has no id for them; the button is
   * hidden rather than ever linking to a Telescreen URL with no id on it. */
  hackatimeUserId: string;
}) {
  return (
    <div className="space-y-3">
      {hackatimeUserId && (
        <Button asChild variant="default" className="w-full sm:w-auto">
          <a
            href={`https://telescreen.hackclub.com/workbench/hackatime/overview?u=${encodeURIComponent(hackatimeUserId)}`}
            target="_blank"
            rel="noreferrer"
          >
            Open in Telescreen
          </a>
        </Button>
      )}
      <div className="space-y-2">
        {ITEMS.map((item) => (
          <ChecklistRow
            key={item.field}
            projectId={projectId}
            field={item.field}
            label={item.label}
            checked={values[item.field]}
          />
        ))}
      </div>
    </div>
  );
}

function ChecklistRow({
  projectId,
  field,
  label,
  checked,
}: {
  projectId: number;
  field: string;
  label: string;
  checked: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={updateSecondPassChecklist}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="field" value={field} />
      <input type="hidden" name="checked" value={(!checked).toString()} />
      <Label className="flex items-center gap-2 text-sm font-normal cursor-pointer">
        <Checkbox checked={checked} onCheckedChange={() => formRef.current?.requestSubmit()} />
        {label}
      </Label>
    </form>
  );
}
