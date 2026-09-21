"use client";

import { useRef } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { updateSecondPassChecklist } from "@/app/actions";

const ITEMS = [
  { field: "second_pass_telescreen_checked", label: "Checked in Telescreen" },
  { field: "second_pass_hours_deflated", label: "Hours deflated (if needed)" },
  { field: "second_pass_heartbeats_added", label: "Heartbeats added to justification" },
] as const;

export function SecondPassChecklist({
  projectId,
  values,
}: {
  projectId: number;
  values: { second_pass_telescreen_checked: boolean; second_pass_hours_deflated: boolean; second_pass_heartbeats_added: boolean };
}) {
  return (
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
