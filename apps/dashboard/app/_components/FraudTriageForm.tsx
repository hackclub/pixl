"use client";

import { useRef, useState } from "react";
import { submitFraudTriage } from "@/app/actions";
import { PendingButton } from "@/app/_components/PendingButton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

// The second-pass fraud triage step - deliberately lighter than the full
// review form (no tier, no technical-features audit trail, no age
// justification): a note, an optional hours deflation if there's a lot of AI
// use, and a Fraud / Not fraud call. Fraud bans immediately; Not fraud parks
// it for a super's real verdict in Spot check - see submitFraudTriage in
// app/actions.ts.
export function FraudTriageForm({
  projectId,
  claimedHours,
  defaultHours,
}: {
  projectId: number;
  claimedHours: number;
  defaultHours: number;
}) {
  const [hours, setHours] = useState(defaultHours);
  const [error, setError] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const deflationReasonRef = useRef<HTMLTextAreaElement>(null);
  const deflated = hours < claimedHours;

  const validate = (verdict: string): boolean => {
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
          Credited hours (claimed: {claimedHours}h)
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
