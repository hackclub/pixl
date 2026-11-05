"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Button, label, Notice } from "@/components/ui/primitives";
import { goTo } from "@/components/use-action";
import { startAuthFlow } from "@/lib/actions/flows";
import { checkProjectReadme, shipProject, unshipProject } from "../actions";
import { hcaRecheckCopy, projectError, trialHoursCopy } from "../errors";
import type { ActionDetails } from "@/lib/guarded-action-core";
import { canUnship, type BlackoutState, type HtStats, type Project } from "../types";
import { BlackoutPanel } from "./blackout-panel";
import { CommitReminder } from "./commit-reminder";
import type { FormState } from "./editor-state";
import { CountedTextarea } from "./form-bits";
import { checklist, shipBlockers } from "./ship-checks";
import { checkRow, formGrid, hint } from "./styles";

type Dialog = null | "confirm" | "trial_hours" | "address" | "hca" | "unship";

export function ShipPanel({
  project,
  form,
  stats,
  cutoffMs,
  blackout,
  inReview,
  hasBirthday,
  save,
  pauseAutosave,
}: {
  project: Project;
  form: FormState;
  stats: HtStats | null;
  cutoffMs: number;
  blackout: BlackoutState;
  inReview: boolean;
  hasBirthday: boolean;
  save: () => Promise<number | null>;
  /** Keeps the editor's autosave from firing while a ship/unship runs. */
  pauseAutosave: <T>(fn: () => Promise<T>) => Promise<T>;
}) {
  const router = useRouter();
  const [eligible, setEligible] = useState(!!project.eligibility_attested || inReview);
  const [note, setNote] = useState(project.ship_note ?? "");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [details, setDetails] = useState<ActionDetails | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  const items = checklist(form, stats, cutoffMs);
  const repoUrl = form.repoUrl.trim();
  const checkVersion = useRef(0);
  const [checkedReadme, setCheckedReadme] = useState<{
    repoUrl: string;
    status: "passed" | "too_short" | "missing" | "unavailable" | "unsupported";
    words: number | null;
    minWords: number;
  } | null>(null);
  const readmeCheck = checkedReadme?.repoUrl === repoUrl ? checkedReadme : null;

  // Show README feedback automatically. Do not save the entire project just
  // to inspect its repo, and ignore obsolete responses when the URL changes.
  useEffect(() => {
    if (inReview || !repoUrl) return;
    let active = true;
    const version = ++checkVersion.current;
    const timer = setTimeout(() => {
      void checkProjectReadme({ id: project.id, repoUrl })
        .then((result) => {
          if (!active || version !== checkVersion.current) return;
          setCheckedReadme({
            repoUrl,
            ...(result.ok
              ? result.data
              : { status: "unavailable" as const, words: null, minWords: 200 }),
          });
        })
        .catch(() => {
          if (active && version === checkVersion.current)
            setCheckedReadme({ repoUrl, status: "unavailable", words: null, minWords: 200 });
        });
    }, 650);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [inReview, project.id, repoUrl]);

  async function tryShip() {
    const blockers = shipBlockers(project, form, stats, cutoffMs, eligible);
    if (blockers.length) return setMsg({ tone: "bad", text: `Can't ship yet: ${blockers.join("; ")}.` });
    // Re-check on submission too: the README may have changed on GitHub since
    // the automatic preview. The API repeats the gate before accepting a ship.
    const version = ++checkVersion.current;
    setPending(true);
    let result: Awaited<ReturnType<typeof checkProjectReadme>> | null = null;
    try {
      result = await checkProjectReadme({ id: project.id, repoUrl });
    } catch {
      // A temporary network failure must not prevent a human review.
    } finally {
      setPending(false);
    }
    if (result?.ok) {
      if (version === checkVersion.current) setCheckedReadme({ repoUrl, ...result.data });
      if (result.data.status === "missing" || result.data.status === "too_short") {
        return setMsg({
          tone: "bad",
          text: result.data.status === "missing"
            ? "No README found at the root of your GitHub project."
            : `README too short: ${result.data.words ?? 0}/${result.data.minWords} words of explanation. Add more before shipping.`,
        });
      }
    }
    setMsg(null);
    setDialog("confirm");
  }

  function ship(acceptNoTrialPrize = false) {
    return pauseAutosave(() => doShip(acceptNoTrialPrize));
  }

  async function doShip(acceptNoTrialPrize: boolean) {
    setPending(true);
    setMsg({ tone: "good", text: "Saving, then checking your repo and demo..." });
    // Shipping uses what's saved, so persist the form (ticked Hackatime boxes included) first.
    const saved = await save();
    if (!saved) {
      setPending(false);
      setDialog(null);
      return setMsg({ tone: "bad", text: "Couldn't save your edits, so nothing was shipped." });
    }
    const r = await shipProject({
      id: project.id,
      otherYsws: form.otherYsws,
      eligibilityAttested: eligible,
      shipNote: note.trim(),
      ...(form.isUpdate ? { updateNotes: form.updateNotes.trim() } : {}),
      ...(form.otherYsws ? { otherYswsNotes: form.otherYswsNotes.trim() } : {}),
      sidequestId: Number(form.sidequestId) || 0,
      ...(acceptNoTrialPrize ? { acceptNoTrialPrize: true } : {}),
    });
    setPending(false);
    if (r.ok) {
      setDialog(null);
      setMsg({ tone: "good", text: "SHIPPED! It's in the review queue." });
      return router.refresh();
    }
    setMsg(null);
    setDetails(r.details);
    if (r.error === "trial_hours_below_minimum") return setDialog("trial_hours");
    if (r.error === "address_required") return setDialog("address");
    if (r.error === "hca_verification_required") return setDialog("hca");
    setDialog(null);
    setMsg({ tone: "bad", text: projectError(r.error) });
  }

  async function flow(name: "verify-address" | "resync") {
    setPending(true);
    const r = await startAuthFlow({ name, returnTo: `/projects/${project.id}` });
    setPending(false);
    if (!r.ok || !goTo(r.data.url)) setMsg({ tone: "bad", text: projectError(r.ok ? "flow_failed" : r.error) });
  }

  function unship() {
    return pauseAutosave(doUnship);
  }

  async function doUnship() {
    setPending(true);
    const r = await unshipProject({ id: project.id });
    setPending(false);
    setDialog(null);
    if (!r.ok) return setMsg({ tone: "bad", text: projectError(r.error) });
    setMsg({ tone: "good", text: "Unshipped, it's a draft again, edit away." });
    router.refresh();
  }

  return (
    <>
      {!hasBirthday ? (
        <Notice className="mb-3">
          <Link href="/account">Add your birthday</Link> for Hack Club compliance, takes 10 seconds.
        </Notice>
      ) : null}
      <CommitReminder className="mb-3" />
      <div className={formGrid}>
        <div className="flex flex-col gap-[4px] text-[14px]">
          {items.map((i) => (
            <div key={i.label}>
              <span className={i.ok ? "font-bold text-good" : "font-bold text-bad"}>{i.ok ? "+" : "-"}</span> {i.label}
            </div>
          ))}
        </div>
        <p className={hint()}>
          <strong>Journal entries are optional, not required to ship.</strong> They&apos;re also what reviewers use to justify your
          hours, so an empty journal is the fastest way to get deflated.
        </p>
        {!inReview ? (
          <div className="rounded border border-ink/20 p-3">
            <strong className="text-[12px]">README PRE-CHECK</strong>
            <p className={hint()}>Your GitHub README needs 200+ explanatory words. Images, badges, links, and code don't count.</p>
            <p className={readmeCheck?.status === "passed" ? "text-sm font-bold text-good" : "text-sm text-dim"}>
              {!repoUrl
                ? "Add your repo URL to see the README check."
                : !readmeCheck
                  ? "Checking README automatically..."
                : readmeCheck.status === "passed"
                  ? `Passed: ${readmeCheck.words}/${readmeCheck.minWords} words`
                  : readmeCheck.status === "too_short"
                    ? `Too short: ${readmeCheck.words}/${readmeCheck.minWords} words`
                    : readmeCheck.status === "missing"
                      ? "No README found in the project root."
                      : "Automatic check unavailable for this repo. Human review still applies."}
            </p>
            <p className={hint()}>
              {readmeCheck?.status === "missing" || readmeCheck?.status === "too_short"
                ? "Need help fixing your README? "
                : "Need help writing your README? "}
              <Link
                href="https://gist.github.com/FaizeenHoque/0709576cc598721df07fb62d2430e6fe"
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold underline"
              >
                See the README template
              </Link>
              {" "}for reference. Explain your own project in your own words.
            </p>
          </div>
        ) : null}
        <BlackoutPanel project={project} blackout={blackout} inReview={inReview} />
        <label className={checkRow}>
          <input type="checkbox" checked={eligible} disabled={inReview} onChange={(e) => setEligible(e.target.checked)} />
          This isn&apos;t a school assignment or paid Hack Club work
        </label>
        {!inReview ? (
          <div>
            <span className={label}>NOTE TO REVIEWER (optional)</span>
            <CountedTextarea
              value={note}
              onChange={setNote}
              max={2000}
              placeholder="Anything a reviewer should know: demo quirks, where to look, hardware that's hard to film..."
            />
          </div>
        ) : null}
        {inReview ? (
          <>
            <Notice>
              {canUnship(project)
                ? "This project is in the review queue, you can't edit it until it's reviewed. Unship it if you need to make changes."
                : "A reviewer has already started on this project, so it can't be unshipped or edited until the review is done."}
            </Notice>
            <div className="flex flex-wrap gap-2">
              <Button variant="dark" disabled>
                IN REVIEW
              </Button>
              {canUnship(project) ? (
                <Button disabled={pending} onClick={() => setDialog("unship")}>
                  UNSHIP TO EDIT
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button id="s-ship" disabled={pending} onClick={tryShip}>
              {pending ? "SHIPPING..." : form.isUpdate ? "SHIP UPDATE" : "SHIP FOR REVIEW"}
            </Button>
            <span className={hint()}>Shipping saves your edits first.</span>
          </div>
        )}
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      </div>

      <ConfirmDialog open={dialog === "confirm"} onOpenChange={(o) => !o && setDialog(null)} title="Before you ship..." confirmLabel="OK, ship it" pending={pending} onConfirm={() => ship()}>
        <p>
          Make sure you&apos;ve read the{" "}
          <Link href="/docs/shipping" target="_blank" className="underline">
            shipping requirements
          </Link>
          , ships that miss something in there get sent back by a reviewer.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "trial_hours"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Not quite there yet"
        description={trialHoursCopy(details)}
        confirmLabel="Ship anyway, no prize"
        pending={pending}
        onConfirm={() => ship(true)}
      />
      <ConfirmDialog
        open={dialog === "address"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Mailing address needed"
        description="Pixl needs a mailing address on file before this can ship. Verify it with Hack Club Auth, you'll come right back here after."
        confirmLabel="Verify address"
        pending={pending}
        onConfirm={() => flow("verify-address")}
      />
      <ConfirmDialog
        open={dialog === "hca"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={hcaRecheckCopy(details?.hcaStatus).title}
        description={hcaRecheckCopy(details?.hcaStatus).body}
        confirmLabel="Re-check status"
        pending={pending}
        onConfirm={() => flow("resync")}
      />
      <ConfirmDialog
        open={dialog === "unship"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Unship this project?"
        description="It leaves the review queue and goes back to a draft so you can edit it. You'll need to ship it again."
        confirmLabel="Unship"
        pending={pending}
        onConfirm={unship}
      />
    </>
  );
}
