"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ComponentPropsWithRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { REVIEW_MACROS, expandMacro } from "@/lib/reviewMacros";
import {
  reviewProject,
  applySubmissionEdits,
  setProjectLevel,
  generateAiReviewDraftAction,
  saveReviewDraft,
} from "@/app/actions";
import type { AiReviewDraft } from "@/lib/aiReview";
import {
  averageUsdPerHourOver,
  config,
  levelForRe,
  projectPayoutPx,
  pxPerHourOver,
  reForHours,
  rePerHour,
} from "@/app/_generated/config";
import { TECHNICAL_FEATURES_MIN } from "@/lib/auditNote";
import { BlackoutReviewSection, type BlackoutReviewData } from "@/app/_components/BlackoutReviewSection";
import { Badge, Button, Callout, Checkbox, Details, Field, formatDateTime, Input, NativeSelect, Textarea } from "@/app/_ui/ui";
import { actionErrorMessage, isStaleDeployError } from "@/app/_ui/actionError";

export interface BountyOption {
  id: number;
  name: string;
  reward: number;
  description: string;
}

export interface TrialInfo {
  name: string;
  minHours: number | null;
}

export interface CollaboratorHours {
  id: number;
  name: string;
  claimedHours: number;
}

type Step = 1 | 2 | 3;
type Draft = Record<string, string | number>;

const TIERS = [
  { value: 1, label: "T1 Spark", blurb: "A simple site, script, or tiny tool" },
  { value: 2, label: "T2 Signal", blurb: "A focused app, CLI, or game with clean polish" },
  { value: 3, label: "T3 Grid", blurb: "Multiple systems together: backend, state, infra" },
  { value: 4, label: "T4 Nexus", blurb: "Deep systems work, serious scope" },
];

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: "Submission" },
  { n: 2, label: "Audit notes" },
  { n: 3, label: "Verdict" },
];

// Friendly names for the browser's own validation messages, see onVerdictSelect.
const FIELD_LABEL: Record<string, string> = {
  approvedHours: "Hours to credit",
  technicalFeatures: "Technical features",
  deflationReason: "Why lower the hours?",
  ageJustification: "Age justification",
  notes: "Additional notes",
  note: "Note to the player",
};

function fieldLabel(name: string): string {
  if (name.startsWith("collabHours_")) return "Collaborator hours";
  if (name.startsWith("blackoutHours_")) return "Approved Blackout hours";
  return FIELD_LABEL[name] ?? name;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// The kit's Textarea drops refs; the audit fields need them for the draft restore.
function AuditTextarea(props: ComponentPropsWithRef<"textarea">) {
  return <textarea className="hc-textarea" {...props} />;
}

// The ?error= message of a redirect() an action threw, or null for any other
// error (including a redirect onward to the next project).
function bouncedError(err: unknown): string | null {
  const digest = err && typeof err === "object" && "digest" in err ? err.digest : null;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) return null;
  const target = digest.split(";").slice(2, -2).join(";");
  try {
    return new URL(target, window.location.href).searchParams.get("error");
  } catch {
    return null;
  }
}

function PayoutRow({ label, value, strong = false }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className={strong ? "font-bold" : "hc-muted"}>{label}</span>
      <span className={strong ? "font-bold" : ""}>{value}</span>
    </div>
  );
}

/**
 * The tier picker plus every conversion it implies, worked out live so a
 * reviewer never has to do the arithmetic: hours at this tier become RE,
 * that RE moves the player along the payout ramp on top of their existing
 * lifetime RE (RE is player-specific and banked forever, not reset per
 * project), and the rate averaged across that move times the hours is the
 * payout. Numbers come from packages/config, and the maths mirrors
 * creditBeneficiary exactly - if these two ever disagree, the reviewer is
 * being shown a number the player won't receive.
 */
function TierAndPayout({
  hours,
  tier,
  onTier,
  savedTier,
  projectId,
  playerReBefore,
  forTrial,
  trialMinHours,
  trialName,
  fundingUsd = 0,
}: {
  hours: number;
  tier: number;
  onTier: (t: number) => void;
  /** The tier persisted on the project right now, so "Set" only shows for an unsaved pick. */
  savedTier: number;
  projectId: number;
  playerReBefore: number;
  forTrial: boolean;
  trialMinHours?: number | null;
  trialName?: string;
  /** Hardware funding grant, deducted from the payout like creditBeneficiary's fundingPx. */
  fundingUsd?: number;
}) {
  const [regrading, startRegrade] = useTransition();
  const [regradeError, setRegradeError] = useState("");
  const perHour = rePerHour(tier);
  const hoursRe = reForHours(hours, tier);
  const trialBonusRe = forTrial ? config.economy.trialBonusRe : 0;
  const reAfter = playerReBefore + hoursRe + trialBonusRe;
  // Hours-based RE only: the flat Trial bonus counts toward level and the vault
  // but deliberately never moves the payout rate, same as creditBeneficiary.
  const rate = pxPerHourOver(playerReBefore, playerReBefore + hoursRe);
  const usdRate = averageUsdPerHourOver(playerReBefore, playerReBefore + hoursRe);
  const px = Math.round(hours * rate);
  const usd = px * config.economy.pixelValueUsd;
  const levelBefore = levelForRe(playerReBefore);
  const levelAfter = levelForRe(reAfter);
  // Same split reviewProject computes server-side: the prize "buys" the first
  // min_hours, everything past that is paid in pixels either way. Estimated
  // without any community-goal multiplier (not known client-side).
  const trialPrizePx =
    forTrial && trialMinHours != null && trialMinHours > 0
      ? Math.min(Math.max(Math.round(projectPayoutPx(trialMinHours, tier, 0)), 0), px)
      : 0;
  const trialBeyondPx = Math.max(px - trialPrizePx, 0);
  // Mirrors creditBeneficiary's fundingPx: the grant comes out of this payout
  // at today's rate, capped so it can't go negative.
  const fundingPx = fundingUsd > 0 ? Math.min(Math.round(fundingUsd / config.economy.pixelValueUsd), px) : 0;
  const netPx = px - fundingPx;
  const netUsd = netPx * config.economy.pixelValueUsd;

  const regrade = () => {
    const fd = new FormData();
    fd.set("projectId", String(projectId));
    fd.set("level", String(tier));
    setRegradeError("");
    startRegrade(async () => {
      try {
        await setProjectLevel(fd);
        // A saved tier always redirects back to this page; landing here means it bailed out.
        setRegradeError("The tier wasn't saved. Reload the page and try again.");
      } catch (e) {
        setRegradeError(actionErrorMessage(e, "save the tier"));
      }
    });
  };

  return (
    <div className="hc-panel flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="hc-label">Tier</span>
        <span className="flex items-center gap-2">
          <NativeSelect value={tier} onChange={(e) => onTier(Number(e.target.value))} aria-label="Tier">
            {TIERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label} · {rePerHour(t.value)} RE/h
              </option>
            ))}
          </NativeSelect>
          {tier !== savedTier && (
            <Button type="button" variant="outline" size="sm" disabled={regrading} onClick={regrade}>
              {regrading ? "Saving…" : "Set"}
            </Button>
          )}
        </span>
      </div>
      <p className="hc-caption text-xs">{TIERS[Math.min(Math.max(tier, 1), 4) - 1].blurb}</p>
      {regradeError && <Callout tone="danger" icon="important">{regradeError}</Callout>}

      {/* The breakdown is collapsed by default; the summary keeps the number
          that matters (what the player actually gets) visible. */}
      <Details
        summary={
          <span className="tabular-nums">
            Payout: {netPx.toLocaleString()} px · ${netUsd.toFixed(2)}
            {forTrial && " (held for Trial)"}
          </span>
        }
      >
        <div className="flex flex-col gap-1 text-sm tabular-nums">
          <PayoutRow
            label={`This project · ${hours}h × ${perHour} RE/h`}
            value={`${round1(hoursRe).toLocaleString()} RE`}
          />
          {trialBonusRe > 0 && (
            <PayoutRow label="Trial bonus (flat, every Trial)" value={`+${trialBonusRe.toLocaleString()} RE`} />
          )}
          <PayoutRow
            label="Their RE before → after"
            value={`${round1(playerReBefore).toLocaleString()} → ${round1(reAfter).toLocaleString()}`}
          />
          <PayoutRow
            label="Their level before → after"
            value={
              <>
                {levelBefore} → {levelAfter}
                {levelAfter > levelBefore && <span className="text-[var(--hc-green)]"> ▲</span>}
              </>
            }
          />
          <PayoutRow
            label="Rate (averaged over this ship)"
            value={`${Math.round(rate)} px/h · $${usdRate.toFixed(2)}/h`}
          />
          <div className="border-t border-[var(--border)] pt-1">
            <PayoutRow strong label="Payout" value={`${px.toLocaleString()} px · $${usd.toFixed(2)}`} />
          </div>
          {forTrial && trialPrizePx > 0 && (
            <>
              <PayoutRow
                label={`"${trialName}" prize · first ${trialMinHours}h`}
                value={`≈${trialPrizePx.toLocaleString()} px`}
              />
              <PayoutRow label="+ pixels for hours beyond that" value={`${trialBeyondPx.toLocaleString()} px`} />
            </>
          )}
          {forTrial && (
            <p className="hc-caption pt-1 text-xs">
              Trial ship: this payout is held, not credited.{" "}
              {trialPrizePx > 0
                ? `Once you approve it, the maker keeps the prize (worth ≈${trialPrizePx.toLocaleString()} px) plus the ${trialBeyondPx.toLocaleString()} px for hours beyond the minimum by default, or can skip the prize for all ${px.toLocaleString()} px instead.`
                : "The maker picks the Trial reward or these pixels once you approve it, and only gets the one they pick."}
            </p>
          )}
          {fundingPx > 0 && (
            <>
              <PayoutRow
                label={`Hardware funding grant ($${fundingUsd.toFixed(2)})`}
                value={`-${fundingPx.toLocaleString()} px`}
              />
              <div className="border-t border-[var(--border)] pt-1">
                <PayoutRow
                  strong
                  label="They actually get"
                  value={`${netPx.toLocaleString()} px · $${netUsd.toFixed(2)}`}
                />
              </div>
              <p className="hc-caption pt-1 text-xs">
                The ${fundingUsd.toFixed(2)} funding grant comes out of this payout instead of their wallet, so
                approving credits {netPx.toLocaleString()} px, not {px.toLocaleString()}.
              </p>
            </>
          )}
        </div>
        <p className="hc-caption text-xs">
          Changing the tier here re-grades it as soon as you click Set, same as the Re-grade tier control above. It
          doesn&apos;t wait for your verdict. Community-goal bonuses and any referral boost apply on top and aren&apos;t
          shown.
        </p>
      </Details>
    </div>
  );
}

function InlineNumber({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-wrap items-center justify-between gap-3">
      <span className="hc-label">
        {label}
        {hint && <span className="hc-label-hint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function CollaboratorHoursInput({ c }: { c: CollaboratorHours }) {
  const [value, setValue] = useState(c.claimedHours);
  return (
    <InlineNumber label={`${c.name}'s hours to credit`} hint="Decrease only">
      <Input
        name={`collabHours_${c.id}`}
        type="number"
        step="0.1"
        min="0"
        max={c.claimedHours}
        value={value}
        onChange={(e) => setValue(Math.min(c.claimedHours, Math.max(0, Number(e.target.value) || 0)))}
        className="w-28"
      />
    </InlineNumber>
  );
}

function VerdictButtons({
  secondPass,
  pendingVerdict,
  onVerdictSelect,
  onBack,
}: {
  secondPass: boolean;
  /** The verdict currently being submitted, or null when idle. */
  pendingVerdict: string | null;
  /** Runs on click, before the browser's own validation, and can cancel the submit. */
  onVerdictSelect: (verdict: string) => boolean;
  onBack: () => void;
}) {
  const busy = pendingVerdict !== null;
  const select = (verdict: string, e: React.MouseEvent) => {
    if (!onVerdictSelect(verdict)) e.preventDefault();
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" onClick={onBack} disabled={busy}>
        ← Back
      </Button>
      <Button
        type="submit"
        name="verdict"
        value="approved"
        variant="success"
        disabled={busy}
        onClick={(e) => select("approved", e)}
      >
        {pendingVerdict === "approved" ? "Approving…" : secondPass ? "Approve & credit pixels" : "Approve"}
      </Button>
      <Button type="submit" name="verdict" value="needs_changes" disabled={busy} onClick={(e) => select("needs_changes", e)}>
        {pendingVerdict === "needs_changes" ? "Sending back…" : "Request changes"}
      </Button>
      <Button type="submit" name="verdict" value="ban" variant="danger" disabled={busy} onClick={(e) => select("ban", e)}>
        {pendingVerdict === "ban"
          ? secondPass
            ? "Banning…"
            : "Perm rejecting…"
          : secondPass
            ? "Ban project"
            : "Perm reject project"}
      </Button>
    </div>
  );
}

// Title/image/links/description edits. Applies on its own, independent of the
// verdict form below.
function EditSubmission({
  projectId,
  repoUrl,
  demoUrl,
  currentName,
  currentDescription,
  currentImageUrl,
}: {
  projectId: number;
  repoUrl: string | null;
  demoUrl: string | null;
  currentName?: string;
  currentDescription?: string | null;
  currentImageUrl?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget);
    setResult(null);
    startTransition(async () => {
      try {
        await applySubmissionEdits(fd);
        if (fileRef.current) fileRef.current.value = "";
        setResult({ ok: true, text: "Saved. The project is updated everywhere." });
      } catch (err) {
        setResult({ ok: false, text: actionErrorMessage(err, "apply these edits") });
      }
    });
  };

  return (
    <Details summary="Edit submission: title, image, repo and demo links, description">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <p className="hc-caption text-xs">
          Applies immediately and updates the project everywhere: the player&apos;s own page, the next reviewer who
          opens this, and the YSWS/Airtable export. Independent of your verdict below.
        </p>
        <input type="hidden" name="projectId" value={projectId} />
        <Field label="Title">
          <Input name="editedName" defaultValue={currentName ?? ""} maxLength={200} />
        </Field>
        <Field label="Replace image" hint="Optional. Leave empty to keep the current one.">
          {currentImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentImageUrl}
              alt=""
              className="h-20 w-auto self-start rounded border border-[var(--border)] object-cover"
            />
          )}
          <input
            ref={fileRef}
            name="editedImage"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hc-file"
          />
        </Field>
        <Field label="Repo URL">
          <Input name="editedRepoUrl" defaultValue={repoUrl ?? ""} placeholder="https://github.com/…" />
        </Field>
        <Field label="Demo URL">
          <Input name="editedDemoUrl" defaultValue={demoUrl ?? ""} placeholder="https://…" />
        </Field>
        <Field label="Description">
          <Textarea name="editedDescription" defaultValue={currentDescription ?? ""} maxLength={5000} rows={4} />
        </Field>
        {result && (
          <Callout tone={result.ok ? "success" : "danger"} icon={result.ok ? "checkmark" : "important"}>
            {result.text}
          </Callout>
        )}
        <div>
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? "Applying…" : "Apply changes"}
          </Button>
        </div>
      </form>
    </Details>
  );
}

export function ReviewForm({
  projectId,
  repoUrl,
  demoUrl,
  claimedHours,
  defaultHours,
  journalDeflatedHours = 0,
  secondPass = false,
  bounties = [],
  trial,
  ageFlag = false,
  collaborators = [],
  blackout = null,
  tier = 1,
  playerReBefore = 0,
  fundingUsd = 0,
  firstPass,
  currentName,
  currentDescription,
  currentImageUrl,
  isSuper = false,
  canEditSubmission = false,
  serverDraft,
}: {
  projectId: number;
  repoUrl: string | null;
  demoUrl: string | null;
  claimedHours: number;
  defaultHours?: number;
  /** Hours the credited total already lost to per-journal-entry deflation
   * (Journals tab / setJournalHours), shown apart from what this form lowers. */
  journalDeflatedHours?: number;
  secondPass?: boolean;
  bounties?: BountyOption[];
  trial?: TrialInfo | null;
  ageFlag?: boolean;
  collaborators?: CollaboratorHours[];
  /** Operation Blackout entry awaiting a ruling, when this project has one. */
  blackout?: BlackoutReviewData | null;
  /** The project's current tier (1-4). */
  tier?: number;
  /** The player's lifetime RE excluding this project - what sets their rate. */
  playerReBefore?: number;
  /** Hardware funding grant requested on this project (0 if none/not hardware). */
  fundingUsd?: number;
  /** The first pass's own audit note + player note, so the final reviewer
   * starts from what was already written instead of a blank form. */
  firstPass?: {
    technicalFeatures: string;
    deflationReason: string;
    ageJustification: string;
    notes: string;
    note: string;
  };
  currentName?: string;
  currentDescription?: string | null;
  currentImageUrl?: string | null;
  /** Owner: gates the "Generate AI draft" button (shown to everyone, clickable for owners). */
  isSuper?: boolean;
  /** Whether the viewer may edit the submission's details at any review stage. */
  canEditSubmission?: boolean;
  /** The shared server-side draft (saveReviewDraft). Used only when this
   * browser has no local draft of its own to restore. */
  serverDraft?: {
    draft: Draft | null;
    by: string;
    at: string | null;
  };
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const repoOpened = useRef<HTMLInputElement>(null);
  const demoOpened = useRef<HTMLInputElement>(null);
  const repoSeconds = useRef<HTMLInputElement>(null);
  const demoSeconds = useRef<HTMLInputElement>(null);
  const totalSeconds = useRef<HTMLInputElement>(null);
  const away = useRef<{ kind: "repo" | "demo"; at: number } | null>(null);
  // Review time only counts while this tab is the one the reviewer is looking
  // at: visible AND the window focused (alt-tabbing to another app keeps the
  // tab "visible"). activeMs sums finished stretches; visibleSince is when the
  // current one started (null while away).
  const activeMs = useRef(0);
  const visibleSince = useRef<number | null>(null);
  const isActiveNow = () =>
    typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();
  const submittedRef = useRef(false);

  const baseHours = defaultHours ?? claimedHours;
  const [hours, setHours] = useState(baseHours);
  const [tierState, setTierState] = useState(tier);
  const deflated = hours < claimedHours;
  // claimedHours is already post-journal-deflation (payoutHours on the page),
  // so a journal-only deflation would leave `deflated` false and skip the
  // required reason. Count journal-level deflation too, and show the true
  // pre-journal total in the label.
  const needsDeflationReason = deflated || journalDeflatedHours > 0;
  const rawClaimedHours = round1(claimedHours + journalDeflatedHours);

  // Deflating a journal entry revalidates this page without remounting, so
  // `hours` (seeded once from baseHours) would go stale. Re-sync whenever
  // baseHours changes, unless the reviewer already typed their own value.
  const hoursEditedRef = useRef(false);
  useEffect(() => {
    if (!hoursEditedRef.current) setHours(baseHours);
  }, [baseHours]);

  // The audit note is the one hard-to-redo part of a review, so it autosaves
  // to localStorage (this browser) and, debounced, to the project itself (any
  // reviewer, any device). The local copy is only cleared once a submit
  // actually navigated away, see the unmount effect below.
  const draftKey = `pixl-review-draft-${projectId}`;
  const technicalFeaturesRef = useRef<HTMLTextAreaElement>(null);
  const deflationReasonRef = useRef<HTMLTextAreaElement>(null);
  const ageJustificationRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const pendingDraft = useRef<Draft | null>(null);
  const [draftSource, setDraftSource] = useState<"local" | "server" | "firstPass" | null>(null);
  const [featuresLen, setFeaturesLen] = useState(0);
  const [serverSave, setServerSave] = useState<"idle" | "saving" | "saved" | "error" | "stale">("idle");
  const staleDeploy = useRef(false);

  const pushServerDraft = (draft: Draft) => {
    // A deploy happened while this tab was open: its action ids no longer
    // exist, so every further save would fail the same way (one per keystroke).
    // Stop trying and ask for a reload instead; the local copy carries over.
    if (staleDeploy.current) return;
    setServerSave("saving");
    saveReviewDraft(projectId, draft)
      .then(() => setServerSave("saved"))
      // Best-effort: the localStorage copy is unaffected either way.
      .catch((e: unknown) => {
        const stale = isStaleDeployError(e);
        staleDeploy.current = stale;
        setServerSave(stale ? "stale" : "error");
      });
  };

  useEffect(() => {
    let draft: Draft | null = null;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) draft = JSON.parse(raw);
    } catch {
      draft = null;
    }
    if (draft) {
      setDraftSource("local");
      // Push it to the server right away, so a restored draft the reviewer
      // never edits again still reaches whoever does the real pass.
      pushServerDraft(draft);
    } else if (serverDraft?.draft) {
      // Someone else (or this reviewer on another device) already started.
      draft = { ...serverDraft.draft };
      setDraftSource("server");
    } else if (firstPass) {
      // Start from what the first reviewer wrote. Still fully editable.
      draft = { ...firstPass };
      setDraftSource("firstPass");
    }
    if (!draft) return;
    if (typeof draft.technicalFeatures === "string" && technicalFeaturesRef.current) {
      technicalFeaturesRef.current.value = draft.technicalFeatures;
      setFeaturesLen(draft.technicalFeatures.trim().length);
    }
    if (typeof draft.ageJustification === "string" && ageJustificationRef.current)
      ageJustificationRef.current.value = draft.ageJustification;
    if (typeof draft.notes === "string" && notesRef.current) notesRef.current.value = draft.notes;
    if (typeof draft.note === "string" && noteRef.current) noteRef.current.value = draft.note;
    // The deflation reason box only renders once `deflated` is true, which
    // depends on the hours this draft is about to set, so fill it in later.
    pendingDraft.current = draft;
    // A saved `hours` is only trustworthy if the server baseline it was
    // measured against hasn't moved (a journal deflation since then would be
    // silently undone otherwise).
    if (typeof draft.hours === "number" && draft.baseHours === baseHours) {
      hoursEditedRef.current = true;
      setHours(draft.hours);
    }
    if (typeof draft.tier === "number") setTierState(draft.tier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const draft = pendingDraft.current;
    if (!draft) return;
    if (typeof draft.deflationReason === "string" && deflationReasonRef.current) {
      deflationReasonRef.current.value = draft.deflationReason;
      pendingDraft.current = null;
    }
  }, [needsDeflationReason]);

  // Callers that just called setHours/setTierState pass the new value, since
  // state hasn't updated yet inside the same handler.
  const serverDraftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveDraft = (overrides?: { hours?: number; tier?: number }) => {
    const snapshot = {
      hours: overrides?.hours ?? hours,
      baseHours,
      tier: overrides?.tier ?? tierState,
      technicalFeatures: technicalFeaturesRef.current?.value ?? "",
      deflationReason: deflationReasonRef.current?.value ?? "",
      ageJustification: ageJustificationRef.current?.value ?? "",
      notes: notesRef.current?.value ?? "",
      note: noteRef.current?.value ?? "",
    };
    try {
      localStorage.setItem(draftKey, JSON.stringify(snapshot));
    } catch {
      // Storage full or blocked: the review still works, it just can't be recovered.
    }
    // Debounced so a fast typist doesn't fire a server write per keystroke.
    if (serverDraftTimer.current) clearTimeout(serverDraftTimer.current);
    serverDraftTimer.current = setTimeout(() => pushServerDraft(snapshot), 1000);
  };

  const clearDraft = () => {
    if (serverDraftTimer.current) clearTimeout(serverDraftTimer.current);
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
  };

  // AI-drafted notes (owner-only, see generateAiReviewDraftAction): a starting
  // point the reviewer reads and edits, never submitted on its own.
  const [aiPending, startAiTransition] = useTransition();
  const [aiDraft, setAiDraft] = useState<AiReviewDraft | null>(null);
  const [aiError, setAiError] = useState("");

  const runAiDraft = () => {
    setAiError("");
    startAiTransition(async () => {
      try {
        // The hours typed in the form, so the deflation draft explains the
        // number the reviewer already picked.
        setAiDraft(await generateAiReviewDraftAction(projectId, hours));
      } catch (e) {
        setAiError(actionErrorMessage(e, "generate a draft"));
      }
    });
  };

  const insertAiText = (field: "technicalFeatures" | "deflationReason" | "notes", text: string) => {
    const ref =
      field === "technicalFeatures" ? technicalFeaturesRef : field === "deflationReason" ? deflationReasonRef : notesRef;
    if (!ref.current || !text) return;
    ref.current.value = text;
    if (field === "technicalFeatures") setFeaturesLen(text.trim().length);
    saveDraft();
  };

  // 3-step wizard over this one form. Steps are hidden, never unmounted, so
  // refs and the draft restore keep working whichever step is visible.
  const [step, setStep] = useState<Step>(1);
  const [stepError, setStepError] = useState("");
  const goToStep = (n: Step) => {
    setStep(n);
    setStepError("");
  };

  useEffect(() => {
    // Fresh accumulator per mount: a remount without a page load would
    // otherwise inherit a stale total.
    activeMs.current = 0;
    visibleSince.current = isActiveNow() ? Date.now() : null;
    const trackActiveTime = () => {
      const activeNow = isActiveNow();
      if (activeNow && visibleSince.current === null) {
        visibleSince.current = Date.now();
      } else if (!activeNow && visibleSince.current !== null) {
        activeMs.current += Date.now() - visibleSince.current;
        visibleSince.current = null;
      }
    };
    const settle = () => {
      const a = away.current;
      if (!a || document.visibilityState !== "visible") return;
      away.current = null;
      const el = a.kind === "repo" ? repoSeconds.current : demoSeconds.current;
      if (el) el.value = String(Math.round(Number(el.value || 0) + (Date.now() - a.at) / 1000));
    };
    window.addEventListener("focus", settle);
    document.addEventListener("visibilitychange", settle);
    window.addEventListener("focus", trackActiveTime);
    window.addEventListener("blur", trackActiveTime);
    document.addEventListener("visibilitychange", trackActiveTime);
    return () => {
      window.removeEventListener("focus", settle);
      document.removeEventListener("visibilitychange", settle);
      window.removeEventListener("focus", trackActiveTime);
      window.removeEventListener("blur", trackActiveTime);
      document.removeEventListener("visibilitychange", trackActiveTime);
    };
  }, []);

  // Clear the local draft only when a submit actually navigated somewhere
  // else. A request that dies mid-flight (a redeploy) can still force a reload
  // of this same URL, which unmounts with submittedRef set; comparing the
  // pathname keeps the draft in that case.
  const mountedPathname = useRef<string | null>(null);
  useEffect(() => {
    mountedPathname.current = window.location.pathname;
    return () => {
      if (submittedRef.current && window.location.pathname !== mountedPathname.current) clearDraft();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markOpen = (kind: "repo" | "demo") => {
    const el = kind === "repo" ? repoOpened.current : demoOpened.current;
    if (el) el.value = "1";
    away.current = { kind, at: Date.now() };
  };

  // The repo/demo links live in the owner card on the review page (outside
  // this form), tagged with data-review-link, so listen for their clicks here
  // to keep recording whether and how long the reviewer opened them. auxclick
  // catches middle-click, which opens a new tab without firing click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.type === "auxclick" && e.button !== 1) return;
      const kind = (e.target as Element | null)?.closest("[data-review-link]")?.getAttribute("data-review-link");
      if (kind === "repo" || kind === "demo") markOpen(kind);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("auxclick", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("auxclick", onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Technical features / additional notes are only required for approve and
  // ban (reviewProject relaxes them for needs_changes too). Those fields live
  // in Step 2, hidden by the time the verdict buttons are clicked, and the
  // browser refuses to submit a form with an invalid hidden field without
  // saying why. So this checks everything itself, jumps to the step that
  // needs fixing and says what's wrong, instead of a click that does nothing.
  const onVerdictSelect = (verdict: string): boolean => {
    const required = verdict !== "needs_changes";
    if (technicalFeaturesRef.current) {
      technicalFeaturesRef.current.required = required;
      if (required) technicalFeaturesRef.current.minLength = TECHNICAL_FEATURES_MIN;
      else technicalFeaturesRef.current.removeAttribute("minlength");
    }
    if (notesRef.current) notesRef.current.required = required;

    const fail = (n: Step, message: string) => {
      setStep(n);
      setStepError(message);
      return false;
    };
    // Hours are only credited on an approve, so only an approve needs the reason.
    if (verdict === "approved" && needsDeflationReason && !deflationReasonRef.current?.value.trim())
      return fail(2, "Say why you're lowering the hours before deciding.");
    if (ageFlag && !ageJustificationRef.current?.value.trim())
      return fail(2, "Age justification is required before deciding.");
    if (required) {
      if ((technicalFeaturesRef.current?.value.trim().length ?? 0) < TECHNICAL_FEATURES_MIN)
        return fail(2, `Technical features needs at least ${TECHNICAL_FEATURES_MIN} characters.`);
      if (!notesRef.current?.value.trim()) return fail(2, "Additional notes is required before approving or banning.");
    }
    if (blackout && verdict === "approved") {
      const form = formRef.current;
      const picked = form?.querySelector<HTMLInputElement>('input[name="blackoutDecision"]:checked');
      const reason = form?.querySelector<HTMLTextAreaElement>('textarea[name="blackoutNote"]');
      if (!picked) return fail(1, "Rule on the Operation Blackout entry first: eligible or not eligible.");
      if (picked.value === "ineligible" && !reason?.value.trim())
        return fail(1, "Say why this entry isn't eligible for Operation Blackout.");
    }
    // Anything else the browser would reject (an hours value off the 0.1 step,
    // above the cap, ...). Fields on the visible step get the browser's own
    // bubble; ones on a hidden step get named here.
    const invalid = formRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      "input:invalid, textarea:invalid, select:invalid",
    );
    if (invalid) {
      const n = Number(invalid.closest<HTMLElement>("[data-step]")?.dataset.step) as Step;
      if (n && n !== step) return fail(n, `${fieldLabel(invalid.name)}: ${invalid.validationMessage}`);
    }
    setStepError("");
    return true;
  };

  // Submitting through a transition instead of <form action> keeps a failed
  // verdict on this page with a real message (and every typed note intact),
  // instead of the app-wide "Something broke" screen.
  const [pendingVerdict, setPendingVerdict] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [, startSubmit] = useTransition();

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pendingVerdict) return;
    if (totalSeconds.current) {
      const finalMs = activeMs.current + (visibleSince.current !== null ? Date.now() - visibleSince.current : 0);
      totalSeconds.current.value = String(Math.round(finalMs / 1000));
    }
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    const verdict = String(fd.get("verdict") ?? "");
    // Only flags the attempt; the unmount effect decides whether to clear the draft.
    submittedRef.current = true;
    if (serverDraftTimer.current) clearTimeout(serverDraftTimer.current);
    setSubmitError("");
    setPendingVerdict(verdict);
    startSubmit(async () => {
      try {
        await reviewProject(fd);
        // Every verdict that sticks redirects (to the next project, or back
        // here with ?error=), so getting here means the action stopped early.
        setSubmitError(
          "The verdict didn't go through. The project probably changed while you had it open (someone else reviewed it, or it left the review queue). Reload to see where it stands. Your notes are kept in this browser.",
        );
      } catch (err) {
        // A validation failure redirects back to this same page with ?error=,
        // which doesn't remount the form: re-enable it and repeat the message
        // next to the buttons, where the reviewer is looking.
        const bounced = bouncedError(err);
        if (bounced) {
          submittedRef.current = false;
          setPendingVerdict(null);
          setSubmitError(bounced);
        }
        // Opened before a deploy: nothing was submitted. The reload notice
        // above the form says what to do, so don't repeat it as an error.
        if (isStaleDeployError(err)) {
          staleDeploy.current = true;
          setServerSave("stale");
        } else if (!bounced) {
          setSubmitError(actionErrorMessage(err, "submit this verdict"));
        }
      }
      submittedRef.current = false;
      setPendingVerdict(null);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {(secondPass || isSuper || canEditSubmission) && (
        <EditSubmission
          projectId={projectId}
          repoUrl={repoUrl}
          demoUrl={demoUrl}
          currentName={currentName}
          currentDescription={currentDescription}
          currentImageUrl={currentImageUrl}
        />
      )}

      <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4">
        {draftSource === "local" && (
          <Callout tone="warning" icon="history">
            Restored your unsaved notes from last time you had this open.
          </Callout>
        )}
        {draftSource === "server" && (
          <Callout tone="info" icon="history">
            Started from {serverDraft?.by || "another reviewer"}&apos;s in-progress notes
            {serverDraft?.at ? ` (${formatDateTime(serverDraft.at)})` : ""}. Edit anything before you
            decide. Whatever you type here saves for anyone else who opens this project too.
          </Callout>
        )}
        {draftSource === "firstPass" && (
          <Callout tone="neutral" icon="history">
            Started from the first reviewer&apos;s notes. Edit anything before you decide.
          </Callout>
        )}
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="repoOpened" defaultValue="0" ref={repoOpened} />
        <input type="hidden" name="demoOpened" defaultValue="0" ref={demoOpened} />
        <input type="hidden" name="repoSeconds" defaultValue="0" ref={repoSeconds} />
        <input type="hidden" name="demoSeconds" defaultValue="0" ref={demoSeconds} />
        <input type="hidden" name="totalSeconds" defaultValue="0" ref={totalSeconds} />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {STEPS.map((s, i) => (
              <span key={s.n} className="flex items-center gap-2">
                {i > 0 && <span className="hc-muted">→</span>}
                <button
                  type="button"
                  className="hc-step"
                  data-active={step === s.n ? true : undefined}
                  onClick={() => goToStep(s.n)}
                >
                  {s.n}. {s.label}
                </button>
              </span>
            ))}
          </div>
          <span className="hc-save-status" data-tone={serverSave === "error" || serverSave === "stale" ? "danger" : serverSave === "saved" ? "success" : undefined}>
            {serverSave === "saving"
              ? "Saving draft…"
              : serverSave === "saved"
                ? "Draft saved"
                : serverSave === "error" || serverSave === "stale"
                  ? "Draft kept in this browser only"
                  : "Autosaves as you type"}
          </span>
        </div>
        {serverSave === "stale" && (
          <Callout tone="warning" icon="history">
            A new version of the dashboard was deployed while this page was open, so nothing can be saved or
            submitted from it. Reload, then submit again: what you have typed is saved in this browser and will still
            be here.
            <div className="mt-2">
              <button type="button" className="hc-btn hc-btn-outline hc-btn-sm" onClick={() => window.location.reload()}>
                Reload now
              </button>
            </div>
          </Callout>
        )}
        {stepError && <Callout tone="danger" icon="important">{stepError}</Callout>}

        <div data-step="1" hidden={step !== 1} className="flex flex-col gap-4">
          <InlineNumber
            label="Hours to credit"
            hint={
              journalDeflatedHours > 0 || deflated
                ? [
                    journalDeflatedHours > 0 ? `${journalDeflatedHours}h deflated in journals` : null,
                    deflated ? `${round1(claimedHours - hours)}h deflated not in journals` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Decrease only"
            }
          >
            <Input
              name="approvedHours"
              type="number"
              step="0.1"
              min="0"
              max={claimedHours}
              value={hours}
              onChange={(e) => {
                const v = Math.min(claimedHours, Math.max(0, Number(e.target.value) || 0));
                hoursEditedRef.current = true;
                setHours(v);
                saveDraft({ hours: v });
              }}
              className="w-28"
            />
          </InlineNumber>
          {collaborators.map((c) => (
            <CollaboratorHoursInput key={c.id} c={c} />
          ))}
          {blackout && <BlackoutReviewSection data={blackout} />}
          <TierAndPayout
            hours={hours}
            tier={tierState}
            onTier={(t) => {
              setTierState(t);
              saveDraft({ tier: t });
            }}
            savedTier={tier}
            projectId={projectId}
            playerReBefore={playerReBefore}
            forTrial={!!trial}
            trialMinHours={trial?.minHours}
            trialName={trial?.name}
            fundingUsd={fundingUsd}
          />
          {trial?.minHours != null &&
            (hours < trial.minHours ? (
              <Callout tone="danger" icon="important">
                Trial &quot;{trial.name}&quot; needs {trial.minHours}h minimum to approve. The credited hours are below
                that, so Approve will be blocked.
              </Callout>
            ) : (
              <p className="hc-caption text-xs">
                Trial &quot;{trial.name}&quot; needs {trial.minHours}h minimum to approve.
              </p>
            ))}
          {bounties.length > 0 && (
            <div className="hc-panel flex flex-col gap-2">
              <p className="hc-eyebrow">Bounty board · tick what this project meets (paid on final approval)</p>
              {bounties.map((b) => (
                <Checkbox
                  key={b.id}
                  name="bountyIds"
                  value={String(b.id)}
                  label={
                    <>
                      {b.name} <Badge tone="yellow">+{b.reward} px</Badge>
                      {b.description && <span className="hc-muted"> {b.description}</span>}
                    </>
                  }
                />
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Button type="button" onClick={() => goToStep(2)}>
              Next: Audit notes →
            </Button>
          </div>
        </div>

        <div data-step="2" hidden={step !== 2} className="flex flex-col gap-4">
          <div className="hc-panel flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="hc-eyebrow">AI draft (beta)</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!isSuper || aiPending}
                onClick={runAiDraft}
                title={isSuper ? undefined : "Only owners can generate this. Ask one to run it for you."}
              >
                {aiPending ? "Generating…" : "Generate AI draft"}
              </Button>
              {!isSuper && <span className="hc-caption text-xs">Only owners can click this</span>}
            </div>
            <p className="hc-caption text-xs">
              Reads the repo, commits, journals and Hackatime data and drafts the fields below for you to check and
              edit. It never picks a verdict or hours, that&apos;s still on you. If you already lowered the hours, it
              drafts the explanation for that number too, so set hours first for the best deflation draft.
            </p>
            {aiError && <Callout tone="danger" icon="important">{aiError}</Callout>}
            {aiDraft && (
              <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-2 text-sm">
                <p className="hc-caption">{aiDraft.summary}</p>
                {aiDraft.redFlags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {aiDraft.redFlags.map((f, i) => (
                      <Badge key={i} tone="danger">{f}</Badge>
                    ))}
                  </div>
                )}
                {aiDraft.strengths.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {aiDraft.strengths.map((s, i) => (
                      <Badge key={i} tone="success">{s}</Badge>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button type="button" size="sm" variant="outline" onClick={() => insertAiText("technicalFeatures", aiDraft.technicalFeatures)}>
                    Insert into Technical features
                  </Button>
                  {needsDeflationReason && aiDraft.deflationReason && (
                    <Button type="button" size="sm" variant="outline" onClick={() => insertAiText("deflationReason", aiDraft.deflationReason)}>
                      Insert into Why lower the hours?
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="outline" onClick={() => insertAiText("notes", aiDraft.notes)}>
                    Insert into Notes
                  </Button>
                </div>
                <p className="hc-caption text-xs">Drafted by {aiDraft.model}</p>
              </div>
            )}
          </div>

          <p className="hc-eyebrow">
            Internal audit note, never shown to the player. Someone who wasn&apos;t involved should reach the same
            conclusion you did.
          </p>
          <Field
            label="Technical features"
            hint={
              <>
                A detailed explanation of what the project is, to show you actually checked it. Use specific technical
                terms (&quot;OAuth app&quot;, not generic words). If you can&apos;t find any, describe in detail what
                it looks like and does.
              </>
            }
          >
            <AuditTextarea
              name="technicalFeatures"
              required
              minLength={TECHNICAL_FEATURES_MIN}
              ref={technicalFeaturesRef}
              onChange={(e) => {
                setFeaturesLen(e.target.value.trim().length);
                saveDraft();
              }}
              placeholder={
                "Example: The demo features a light-mode landing page with an action button labeled \"Encode some data\" and a secondary \"Decode an image\". The encoding page has a drag-and-drop box that shows the image's resolution, total pixels and size, and lets you encode text, image, audio or a file into it. The repository has a broad README with screenshots and sections (Features, Tech Stack, How to use, Run locally). Written with React.\n\nThen cover the README (is it clear, does it explain how to run locally and how it was made) and the demo (how it is hosted)."
              }
              rows={5}
            />
            <span className="hc-counter" data-done={featuresLen >= TECHNICAL_FEATURES_MIN ? true : undefined}>
              {featuresLen}/{TECHNICAL_FEATURES_MIN}
            </span>
          </Field>
          {needsDeflationReason && (
            <Field
              label={`Why lower the hours? (${rawClaimedHours}h claimed → ${hours}h credited)`}
              hint="A short justification: what made you deflate (suspected AI use, too few proofs such as few commits and no journal) and how much you deflated and approved."
            >
              <AuditTextarea
                name="deflationReason"
                ref={deflationReasonRef}
                onChange={() => saveDraft()}
                placeholder={
                  "Example: The HTML has AI comments like <!-- Open Graph tags -->, the CSS and JS do not and look handwritten. The commits are numerous and consistent but not descriptive (\"added css\" for all of them), so they do not show progress. I deflate 2h from the 10h submitted to approve 8h."
                }
                rows={3}
              />
            </Field>
          )}
          {ageFlag && (
            <Field label="Age justification" hint="This submitter turns 19 between shipping and this review.">
              <AuditTextarea
                name="ageJustification"
                required
                ref={ageJustificationRef}
                onChange={() => saveDraft()}
                placeholder="Document the submitter's age at shipping vs. now."
                rows={3}
              />
            </Field>
          )}
          <Field
            label="Additional notes"
            hint={
              <>
                Required. Show your thinking: the user&apos;s level (check their repo count) and how it affects the
                hours (a beginner gets more hours approved than an advanced user for the same project), why you
                didn&apos;t deflate (commit count, whether they are descriptive and show steady progress, journals),
                and any other proof that supports the time.
              </>
            }
          >
            <AuditTextarea
              name="notes"
              required
              ref={notesRef}
              onChange={() => saveDraft()}
              placeholder={
                "Example: User is advanced, several ships in HC, active in many channels, 37 repos. 38 descriptive commits showing steady progress, like 002793b adding a loading state to the delete button (22 lines in 6 minutes) or 3af0c0b adding 200 lines in 1.2h for custom artwork. The longest gap between commits is 1.2h, which is consistent. There is 1 detailed journal adding 8h of unlapsed art made in Krita; it is their first time doing art and it looks legit. The 8h for the whole site is legit, but I still deflate to respect the guidelines."
              }
              rows={5}
            />
          </Field>
          <div className="flex justify-between">
            <Button type="button" variant="outline" onClick={() => goToStep(1)}>
              ← Back
            </Button>
            <Button type="button" onClick={() => goToStep(3)}>
              Next: Verdict →
            </Button>
          </div>
        </div>

        <div data-step="3" hidden={step !== 3} className="flex flex-col gap-4">
          <Field
            label="Note to the player"
            hint={`Required. Be nice and personal, show their work is good. Macros: ${REVIEW_MACROS.map((m) => `${m.trigger} = ${m.label}`).join(", ")}`}
          >
            <AuditTextarea
              name="note"
              required
              ref={noteRef}
              onChange={(e) => {
                // Macros (lib/reviewMacros.ts): typing /ai swaps in the canned
                // text. Only after something was typed or pasted, so deleting
                // back down to "/ai" never expands it.
                const input = e.currentTarget;
                if ((e.nativeEvent as InputEvent).inputType?.startsWith("insert")) {
                  const expanded = expandMacro(input.value, input.selectionStart ?? input.value.length);
                  if (expanded) {
                    input.value = expanded.value;
                    input.setSelectionRange(expanded.caret, expanded.caret);
                  }
                }
                saveDraft();
              }}
              placeholder={
                "If the site was a restaurant menu, play along and talk like you are ordering before telling them it is a great project. Finish with a short motivation like \"Keep it up!\"."
              }
              rows={4}
            />
          </Field>
          <Checkbox
            name="revealName"
            value="1"
            defaultChecked
            label={'Show my name to the player in this verdict\'s notification (approved / needs changes). Untick to send it as "the review team" instead.'}
          />
          <Checkbox
            name="notifyOnResubmit"
            value="1"
            label="If you request changes: DM me on Slack when the player ships this project again, so I can re-review it while I still remember it."
          />
          {submitError && <Callout tone="danger" icon="important">{submitError}</Callout>}
          <VerdictButtons
            secondPass={secondPass}
            pendingVerdict={pendingVerdict}
            onVerdictSelect={onVerdictSelect}
            onBack={() => goToStep(2)}
          />
        </div>
      </form>
    </div>
  );
}
