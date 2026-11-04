"use client";

import { Button, buttonVariants, field, selectField, textareaField } from "@/components/ui/primitives";
import { LEVELS, PROJECT_TYPES, type HtStats, type Trial } from "../types";
import type { FormState, SetForm } from "./editor-state";
import { FileButton } from "./file-button";
import { CountedTextarea, Disclosure, OpenLink, Row } from "./form-bits";
import { HardwareFields } from "./funding-fields";
import { HtPicker } from "./ht-picker";
import { formGrid, hint } from "./styles";

/**
 * The project details form. State lives in the parent (the ship panel reads
 * the same values); this only renders and edits it.
 */
export function ProjectForm({
  form,
  set,
  projectId,
  trials,
  linkedTrialName,
  stats,
  locked,
  saving,
  onSave,
  saveLabel,
  returnTo,
  usdPerHour,
}: {
  form: FormState;
  set: SetForm;
  projectId?: number;
  trials: Trial[];
  linkedTrialName?: string | null;
  stats: HtStats | null;
  locked?: boolean;
  saving?: boolean;
  onSave: () => void;
  saveLabel: string;
  returnTo: string;
  /** Player's current $/hr, computed server side, for the funding note. */
  usdPerHour?: number;
}) {
  const linkedId = form.sidequestId ? Number(form.sidequestId) : null;
  const isLinked = (t: Trial) => linkedId != null && Number(t.id) === linkedId;
  const accepted = trials.filter((t) => isLinked(t) || (t.unlocked && !t.completed));
  const lockedTrials = trials.filter((t) => !t.unlocked && !isLinked(t));
  const linkedMissing = linkedId != null && !trials.some(isLinked);

  return (
    <div className={formGrid}>
      <Row label="NAME *">
        <input
          id="f-name"
          className={field}
          maxLength={120}
          value={form.name}
          disabled={locked}
          placeholder="What are you building?"
          onChange={(e) => set({ name: e.target.value })}
        />
      </Row>
      <Row label="DESCRIPTION">
        <textarea
          className={textareaField}
          maxLength={2000}
          value={form.description}
          disabled={locked}
          placeholder="What it is, what it does... (Markdown supported)"
          onChange={(e) => set({ description: e.target.value })}
        />
      </Row>
      <div className="grid grid-cols-[1fr_1fr] gap-[14px] max-[720px]:grid-cols-1">
        <Row label="GITHUB REPO" extra={<OpenLink url={form.repoUrl} />}>
          <input
            id="f-repo"
            className={field}
            maxLength={500}
            value={form.repoUrl}
            disabled={locked}
            placeholder="https://github.com/you/project"
            onChange={(e) => set({ repoUrl: e.target.value })}
          />
        </Row>
        <Row label="DEMO / PLAYABLE LINK" extra={<OpenLink url={form.demoUrl} />}>
          <input
            className={field}
            maxLength={10000}
            value={form.demoUrl}
            disabled={locked}
            placeholder="https://..."
            onChange={(e) => set({ demoUrl: e.target.value })}
          />
        </Row>
      </div>
      <Row label="THUMBNAIL (required to ship)">
        <FileButton
          kind="image"
          disabled={locked}
          label={form.imageUrl ? "REPLACE IMAGE" : "CHOOSE IMAGE"}
          onUploaded={(url) => set({ imageUrl: url })}
        />
        <span className={hint()}>PNG, JPG or WebP, up to 15MB. You can also paste an image while not typing in a field. Preview shows at the top.</span>
      </Row>
      <Row label="KIND">
        <select
          className={selectField}
          value={form.kind}
          disabled={locked}
          onChange={(e) => set({ kind: e.target.value === "hardware" ? "hardware" : "software" })}
        >
          <option value="software">Software</option>
          <option value="hardware">Hardware</option>
        </select>
        {form.kind === "hardware" ? (
          <span className={hint()}>Hardware hours come from your journal (and Hackatime if you code firmware).</span>
        ) : null}
      </Row>
      <HardwareFields form={form} set={set} projectId={projectId} locked={locked} usdPerHour={usdPerHour} />
      <Row label="TRIAL (build for a Trial, or your own idea)">
        <select
          className={selectField}
          value={form.sidequestId}
          disabled={locked}
          onChange={(e) => set({ sidequestId: e.target.value })}
        >
          <option value="">None, my own idea</option>
          {linkedMissing ? <option value={String(linkedId)}>{linkedTrialName || "Linked Trial"}</option> : null}
          {accepted.length ? (
            <optgroup label="Accepted, ready to build">
              {accepted.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          {lockedTrials.length ? (
            <optgroup label="Not accepted, accept in-game first">
              {lockedTrials.map((t) => (
                <option key={t.id} value={String(t.id)} disabled>
                  {t.name} (locked)
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </Row>
      <Row label="TYPE (helps reviewers know how to run it)">
        <select className={selectField} value={form.projectType} disabled={locked} onChange={(e) => set({ projectType: e.target.value })}>
          {PROJECT_TYPES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Row>
      <Disclosure
        checked={form.isGame}
        onChange={(value) => set({ isGame: value })}
        disabled={locked}
        label="This project is a game"
        desc="Adds a Games category for reviewers. Your platform/type and Software or Hardware review track stay the same."
      />
      <Row label="TIER (your call, the reviewer confirms it)">
        <select className={selectField} value={form.level} disabled={locked} onChange={(e) => set({ level: Number(e.target.value) })}>
          {LEVELS.map(([name], i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
        <span className={hint()}>{LEVELS[Math.min(Math.max(form.level - 1, 0), LEVELS.length - 1)][1]}</span>
      </Row>
      <Row label="HACKATIME PROJECTS (proof of hours)">
        <HtPicker stats={stats} value={form.hackatime} onChange={(v) => set({ hackatime: v })} disabled={locked} returnTo={returnTo} />
      </Row>
      <Disclosure
        checked={form.usedAi}
        onChange={(v) => set({ usedAi: v })}
        disabled={locked}
        label="I used AI on this project"
        desc="Tick this if AI was part of your workflow. Be honest and specific: heavy AI use without your own polish gets rejected. Only you and reviewers see this."
      >
        <Row label="WHAT DID YOU USE AI FOR? *">
          <CountedTextarea value={form.aiNotes} onChange={(v) => set({ aiNotes: v })} max={2000} disabled={locked} placeholder="Which parts, which tools, how much..." />
        </Row>
      </Disclosure>
      <Disclosure
        checked={form.isUpdate || form.otherYsws}
        onChange={(v) => set({ otherYsws: v })}
        disabled={locked || form.isUpdate}
        label="This is an update"
        desc={
          form.isUpdate
            ? "You already shipped this project, so this counts as an update. Tell reviewers what you added or changed since the last approval: required to ship, and they'll only credit the new work."
            : "Tick this if you already shipped this project, here or in another Hack Club YSWS, and you're shipping it again as an update. Tell reviewers what's new: they'll only credit the new work."
        }
      >
        <Row label="WHAT DID YOU CHANGE? *">
          <CountedTextarea
            value={form.isUpdate ? form.updateNotes : form.otherYswsNotes}
            onChange={(v) => set(form.isUpdate ? { updateNotes: v, ...(form.otherYsws ? { otherYswsNotes: v } : {}) } : { otherYswsNotes: v })}
            max={form.isUpdate && !form.otherYsws ? 8000 : 2000}
            disabled={locked}
            placeholder="Describe the new work since the last submission (min 100 characters)."
          />
        </Row>
      </Disclosure>
      <div className="flex flex-wrap gap-2">
        <Button id="f-save" disabled={locked || saving} onClick={onSave}>
          {locked ? "IN REVIEW: CAN'T EDIT" : saving ? "SAVING..." : saveLabel}
        </Button>
        <a className={buttonVariants({ variant: "dark" })} href="/projects">
          CANCEL
        </a>
      </div>
    </div>
  );
}
