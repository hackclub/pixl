"use client";

import { useState } from "react";
import { BlackoutBadge } from "@/app/_components/BlackoutBadge";

export interface BlackoutReviewPerson {
  userId: string;
  name: string;
  role: "owner" | "collaborator";
  hackatimeBaseSeconds: number;
  journalBaseSeconds: number;
  fixTrackedSeconds: number;
  eligibleTrackedSeconds: number;
  evidenceOk: boolean;
  proposedHours: number | null;
  claimedHours: number | null;
}

export interface BlackoutReviewData {
  operationName: string;
  rateUsd: number;
  rateMode: "floor" | "additive";
  operationStartsAt: string;
  operationEndsAt: string;
  joinedAt: string;
  windowStart: string;
  firstShipAt: string;
  reshipCount: number;
  changesRequestedAt: string | null;
  graceDeadline: string | null;
  fixWindowEnd: string | null;
  decision: "eligible" | "ineligible" | null;
  decisionNote: string;
  decisionBy: string;
  decisionStage: string;
  trialHold: { name: string } | null;
  people: BlackoutReviewPerson[];
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }) + " UTC";
const h2 = (seconds: number) => `${Math.round((seconds / 3600) * 100) / 100}h`;
const maxHours = (p: BlackoutReviewPerson) => Math.round((p.eligibleTrackedSeconds / 3600) * 100) / 100;

export function BlackoutReviewSection({ data }: { data: BlackoutReviewData }) {
  const [decision, setDecision] = useState<"eligible" | "ineligible" | "">(data.decision ?? "");
  const graceActive = data.reshipCount > 0 && data.fixWindowEnd;
  const incompleteNames = data.people.filter((p) => !p.evidenceOk).map((p) => p.name);

  return (
    <fieldset className="rounded-lg border border-amber-300/70 dark:border-amber-500/40 bg-amber-50/50 dark:bg-amber-500/[0.06] p-3 grid gap-3 min-w-0">
      <legend className="px-1.5 flex items-center gap-2">
        <BlackoutBadge />
        <span className="text-xs font-semibold">{data.operationName} entry</span>
      </legend>

      <p className="text-xs text-muted-foreground">
        Rule on whether this counts for Blackout, and how many tracked hours inside the window are approved. You never
        set a rate: Pixl pays each person{" "}
        {data.rateMode === "additive"
          ? <>their own rate + ${data.rateUsd.toFixed(2)}/hr</>
          : <>max(their own rate, ${data.rateUsd.toFixed(2)}/hr)</>}
        {" "}on the approved hours, once.
      </p>

      <ul className="text-xs text-muted-foreground list-disc pl-4 grid gap-0.5">
        <li>Joined during the event, not after the fact</li>
        <li>The project genuinely fits the Blackout prompt</li>
        <li>The approved hours were worked inside the window below</li>
      </ul>

      {data.decisionBy && data.decision && (
        <div className="text-xs rounded-md border border-border bg-background/60 p-2">
          {data.decisionStage === "first_pass" ? "First pass proposed" : "Previously ruled"}: <b>{data.decision}</b>
          {data.decisionNote ? ` , ${data.decisionNote}` : ""} <span className="text-muted-foreground">({data.decisionBy.replace(/\s*\([^)]*\)\s*$/, "")})</span>
        </div>
      )}

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Operation</dt><dd className="text-right">{fmt(data.operationStartsAt)} → {fmt(data.operationEndsAt)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Joined</dt><dd className="text-right">{fmt(data.joinedAt)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">First Blackout ship</dt><dd className="text-right">{fmt(data.firstShipAt)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Counted window</dt><dd className="text-right">{fmt(data.windowStart)} → {fmt(data.firstShipAt)}</dd></div>
        {data.changesRequestedAt && (
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Changes requested</dt><dd className="text-right">{fmt(data.changesRequestedAt)}{data.graceDeadline ? ` (fix by ${fmt(data.graceDeadline)})` : ""}</dd></div>
        )}
        {data.reshipCount > 0 && (
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Reships</dt><dd className="text-right">{data.reshipCount}</dd></div>
        )}
      </dl>
      {graceActive && (
        <p className="text-xs text-muted-foreground">
          Work after the first ship counts only inside the fix window, and only a small slice (the greater of 1h or 25% of the
          original hours). It is already capped in the numbers below.
        </p>
      )}
      {incompleteNames.length > 0 && (
        <div role="alert" className="rounded-md border-2 border-rose-400 dark:border-rose-500/70 bg-rose-50 dark:bg-rose-500/10 p-2.5 text-xs grid gap-0.5">
          <b className="text-rose-700 dark:text-rose-300 uppercase tracking-wide">Time evidence incomplete</b>
          <span>
            Hackatime couldn&apos;t be read at ship time for {incompleteNames.join(", ")}, so the tracked hours below may be
            under-counted. Pixl can&apos;t raise the ceiling for you. If the work looks bigger than the numbers, leave a note
            rather than guessing.
          </span>
        </div>
      )}
      {data.trialHold && (
        <div role="alert" className="rounded-md border-2 border-amber-400 dark:border-amber-500/70 bg-amber-100/60 dark:bg-amber-500/10 p-2.5 text-xs grid gap-0.5">
          <b className="text-amber-800 dark:text-amber-300 uppercase tracking-wide">Trial payout held</b>
          <span>
            This ship is for the Trial &quot;{data.trialHold.name}&quot;. The owner&apos;s pixels are held until they pick
            pixels over the prize, and their Blackout top-up is skipped on this approval (not deferred). Collaborators are
            still topped up.
          </span>
        </div>
      )}

      <div className="grid gap-2">
        {data.people.map((p) => {
          const cap = maxHours(p);
          const start = p.proposedHours ?? Math.min(cap, p.claimedHours ?? cap);
          return (
            <div key={p.userId} className="rounded-md border border-border bg-background/60 p-2.5 grid gap-1.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm font-medium">
                  {p.name} <span className="text-xs text-muted-foreground font-normal">{p.role}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  tracked in window: {h2(p.hackatimeBaseSeconds)} Hackatime + {h2(p.journalBaseSeconds)} journal
                  {p.fixTrackedSeconds > 0 ? ` · fix window ${h2(p.fixTrackedSeconds)} (capped)` : ""}
                </span>
              </div>
              <label className="flex items-center gap-2 text-xs flex-wrap">
                <span>Approved Blackout hours</span>
                <input
                  type="number"
                  name={`blackoutHours_${p.userId}`}
                  defaultValue={decision === "ineligible" ? 0 : start}
                  step="any"
                  inputMode="decimal"
                  onBlur={(e) => {
                    const n = Number(e.currentTarget.value);
                    e.currentTarget.value = String(
                      Number.isFinite(n) ? Math.min(Math.max(n, 0), cap) : 0,
                    );
                  }}
                  disabled={decision === "ineligible"}
                  className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums disabled:opacity-50"
                />
                <span className="text-muted-foreground">
                  max {cap}h{p.claimedHours != null ? ` · normal credit ${Math.round(p.claimedHours * 100) / 100}h` : ""}
                </span>
              </label>
              {decision === "ineligible" && <input type="hidden" name={`blackoutHours_${p.userId}`} value="0" />}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-4 flex-wrap text-sm" role="radiogroup" aria-label="Blackout eligibility">
        <label className="flex items-center gap-1.5">
          <input type="radio" name="blackoutDecision" value="eligible" checked={decision === "eligible"} onChange={() => setDecision("eligible")} />
          Eligible
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="blackoutDecision" value="ineligible" checked={decision === "ineligible"} onChange={() => setDecision("ineligible")} />
          Not eligible
        </label>
      </div>
      {decision === "ineligible" && (
        <p className="text-xs text-muted-foreground">
          This is the &quot;not a Blackout project, treat it as a normal PIXL project instead&quot; call: it only removes the
          Blackout bonus path. It never changes this project&apos;s normal review, decision, or payout below.
        </p>
      )}
      <label className="grid gap-1 text-xs">
        <span>Reason / adjustment note{decision === "ineligible" ? " (required)" : ""}</span>
        <textarea
          name="blackoutNote"
          defaultValue={data.decisionNote}
          maxLength={1000}
          rows={2}
          placeholder={decision === "ineligible" ? "Why doesn't this count for Blackout?" : "Optional: why the hours were lowered, what you checked"}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        />
      </label>
    </fieldset>
  );
}
