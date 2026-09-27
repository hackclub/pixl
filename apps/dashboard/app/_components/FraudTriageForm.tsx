"use client";

import { useRef, useState } from "react";
import { submitFraudTriage } from "@/app/actions";
import { PendingButton } from "@/app/_components/PendingButton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { TECHNICAL_FEATURES_MIN } from "@/lib/auditNote";

// The second-pass fraud triage step - deliberately lighter than the full
// review form (no tier, no player-facing verdict copy): a note, an optional
// hours deflation if there's a lot of AI use, the first pass's own internal
// audit note (technical features / Hackatime evidence / age justification /
// additional notes) prefilled but still fully editable, and a Fraud / Not
// fraud call. Fraud bans immediately; Not fraud parks it for a super's real
// verdict in Spot check - see submitFraudTriage in app/actions.ts.
export function FraudTriageForm({
  projectId,
  claimedHours,
  defaultHours,
  hackatimeSeconds = 0,
  ageFlag = false,
  firstPass,
}: {
  projectId: number;
  claimedHours: number;
  defaultHours: number;
  hackatimeSeconds?: number;
  ageFlag?: boolean;
  /** The first pass's own audit note, so the fraud-triage reviewer starts
   * from what was already written instead of a blank form. */
  firstPass?: {
    technicalFeatures: string;
    hackatimeEvidence: string;
    ageJustification: string;
    notes: string;
  };
}) {
  const [hours, setHours] = useState(defaultHours);
  const [featuresLen, setFeaturesLen] = useState(firstPass?.technicalFeatures.trim().length ?? 0);
  const [error, setError] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const deflationReasonRef = useRef<HTMLTextAreaElement>(null);
  const technicalFeaturesRef = useRef<HTMLTextAreaElement>(null);
  const ageJustificationRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const deflated = hours < claimedHours;
  // defaultHours is already first_pass_hours when the first pass lowered it
  // (see formDefaultHours in review/[id]/page.tsx) - compare against the full
  // claimed total so the reviewer sees that cut before deciding anything
  // else, not just the already-lowered number sitting in the input.
  const firstPassDeflated = defaultHours < claimedHours;

  const validate = (verdict: string): boolean => {
    if ((technicalFeaturesRef.current?.value.trim().length ?? 0) < TECHNICAL_FEATURES_MIN) {
      setError(`Describe concrete technical features you checked (min ${TECHNICAL_FEATURES_MIN} characters).`);
      return false;
    }
    if (ageFlag && !ageJustificationRef.current?.value.trim()) {
      setError("Age justification is required before deciding.");
      return false;
    }
    if (!notesRef.current?.value.trim()) {
      setError("Additional notes are required.");
      return false;
    }
    if (!noteRef.current?.value.trim()) {
      setError("A note is required for either verdict.");
      return false;
    }
    if (verdict === "not_fraud" && deflated && !deflationReasonRef.current?.value.trim()) {
      setError("Explain why the hours were lowered.");
      return false;
    }
    setError("");
    return true;
  };

  return (
    <form action={submitFraudTriage} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <Label className="flex flex-col gap-1.5 font-normal">
        <span className="text-xs text-muted-foreground">
          Credited hours (claimed: {claimedHours}h
          {firstPassDeflated ? `, first pass credited ${defaultHours}h` : ""})
        </span>
        <Input
          name="approvedHours"
          type="number"
          min="0"
          step="0.1"
          value={hours}
          onChange={(e) => setHours(Math.max(0, Number(e.target.value) || 0))}
          className="text-sm max-w-32"
        />
      </Label>
      {deflated && (
        <Label className="flex flex-col gap-1.5 font-normal">
          <span className="text-xs text-muted-foreground">
            Why lower the hours? ({claimedHours}h claimed → {hours}h)
          </span>
          <Textarea
            name="deflationReason"
            ref={deflationReasonRef}
            required
            rows={2}
            placeholder="e.g. a lot of this looks AI-generated, tracked time doesn't match the diff…"
            className="text-sm"
          />
        </Label>
      )}
      <div className="rounded-lg border p-3 flex flex-col gap-3">
        <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground leading-relaxed">
          Internal audit note , from the first pass, still fully editable
        </div>
        <Label className="flex flex-col gap-1.5 font-normal">
          <span className="text-xs text-muted-foreground">Technical features</span>
          <div className="relative">
            <Textarea
              name="technicalFeatures"
              required
              minLength={TECHNICAL_FEATURES_MIN}
              ref={technicalFeaturesRef}
              defaultValue={firstPass?.technicalFeatures}
              onChange={(e) => setFeaturesLen(e.target.value.trim().length)}
              placeholder="What did you actually check in the repo/demo?"
              className="w-full text-sm pb-5"
              rows={3}
            />
            <span
              className={`pointer-events-none absolute bottom-1.5 right-2 text-[10px] tabular-nums ${
                featuresLen >= TECHNICAL_FEATURES_MIN ? "text-emerald-500" : "text-muted-foreground"
              }`}
            >
              {featuresLen}/{TECHNICAL_FEATURES_MIN}
            </span>
          </div>
        </Label>
        {hackatimeSeconds > 0 && (
          <Label className="flex flex-col gap-1.5 font-normal">
            <span className="text-xs text-muted-foreground">Hackatime evidence</span>
            <Textarea
              name="hackatimeEvidence"
              defaultValue={firstPass?.hackatimeEvidence}
              rows={3}
              className="text-sm"
            />
          </Label>
        )}
        {ageFlag && (
          <Label className="flex flex-col gap-1.5 font-normal">
            <span className="text-xs text-muted-foreground">
              Age justification , this submitter turns 19 between shipping and this review
            </span>
            <Textarea
              name="ageJustification"
              required
              ref={ageJustificationRef}
              defaultValue={firstPass?.ageJustification}
              placeholder="Document the submitter's age at shipping vs. now."
              rows={3}
              className="text-sm"
            />
          </Label>
        )}
        <Label className="flex flex-col gap-1.5 font-normal">
          <span className="text-xs text-muted-foreground">Additional notes</span>
          <Textarea
            name="notes"
            required
            ref={notesRef}
            defaultValue={firstPass?.notes}
            placeholder="Anything else , suspicious commits, AI usage, experience mismatch…"
            rows={3}
            className="text-sm"
          />
        </Label>
      </div>
      <Label className="flex flex-col gap-1.5 font-normal">
        <span className="text-xs text-muted-foreground">Note (for the super doing Spot check)</span>
        <Textarea
          name="note"
          ref={noteRef}
          required
          rows={3}
          placeholder="What did you check, and why this call?"
          className="text-sm"
        />
      </Label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2 flex-wrap">
        <PendingButton
          name="verdict"
          value="not_fraud"
          pendingText="Saving…"
          className="bg-emerald-600 text-white hover:bg-emerald-700"
          onClick={(e) => {
            if (!validate("not_fraud")) e.preventDefault();
          }}
        >
          Not fraud
        </PendingButton>
        <PendingButton
          name="verdict"
          value="fraud"
          pendingText="Banning…"
          variant="outline"
          className="border-red-700 text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
          confirm="Ban this project as fraud? This is immediate and permanent."
          onClick={(e) => {
            if (!validate("fraud")) e.preventDefault();
          }}
        >
          Fraud
        </PendingButton>
      </div>
    </form>
  );
}
