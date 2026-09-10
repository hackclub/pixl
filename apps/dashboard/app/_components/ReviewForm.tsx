"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { reviewProject, applySubmissionEdits, setProjectLevel, generateAiReviewDraftAction } from "@/app/actions";
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
import { PendingButton } from "@/app/_components/PendingButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

function VerdictButtons({
  secondPass,
  onVerdictSelect,
}: {
  secondPass: boolean;
  /** Fires on click, before the browser's native required-field validation
   * runs - lets the parent relax technicalFeatures/notes for this specific
   * submission (needs_changes doesn't need them), validate the (now hidden,
   * since they live in an earlier step) audit-note fields itself, and block
   * the submit by returning false if something's missing. */
  onVerdictSelect: (verdict: string) => boolean;
}) {
  const { pending } = useFormStatus();
  const [clicked, setClicked] = useState("");
  const approveLabel = secondPass ? "Approve & credit pixels" : "Approve";
  const select = (verdict: string, e: React.MouseEvent) => {
    if (!onVerdictSelect(verdict)) {
      e.preventDefault();
      return;
    }
    setClicked(verdict);
  };
  return (
    <>
      <Button
        name="verdict"
        value="approved"
        disabled={pending}
        onClick={(e) => select("approved", e)}
        className="bg-emerald-600 text-white hover:bg-emerald-700"
      >
        {pending && clicked === "approved" ? "Approving…" : approveLabel}
      </Button>
      <Button
        name="verdict"
        value="needs_changes"
        disabled={pending}
        onClick={(e) => select("needs_changes", e)}
        className="bg-red-600 text-white hover:bg-red-700"
      >
        {pending && clicked === "needs_changes" ? "Sending back…" : "Request changes"}
      </Button>
      <Button
        name="verdict"
        value="ban"
        disabled={pending}
        onClick={(e) => select("ban", e)}
        variant="outline"
        className="border-red-700 text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
      >
        {pending && clicked === "ban"
          ? secondPass
            ? "Banning…"
            : "Proposing…"
          : secondPass
            ? "Ban project"
            : "Propose ban"}
      </Button>
    </>
  );
}

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

const TIERS = [
  { value: 1, label: "T1 Spark", blurb: "A simple site, script, or tiny tool" },
  { value: 2, label: "T2 Signal", blurb: "A focused app, CLI, or game with clean polish" },
  { value: 3, label: "T3 Grid", blurb: "Multiple systems together: backend, state, infra" },
  { value: 4, label: "T4 Nexus", blurb: "Deep systems work, serious scope" },
];

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
  /** The tier actually persisted on the project right now - lets the "Set"
   * button below know whether there's an unsaved pick to re-grade to. */
  savedTier: number;
  projectId: number;
  playerReBefore: number;
  forTrial: boolean;
  /** The Trial's min-hours gate, for the prize/beyond-hours split below. */
  trialMinHours?: number | null;
  trialName?: string;
  /** Hardware funding grant requested on this project, if any - deducted from
   * the payout below, mirroring creditBeneficiary's fundingPx exactly. */
  fundingUsd?: number;
}) {
  const [regrading, startRegrade] = useTransition();
  const perHour = rePerHour(tier);
  const hoursRe = reForHours(hours, tier);
  const trialBonusRe = forTrial ? config.economy.trialBonusRe : 0;
  const projectRe = hoursRe + trialBonusRe;
  const reAfter = playerReBefore + projectRe;
  // Averaged across the RE this ship earns on top of the player's existing
  // lifetime RE, matching creditBeneficiary exactly.
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
  // here without any community-goal multiplier (not known client-side) - see
  // the disclaimer below, same as the rest of this panel.
  const trialPrizePx =
    forTrial && trialMinHours != null && trialMinHours > 0
      ? Math.min(Math.max(Math.round(projectPayoutPx(trialMinHours, tier, 0)), 0), px)
      : 0;
  const trialBeyondPx = Math.max(px - trialPrizePx, 0);
  // Mirrors creditBeneficiary's fundingPx exactly: the hardware grant comes
  // out of this payout, converted at today's rate, capped so it can't go
  // negative.
  const fundingPx =
    fundingUsd > 0 ? Math.min(Math.round(fundingUsd / config.economy.pixelValueUsd), px) : 0;
  const netPx = px - fundingPx;
  const netUsd = netPx * config.economy.pixelValueUsd;

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
      <Label className="flex items-center justify-between gap-2 font-normal text-muted-foreground">
        Tier
        <span className="flex items-center gap-2">
          <select
            value={tier}
            onChange={(e) => onTier(Number(e.target.value))}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            {TIERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label} · {rePerHour(t.value)} RE/h
              </option>
            ))}
          </select>
          {tier !== savedTier && (
            <button
              type="button"
              disabled={regrading}
              onClick={() => {
                const fd = new FormData();
                fd.set("projectId", String(projectId));
                fd.set("level", String(tier));
                startRegrade(() => {
                  setProjectLevel(fd);
                });
              }}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              {regrading ? "Saving…" : "Set"}
            </button>
          )}
        </span>
      </Label>
      <div className="text-xs text-muted-foreground">
        {TIERS[Math.min(Math.max(tier, 1), 4) - 1].blurb}
      </div>

      <div className="border-t border-border pt-2 space-y-1 text-sm tabular-nums">
        <div className="flex justify-between">
          <span className="text-muted-foreground">
            This project · {hours}h × {perHour} RE/h
          </span>
          <span className="font-medium">{round1(hoursRe).toLocaleString()} RE</span>
        </div>
        {trialBonusRe > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Trial bonus (flat, every Trial)</span>
            <span className="font-medium">+{trialBonusRe.toLocaleString()} RE</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Their RE before → after</span>
          <span className="font-medium">
            {round1(playerReBefore).toLocaleString()} → {round1(reAfter).toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Their level before → after</span>
          <span className="font-medium">
            {levelBefore} → {levelAfter}
            {levelAfter > levelBefore && (
              <span className="text-[color:var(--color-hc-green,green)]"> ▲</span>
            )}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Rate (averaged over this ship)</span>
          <span className="font-medium">
            {Math.round(rate)} px/h · ${usdRate.toFixed(2)}/h
          </span>
        </div>
        <div className="flex justify-between border-t border-border pt-1">
          <span className="font-medium">Payout</span>
          <span className="font-bold">
            {px.toLocaleString()} px · ${usd.toFixed(2)}
          </span>
        </div>
        {forTrial && trialPrizePx > 0 && (
          <>
            <div className="flex justify-between pt-1">
              <span className="text-muted-foreground">
                &quot;{trialName}&quot; prize · first {trialMinHours}h
              </span>
              <span className="font-medium">≈{trialPrizePx.toLocaleString()} px</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">+ pixels for hours beyond that</span>
              <span className="font-medium">{trialBeyondPx.toLocaleString()} px</span>
            </div>
          </>
        )}
        {forTrial && (
          <div className="text-[11px] text-muted-foreground leading-snug pt-1">
            Trial ship: this payout is held, not credited.{" "}
            {trialPrizePx > 0
              ? `Once you approve it, the maker keeps the prize (worth ≈${trialPrizePx.toLocaleString()} px) plus the ${trialBeyondPx.toLocaleString()} px for hours beyond the minimum by default, or can skip the prize for all ${px.toLocaleString()} px instead.`
              : "The maker picks the Trial reward or these pixels once you approve it, and only gets the one they pick."}
          </div>
        )}
        {fundingPx > 0 && (
          <>
            <div className="flex justify-between pt-1">
              <span className="text-muted-foreground">Hardware funding grant (${fundingUsd.toFixed(2)})</span>
              <span className="font-medium">-{fundingPx.toLocaleString()} px</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1">
              <span className="font-medium">They actually get</span>
              <span className="font-bold">
                {netPx.toLocaleString()} px · ${netUsd.toFixed(2)}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground leading-snug pt-1">
              The ${fundingUsd.toFixed(2)} funding grant comes out of this payout instead of their
              wallet, so approving credits {netPx.toLocaleString()} px, not {px.toLocaleString()}.
            </div>
          </>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        Changing the tier here re-grades it immediately (click Set), same as the Re-grade tier
        control above - it doesn&apos;t wait for your verdict. Community-goal bonuses and any
        referral boost apply on top and aren&apos;t shown.
      </p>
    </div>
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const STEPS = [
  { n: 1 as const, label: "Submission" },
  { n: 2 as const, label: "Audit notes" },
  { n: 3 as const, label: "Verdict" },
];

function StepHeader({ step, onStep }: { step: 1 | 2 | 3; onStep: (n: 1 | 2 | 3) => void }) {
  return (
    <div className="flex items-center gap-1 text-xs font-medium">
      {STEPS.map((s, i) => (
        <div key={s.n} className="flex items-center gap-1">
          {i > 0 && <span className="text-muted-foreground/40">→</span>}
          <button
            type="button"
            onClick={() => onStep(s.n)}
            className={`rounded-full px-2.5 py-1 transition-colors ${
              step === s.n
                ? "bg-brand text-white"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {s.n}. {s.label}
          </button>
        </div>
      ))}
    </div>
  );
}

function CollaboratorHoursInput({ c }: { c: CollaboratorHours }) {
  const [value, setValue] = useState(c.claimedHours);
  return (
    <Label className="flex items-center justify-between gap-2 font-normal text-muted-foreground">
      {c.name}&apos;s hours to credit (decrease only)
      <Input
        name={`collabHours_${c.id}`}
        type="number"
        step="0.1"
        min="0"
        max={c.claimedHours}
        value={value}
        onChange={(e) =>
          setValue(Math.min(c.claimedHours, Math.max(0, Number(e.target.value) || 0)))
        }
        className="w-28 text-sm"
      />
    </Label>
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
  hackatimeProjects = [],
  hackatimeSeconds = 0,
  ageFlag = false,
  collaborators = [],
  tier = 1,
  playerReBefore = 0,
  fundingUsd = 0,
  firstPass,
  currentName,
  currentDescription,
  currentImageUrl,
  isSuper = false,
}: {
  projectId: number;
  repoUrl: string | null;
  demoUrl: string | null;
  claimedHours: number;
  defaultHours?: number;
  /** How many hours the overall credited total already lost to per-journal-entry
   * deflation (Journals tab / setJournalHours), so the breakdown below can show
   * it separately from whatever this reviewer additionally lowers below. */
  journalDeflatedHours?: number;
  secondPass?: boolean;
  bounties?: BountyOption[];
  trial?: TrialInfo | null;
  hackatimeProjects?: string[];
  hackatimeSeconds?: number;
  ageFlag?: boolean;
  collaborators?: CollaboratorHours[];
  /** The project's current tier (1-4). Submitted with the verdict. */
  tier?: number;
  /** The player's lifetime RE excluding this project - what sets their rate. */
  playerReBefore?: number;
  /** Hardware funding grant requested on this project (0 if none/not hardware). */
  fundingUsd?: number;
  /** The first pass's own audit note + player note, so the final reviewer
   * starts from what was already written instead of a blank form. */
  firstPass?: {
    technicalFeatures: string;
    hackatimeEvidence: string;
    deflationReason: string;
    ageJustification: string;
    notes: string;
    note: string;
  };
  /** Current title/description/image, editable by a final (second-pass)
   * reviewer only, see the "Edit submission" section below. */
  currentName?: string;
  currentDescription?: string | null;
  currentImageUrl?: string | null;
  /** Whether the viewing reviewer is a super admin - gates the "Generate AI
   * draft" button below (visible to every reviewer, only clickable for admins). */
  isSuper?: boolean;
}) {
  const repoOpened = useRef<HTMLInputElement>(null);
  const demoOpened = useRef<HTMLInputElement>(null);
  const repoSeconds = useRef<HTMLInputElement>(null);
  const demoSeconds = useRef<HTMLInputElement>(null);
  const totalSeconds = useRef<HTMLInputElement>(null);
  const away = useRef<{ kind: "repo" | "demo"; at: number } | null>(null);
  const openedAt = useRef(Date.now());
  const submittedRef = useRef(false);

  const baseHours = defaultHours ?? claimedHours;
  const [hours, setHours] = useState(baseHours);
  const [tierState, setTierState] = useState(tier);
  const deflated = hours < claimedHours;

  // Deflating a journal entry (Journals tab, setJournalHours) revalidates
  // this same page without a full reload/remount - React keeps this
  // component's state, so `hours` (a useState only seeded from baseHours at
  // MOUNT) went stale, still holding the pre-deflation total. That left
  // `deflated` computed against the wrong number, so the required "Why lower
  // the hours?" box could silently fail to appear even though the credited
  // total had genuinely dropped. Re-sync whenever baseHours changes, unless
  // the reviewer has already typed their own value into the field below.
  const hoursEditedRef = useRef(false);
  useEffect(() => {
    if (!hoursEditedRef.current) setHours(baseHours);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseHours]);

  // A rushed reviewer who closes the dashboard mid-review (or accidentally
  // navigates away) loses everything they typed, deflation reason included -
  // this is the one hard-to-redo part of a review. Draft autosaves to
  // localStorage (per browser, not the account - closing the tab elsewhere
  // won't recover it) and is cleared the moment the form is actually
  // submitted, whether the verdict sticks or bounces back on a validation
  // error, so a stale draft never resurrects itself on the next review.
  const draftKey = `pixl-review-draft-${projectId}`;
  const technicalFeaturesRef = useRef<HTMLTextAreaElement>(null);
  const hackatimeEvidenceRef = useRef<HTMLTextAreaElement>(null);
  const deflationReasonRef = useRef<HTMLTextAreaElement>(null);
  const ageJustificationRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const pendingDraft = useRef<Record<string, string | number> | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [prefilledFromFirstPass, setPrefilledFromFirstPass] = useState(false);

  useEffect(() => {
    let draft: Record<string, string | number> | null = null;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) draft = JSON.parse(raw);
    } catch {
      draft = null;
    }
    if (draft) {
      setDraftRestored(true);
    } else if (firstPass) {
      // Nothing typed yet this session - start from what the first reviewer
      // already wrote instead of a blank form. Still fully editable.
      draft = { ...firstPass };
      setPrefilledFromFirstPass(true);
    }
    if (!draft) return;
    if (typeof draft.technicalFeatures === "string" && technicalFeaturesRef.current) {
      technicalFeaturesRef.current.value = draft.technicalFeatures;
      setFeaturesLen(draft.technicalFeatures.trim().length);
    }
    if (typeof draft.hackatimeEvidence === "string" && hackatimeEvidenceRef.current)
      hackatimeEvidenceRef.current.value = draft.hackatimeEvidence;
    if (typeof draft.ageJustification === "string" && ageJustificationRef.current)
      ageJustificationRef.current.value = draft.ageJustification;
    if (typeof draft.notes === "string" && notesRef.current) notesRef.current.value = draft.notes;
    if (typeof draft.note === "string" && noteRef.current) noteRef.current.value = draft.note;
    // deflationReason's textarea only renders once `deflated` is true, which
    // depends on the `hours` state this same draft is about to change - stash
    // it and let the effect below fill it in once that field actually exists.
    pendingDraft.current = draft;
    // A saved draft's `hours` is only trustworthy if the server-computed
    // baseline it was measured against hasn't moved since - a reviewer
    // deflating a journal entry (Journals tab) recomputes baseHours on the
    // next page load, but a stale draft.hours from before that edit would
    // otherwise silently overwrite the fresh, lower number back to the old
    // one. Only restore it when draft.baseHours still matches; otherwise drop
    // the stale override and let the fresh baseHours stand.
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
  }, [deflated]);

  // hours/tier come from React state, which hasn't updated yet inside the same
  // handler that just called setHours/setTierState (state updates apply on the
  // next render) - callers changing one of those pass the new value directly
  // rather than relying on the stale closure.
  const saveDraft = (overrides?: { hours?: number; tier?: number }) => {
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          hours: overrides?.hours ?? hours,
          baseHours,
          tier: overrides?.tier ?? tierState,
          technicalFeatures: technicalFeaturesRef.current?.value ?? "",
          hackatimeEvidence: hackatimeEvidenceRef.current?.value ?? "",
          deflationReason: deflationReasonRef.current?.value ?? "",
          ageJustification: ageJustificationRef.current?.value ?? "",
          notes: notesRef.current?.value ?? "",
          note: noteRef.current?.value ?? "",
        }),
      );
    } catch {
      // Storage full or unavailable (private browsing) - the review still
      // works, it just can't be recovered if the tab closes.
    }
  };

  const clearDraft = () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
  };

  // AI-drafted review notes (admin-only, see generateAiReviewDraftAction in
  // app/actions.ts) - a starting point the reviewer reads and edits, never
  // submitted on its own. The button itself is visible to every reviewer so
  // they know the feature exists, but only an admin's click actually calls
  // the action (it re-checks requireSuper() server-side regardless).
  const [aiPending, startAiTransition] = useTransition();
  const [aiDraft, setAiDraft] = useState<AiReviewDraft | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const runAiDraft = () => {
    setAiError(null);
    startAiTransition(async () => {
      try {
        const draft = await generateAiReviewDraftAction(projectId);
        setAiDraft(draft);
      } catch (e) {
        setAiError(e instanceof Error ? e.message : "Failed to generate a draft.");
      }
    });
  };

  const insertAiText = (field: "technicalFeatures" | "hackatimeEvidence" | "notes", text: string) => {
    const ref =
      field === "technicalFeatures"
        ? technicalFeaturesRef
        : field === "hackatimeEvidence"
          ? hackatimeEvidenceRef
          : notesRef;
    if (!ref.current || !text) return;
    ref.current.value = text;
    if (field === "technicalFeatures") setFeaturesLen(text.trim().length);
    saveDraft();
  };

  const hackatimeDefault = useMemo(() => {
    if (hackatimeSeconds <= 0) return "";
    const h = Math.round((hackatimeSeconds / 3600) * 10) / 10;
    const names = hackatimeProjects.length ? hackatimeProjects.join(", ") : "(unnamed)";
    return `${names} , ${h}h tracked (see the Hackatime tab for the date range).`;
  }, [hackatimeProjects, hackatimeSeconds]);

  const [featuresLen, setFeaturesLen] = useState(0);

  // 3-step wizard over this one form: Submission -> Audit notes -> Verdict.
  // Steps are hidden with CSS (never unmounted), so refs/localStorage-draft
  // restore above keep working regardless of which step is visible, and
  // hopping back a step to fix something doesn't lose anything typed ahead.
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [stepError, setStepError] = useState("");
  const goToStep = (n: 1 | 2 | 3) => {
    setStep(n);
    setStepError("");
  };

  useEffect(() => {
    openedAt.current = Date.now();
    const settle = () => {
      const a = away.current;
      if (!a || document.visibilityState !== "visible") return;
      away.current = null;
      const el = a.kind === "repo" ? repoSeconds.current : demoSeconds.current;
      if (el)
        el.value = String(
          Math.round(Number(el.value || 0) + (Date.now() - a.at) / 1000),
        );
    };
    window.addEventListener("focus", settle);
    document.addEventListener("visibilitychange", settle);
    return () => {
      window.removeEventListener("focus", settle);
      document.removeEventListener("visibilitychange", settle);
    };
  }, []);

  // Clearing on unmount was meant to fire "only once the submission actually
  // succeeded and navigated away" (see the onSubmit handler below), but
  // submittedRef flips to true the instant Submit is clicked - before we know
  // whether the request even reached the server. A request that dies mid-flight
  // (a redeploy killing the pod while the action is in-flight is exactly this)
  // never redirects, but Next.js still detects the stale build and forces a
  // reload to fetch the new one - which unmounts this component first, with
  // submittedRef already true, wiping a draft that was never actually
  // submitted. Comparing the pathname at mount vs. at unmount tells the two
  // apart: a real success redirects to a different project (or back to the
  // queue), changing the pathname; a forced reload after a dead request stays
  // on this same URL, so the draft survives it.
  const mountedPathname = useRef<string | null>(null);
  useEffect(() => {
    mountedPathname.current = window.location.pathname;
    return () => {
      if (submittedRef.current && window.location.pathname !== mountedPathname.current) {
        clearDraft();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markOpen = (kind: "repo" | "demo") => {
    const el = kind === "repo" ? repoOpened.current : demoOpened.current;
    if (el) el.value = "1";
    away.current = { kind, at: Date.now() };
  };

  // Technical features / additional notes only need to hold up as an audit
  // trail for approve/ban - a needs_changes bounce-back has its own required
  // player-facing note instead (see reviewProject's matching server-side
  // relaxation in app/actions.ts). These fields live in Step 2, which is
  // hidden (not unmounted) once the reviewer reaches Step 3's verdict
  // buttons - a hidden required field is skipped by the browser's native
  // validation instead of blocking submit, so this checks them itself and
  // returns false (bouncing back to Step 2 with an error) rather than
  // trusting a native validation that would silently pass over them.
  const onVerdictSelect = (verdict: string): boolean => {
    const required = verdict !== "needs_changes";
    if (technicalFeaturesRef.current) {
      technicalFeaturesRef.current.required = required;
      if (required) technicalFeaturesRef.current.minLength = TECHNICAL_FEATURES_MIN;
      else technicalFeaturesRef.current.removeAttribute("minlength");
    }
    if (notesRef.current) notesRef.current.required = required;

    if (deflated && !deflationReasonRef.current?.value.trim()) {
      setStep(2);
      setStepError("Say why you're lowering the hours before deciding.");
      return false;
    }
    if (ageFlag && !ageJustificationRef.current?.value.trim()) {
      setStep(2);
      setStepError("Age justification is required before deciding.");
      return false;
    }
    if (required) {
      if ((technicalFeaturesRef.current?.value.trim().length ?? 0) < TECHNICAL_FEATURES_MIN) {
        setStep(2);
        setStepError(`Technical features needs at least ${TECHNICAL_FEATURES_MIN} characters.`);
        return false;
      }
      if (!notesRef.current?.value.trim()) {
        setStep(2);
        setStepError("Additional notes is required before approving or banning.");
        return false;
      }
    }
    setStepError("");
    return true;
  };

  return (
    <>
      {secondPass && (
        <details className="rounded-lg border p-4 mt-4">
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-muted-foreground select-none">
            Edit submission , title, image, repo/demo links, description
          </summary>
          <form action={applySubmissionEdits} className="mt-3 flex flex-col gap-3">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Applies immediately , updates the project everywhere: the player&apos;s own
              page, the next reviewer who opens this, and the YSWS/Airtable export. Independent
              of your verdict below.
            </p>
            <input type="hidden" name="projectId" value={projectId} />
            <Label className="flex flex-col gap-1.5 font-normal">
              <span className="text-xs text-muted-foreground">Title</span>
              <Input
                name="editedName"
                defaultValue={currentName ?? ""}
                maxLength={200}
                className="text-sm"
              />
            </Label>
            <Label className="flex flex-col gap-1.5 font-normal">
              <span className="text-xs text-muted-foreground">Image URL</span>
              <Input
                name="editedImageUrl"
                defaultValue={currentImageUrl ?? ""}
                placeholder="https://…"
                className="text-sm"
              />
            </Label>
            <Label className="flex flex-col gap-1.5 font-normal">
              <span className="text-xs text-muted-foreground">Repo URL</span>
              <Input
                name="editedRepoUrl"
                defaultValue={repoUrl ?? ""}
                placeholder="https://github.com/…"
                className="text-sm"
              />
            </Label>
            <Label className="flex flex-col gap-1.5 font-normal">
              <span className="text-xs text-muted-foreground">Demo URL</span>
              <Input
                name="editedDemoUrl"
                defaultValue={demoUrl ?? ""}
                placeholder="https://…"
                className="text-sm"
              />
            </Label>
            <Label className="flex flex-col gap-1.5 font-normal">
              <span className="text-xs text-muted-foreground">Description</span>
              <Textarea
                name="editedDescription"
                defaultValue={currentDescription ?? ""}
                maxLength={5000}
                rows={4}
                className="text-sm"
              />
            </Label>
            <PendingButton
              variant="secondary"
              pendingText="Applying…"
              className="self-start"
            >
              Apply changes
            </PendingButton>
          </form>
        </details>
      )}
    <form
      action={reviewProject}
      onSubmit={() => {
        if (totalSeconds.current)
          totalSeconds.current.value = String(
            Math.round((Date.now() - openedAt.current) / 1000),
          );
        // Don't clear the draft here - this fires the instant the button is
        // clicked, before the request even reaches the network. If the
        // server never responds (a redeploy killing the pod mid-request is
        // exactly this), the draft would already be gone with nothing to
        // recover, on top of whatever pixels/verdict were lost. Flag the
        // attempt instead; the unmount effect below only clears once the
        // submission actually succeeded and navigated away.
        submittedRef.current = true;
      }}
      className="mt-4 flex flex-col gap-4"
    >
      {draftRestored && (
        <div className="text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/[0.06] border border-amber-200 dark:border-amber-500/30 rounded-md px-3 py-1.5">
          Restored your unsaved notes from last time you had this open.
        </div>
      )}
      {prefilledFromFirstPass && (
        <div className="text-xs font-medium text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/[0.06] border border-violet-200 dark:border-violet-500/30 rounded-md px-3 py-1.5">
          Started from the first reviewer&apos;s notes , edit anything before you decide.
        </div>
      )}
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="repoOpened" defaultValue="0" ref={repoOpened} />
      <input type="hidden" name="demoOpened" defaultValue="0" ref={demoOpened} />
      <input type="hidden" name="repoSeconds" defaultValue="0" ref={repoSeconds} />
      <input type="hidden" name="demoSeconds" defaultValue="0" ref={demoSeconds} />
      <input type="hidden" name="totalSeconds" defaultValue="0" ref={totalSeconds} />

      <StepHeader step={step} onStep={goToStep} />
      {stepError && (
        <div className="text-xs font-medium text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/[0.06] border border-rose-200 dark:border-rose-500/30 rounded-md px-3 py-1.5">
          {stepError}
        </div>
      )}

      <div className={step === 1 ? "flex flex-col gap-4" : "hidden"}>
      <div className="flex flex-wrap gap-2 items-center text-sm font-bold">
        {repoUrl && (
          <Button asChild variant="secondary">
            <a
              href={repoUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => markOpen("repo")}
            >
              Repo
            </a>
          </Button>
        )}
        {demoUrl && (
          <Button asChild variant="secondary">
            <a
              href={demoUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => markOpen("demo")}
            >
              Demo
            </a>
          </Button>
        )}
      </div>
      <Label className="flex items-center justify-between gap-2 font-normal text-muted-foreground">
        Hours to credit (decrease only)
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
          className="w-28 text-sm"
        />
      </Label>
      {(journalDeflatedHours > 0 || deflated) && (
        <div className="text-xs text-muted-foreground -mt-2 flex flex-wrap gap-x-3">
          {journalDeflatedHours > 0 && <span>{journalDeflatedHours}h deflated in journals</span>}
          {deflated && (
            <span>
              {Math.round((claimedHours - hours) * 10) / 10}h deflated not in journals
            </span>
          )}
        </div>
      )}
      {collaborators.map((c) => (
        <CollaboratorHoursInput key={c.id} c={c} />
      ))}
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
      {trial?.minHours != null && (
        <div
          className={`text-xs font-medium ${
            hours < trial.minHours
              ? "text-red-600 dark:text-red-400"
              : "text-muted-foreground"
          }`}
        >
          Trial &quot;{trial.name}&quot; needs {trial.minHours}h minimum to approve
          {hours < trial.minHours ? " , credited hours are below that, so Approve will be blocked." : "."}
        </div>
      )}
      {bounties.length > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/[0.06] p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300 mb-1.5">
            Bounty board , tick what this project meets (paid on final approval)
          </div>
          {bounties.map((b) => (
            <Label key={b.id} className="flex items-start gap-2 text-sm py-0.5 font-normal">
              <Checkbox name="bountyIds" value={String(b.id)} className="mt-0.5" />
              <span>
                {b.name} <span className="font-semibold">+{b.reward} px</span>
                {b.description && <span className="text-muted-foreground"> , {b.description}</span>}
              </span>
            </Label>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <Button type="button" onClick={() => goToStep(2)}>
          Next: Audit notes →
        </Button>
      </div>
      </div>

      <div className={step === 2 ? "flex flex-col gap-4" : "hidden"}>
      <div className="rounded-lg border p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            AI draft (beta)
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!isSuper || aiPending}
            onClick={runAiDraft}
            title={isSuper ? undefined : "Only admins can generate this , ask one to run it for you"}
          >
            {aiPending ? "Generating…" : "Generate AI draft"}
          </Button>
          {!isSuper && (
            <span className="text-xs text-muted-foreground">Only admins can click this</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground -mt-1">
          Reads the repo, commits, journals and Hackatime data and drafts the fields below for
          you to check and edit. It never picks a verdict or hours , that&apos;s still on you.
        </p>
        {aiError && (
          <div className="text-xs text-rose-600 dark:text-rose-400">{aiError}</div>
        )}
        {aiDraft && (
          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2 text-sm">
            <div className="text-muted-foreground">{aiDraft.summary}</div>
            {aiDraft.redFlags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {aiDraft.redFlags.map((f, i) => (
                  <Badge key={i} variant="destructive">{f}</Badge>
                ))}
              </div>
            )}
            {aiDraft.strengths.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {aiDraft.strengths.map((s, i) => (
                  <Badge key={i} variant="success">{s}</Badge>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" size="sm" variant="outline" onClick={() => insertAiText("technicalFeatures", aiDraft.technicalFeatures)}>
                Insert into Technical features
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => insertAiText("hackatimeEvidence", aiDraft.hackatimeEvidence)}>
                Insert into Hackatime evidence
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => insertAiText("notes", aiDraft.notes)}>
                Insert into Notes
              </Button>
            </div>
            <div className="text-[10px] text-muted-foreground pt-1">Drafted by {aiDraft.model}</div>
          </div>
        )}
      </div>
      <div className="rounded-lg border p-4 flex flex-col gap-4">
        <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground leading-relaxed">
          Internal audit note , never shown to the player. Should let someone who
          wasn&apos;t involved reach the same conclusion you did.
        </div>
        <div>
          <Label className="text-xs font-normal text-muted-foreground mb-1.5 block leading-relaxed">
            Technical features , concrete accomplishments, not generic (&quot;OAuth
            auth, REST API, self-hosted Postgres&quot;, not &quot;React&quot;)
          </Label>
          <div className="relative">
            <Textarea
              name="technicalFeatures"
              required
              minLength={TECHNICAL_FEATURES_MIN}
              ref={technicalFeaturesRef}
              onChange={(e) => {
                setFeaturesLen(e.target.value.trim().length);
                saveDraft();
              }}
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
        </div>
        {hackatimeSeconds > 0 && (
          <div>
            <Label className="text-xs font-normal text-muted-foreground mb-1.5 block">
              Hackatime evidence
            </Label>
            <Textarea
              name="hackatimeEvidence"
              defaultValue={hackatimeDefault}
              ref={hackatimeEvidenceRef}
              onChange={() => saveDraft()}
              className="w-full text-sm"
              rows={3}
            />
          </div>
        )}
        {deflated && (
          <div>
            <Label className="text-xs font-normal text-muted-foreground mb-1.5 block">
              Why lower the hours? ({claimedHours}h claimed → {hours}h credited)
            </Label>
            <Textarea
              name="deflationReason"
              required
              ref={deflationReasonRef}
              onChange={() => saveDraft()}
              placeholder="Mismatched experience/features, missing commits, etc."
              className="w-full text-sm"
              rows={3}
            />
          </div>
        )}
        {ageFlag && (
          <div>
            <Label className="text-xs font-normal text-muted-foreground mb-1.5 block leading-relaxed">
              Age justification , this submitter turns 19 between shipping and this
              review
            </Label>
            <Textarea
              name="ageJustification"
              required
              ref={ageJustificationRef}
              onChange={() => saveDraft()}
              placeholder="Document the submitter's age at shipping vs. now."
              className="w-full text-sm"
              rows={3}
            />
          </div>
        )}
        <div>
          <Label className="text-xs font-normal text-muted-foreground mb-1.5 block">
            Additional notes
          </Label>
          <Textarea
            name="notes"
            required
            ref={notesRef}
            onChange={() => saveDraft()}
            placeholder="Anything else , suspicious commits, AI usage, experience mismatch…"
            className="w-full text-sm"
            rows={3}
          />
        </div>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            name="revealName"
            value="1"
            defaultChecked
            className="mt-0.5 h-4 w-4 rounded border-border accent-brand"
          />
          <span className="text-muted-foreground">
            Show my name to the player in this verdict&apos;s notification (approved / needs
            changes) , unticked sends it as &quot;the review team&quot; instead.
          </span>
        </label>
      </div>
      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={() => goToStep(1)}>
          ← Back
        </Button>
        <Button type="button" onClick={() => goToStep(3)}>
          Next: Verdict →
        </Button>
      </div>
      </div>

      <div className={step === 3 ? "flex flex-col gap-2" : "hidden"}>
      <Textarea
        name="note"
        required
        ref={noteRef}
        onChange={() => saveDraft()}
        placeholder="Feedback for the player (required)"
        className="w-full text-sm"
        rows={3}
      />
      <div className="flex flex-wrap gap-2 items-center">
        <Button type="button" variant="outline" onClick={() => goToStep(2)}>
          ← Back
        </Button>
        <VerdictButtons secondPass={secondPass} onVerdictSelect={onVerdictSelect} />
      </div>
      </div>
    </form>
    </>
  );
}
