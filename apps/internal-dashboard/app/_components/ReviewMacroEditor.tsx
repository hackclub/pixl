"use client";

import { useState } from "react";
import { saveReviewerMacros } from "@/app/actions";
import {
  customReviewMacroError,
  MAX_CUSTOM_MACRO_TEXT_LENGTH,
  MAX_CUSTOM_REVIEW_MACROS,
  normalizeCustomReviewMacro,
  type CustomReviewMacro,
} from "@/lib/reviewMacros";
import { Button, Callout, Details, Field, Input, Textarea } from "@/app/_ui/ui";

export function ReviewMacroEditor({
  macros,
  onChange,
}: {
  macros: readonly CustomReviewMacro[];
  onChange: (macros: CustomReviewMacro[]) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [trigger, setTrigger] = useState("");
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setEditing(null);
    setTrigger("");
    setLabel("");
    setText("");
  };

  const startEdit = (macro: CustomReviewMacro) => {
    setEditing(macro.trigger);
    setTrigger(macro.trigger);
    setLabel(macro.label);
    setText(macro.text);
    setError("");
  };

  const persist = async (next: CustomReviewMacro[], done?: () => void) => {
    setSaving(true);
    setError("");
    try {
      const result = await saveReviewerMacros(next);
      if (!result.ok) throw new Error("Could not save your macros.");
      onChange(next);
      done?.();
    } catch {
      setError("Could not save your macros. Nothing was changed; please retry.");
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    const macro = normalizeCustomReviewMacro({ trigger, label, text });
    const problem = customReviewMacroError(macro, macros, editing ?? undefined);
    if (problem) {
      setError(problem);
      return;
    }
    const next = editing
      ? macros.map((m) => (m.trigger === editing ? macro : m))
      : [...macros, macro];
    void persist(next, reset);
  };

  const remove = (triggerToRemove: string) => {
    void persist(macros.filter((m) => m.trigger !== triggerToRemove), () => {
      if (editing === triggerToRemove) reset();
    });
  };

  return (
    <Details summary={`Custom macros (${macros.length}) — manage shortcuts`}>
      <div className="flex flex-col gap-3">
        <p className="hc-muted text-sm">
          Make your own /commands for the note to the player. Type a command to insert its text.
          Saved to your reviewer account, including on other devices. The four built-in commands cannot be edited.
        </p>
        {macros.length > 0 && (
          <div className="flex flex-col gap-2">
            {macros.map((macro) => (
              <div key={macro.trigger} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--border)] p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="hc-code">{macro.trigger}</code>
                    <strong>{macro.label}</strong>
                  </div>
                  <p className="hc-muted mt-1 line-clamp-2 whitespace-pre-wrap break-words text-sm">{macro.text}</p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => startEdit(macro)}>
                    Edit
                  </Button>
                  <Button type="button" size="sm" variant="danger" disabled={saving} onClick={() => remove(macro.trigger)}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Shortcut" hint="For example /nicework. Prefix conflicts with built-in macros are not allowed.">
            <Input
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
              maxLength={25}
              placeholder="/nicework"
              aria-label="Custom macro shortcut"
            />
          </Field>
          <Field label="Name" hint="A short description for the reviewer.">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
              maxLength={60}
              placeholder="Great project"
              aria-label="Custom macro name"
            />
          </Field>
        </div>
        <Field label="Message" hint={`Up to ${MAX_CUSTOM_MACRO_TEXT_LENGTH} characters. Review the inserted text before sending a verdict.`}>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_CUSTOM_MACRO_TEXT_LENGTH}
            rows={3}
            placeholder="Hey! This is an awesome project..."
            aria-label="Custom macro message"
          />
        </Field>
        {error && <Callout tone="danger" icon="important">{error}</Callout>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={saving || (!editing && macros.length >= MAX_CUSTOM_REVIEW_MACROS)} onClick={save}>
            {saving ? "Saving..." : editing ? "Save changes" : "Add macro"}
          </Button>
          {editing && <Button type="button" size="sm" variant="outline" disabled={saving} onClick={reset}>Cancel edit</Button>}
          <span className="hc-muted text-xs">{macros.length}/{MAX_CUSTOM_REVIEW_MACROS} saved</span>
        </div>
      </div>
    </Details>
  );
}
