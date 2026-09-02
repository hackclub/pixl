import type { ReactNode } from "react";

// Snapshot of the YSWS Project Submission Guidelines, rendered inline in the
// review onboarding gate. The final page is a recap of the highest-stakes rules
// (written for reviewers, not copied from the source). Keep in sync with
// https://hackclub.gitbook.io/ysws-project-submission-guidelines and bump
// GUIDELINES_VERSION in guidelines.ts when it changes.

export interface GuidelinePage {
  title: string;
  body: ReactNode;
}

// A highlighted callout for a rule reviewers must not miss.
function Key({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border-l-4 border-amber-500 bg-amber-500/10 px-3 py-2 text-sm">
      <strong>Important - </strong>
      {children}
    </p>
  );
}

export const GUIDELINE_PAGES: GuidelinePage[] = [
  {
    title: "YSWS Project Submission Guidelines",
    body: (
      <div className="space-y-3 text-sm leading-relaxed">
        <p>
          Every project submitted to a You Ship, We Ship (YSWS) program must
          include a complete set of required fields in its submission form. This
          document describes each field and the criteria it must satisfy for the
          project to be accepted. For exceptions, see <em>Project Exceptions</em>.
        </p>
        <p>
          These docs aren&apos;t a cage, they&apos;re a recompilation of the
          rules that have been in place so YSWS authors have something to
          reference. They evolve as Hack Club does; if a new program conflicts
          with a rule, the guidelines get revised.
        </p>
        <p className="text-muted-foreground">
          Read more about Quality &amp; Integrity:{" "}
          <a
            className="underline"
            href="https://news.hackclub.com/essays/quality-integrity-manager/"
            target="_blank"
            rel="noopener noreferrer"
          >
            news.hackclub.com/essays/quality-integrity-manager
          </a>
        </p>
      </div>
    ),
  },
  {
    title: "Project Exceptions",
    body: (
      <div className="space-y-3 text-sm leading-relaxed">
        <p>
          Some projects cannot be submitted to the YSWS unified database, even
          if they otherwise meet the normal requirements:
        </p>
        <p>
          <strong>Paid Hack Club work.</strong> Projects built as part of Hack
          Club employment or other paid Hack Club work cannot be submitted. This
          only applies to the paid work itself, personal projects built on your
          own unpaid time can still be submitted.
        </p>
        <p>
          <strong>School assignments.</strong> Projects made as part of a school
          assignment cannot be submitted to the unified database.
        </p>
      </div>
    ),
  },
  {
    title: "Required Submission Fields",
    body: (
      <div className="space-y-3 text-sm leading-relaxed">
        <p>
          <strong>Playable URL</strong> - a publicly accessible link where
          anyone can experience the project without significant technical
          knowledge. Valid: a browser game / web app, a downloadable executable,
          a hosted demo or interactive prototype.
        </p>
        <Key>
          A Playable URL is <strong>not</strong> satisfied by: a GitHub release
          with only source code, a project that must be compiled/built from
          source, a Colab/Jupyter/notebook runner (dev tools, not demos), or
          LeetCode / competitive-programming solutions. It only needs to run on
          at least one platform (Windows, macOS, Linux, or web).
        </Key>
        <p>
          <strong>Code URL</strong> - a version-control repo (GitHub preferred).
          Must be <strong>public</strong> and accessible without auth, should be
          open source (license encouraged), and must contain a{" "}
          <strong>README</strong> explaining what it is, how to set it up and run
          it.
        </p>
        <Key>
          The repo should have <strong>multiple commits</strong> reflecting real
          development progress. A single commit is <strong>not acceptable</strong>{" "}
          for a project claiming significant hours (a 20-hour project with one
          commit does not follow the guidelines).
        </Key>
        <p>
          <strong>Screenshot</strong> - must visually demonstrate the project (a
          running app/game, a photo of hardware/3D model). Must be a static image:{" "}
          <strong>no video (.mp4) and no animation (.gif)</strong>.
        </p>
        <p>
          <strong>Description</strong> - a clear, concise summary of what the
          project is and what it&apos;s for.
        </p>
        <p>
          <strong>Reproducibility</strong> - projects are meant to be used and
          recreated by someone with minimal technical knowledge using only the
          submission. Software: a README on how to experience it and what tech
          was used. Games: instructions on how to play / set up (README or the
          host page, e.g. itch.io). Hardware: the repo must contain everything to
          build it - PCB schematics/wiring diagrams, CAD in a{" "}
          <strong>modifiable</strong> format (.STEP, .blend - <strong>not</strong>{" "}
          .STL), and a README.
        </p>
      </div>
    ),
  },
  {
    title: "Override Hours Spent",
    body: (
      <div className="space-y-3 text-sm leading-relaxed">
        <p>
          This field records the hours being approved. It must represent the
          genuine effort put into the project. Reviewers may deflate the hours
          when evidence shows the claim doesn&apos;t reflect reality. For an{" "}
          <strong>update</strong>, only count hours since the last submission.
        </p>
        <Key>
          <strong>Default to deflation.</strong> When in doubt, deflate
          aggressively, it&apos;s far better to under-approve than to let
          inflated hours into the database. Give submitters the benefit of the
          doubt on <em>intent</em>, but never on the <em>number</em>.
        </Key>
        <Key>
          <strong>Outright fraud → reject, don&apos;t record.</strong> Fabricated
          Hackatime (scripted heartbeats), plagiarized projects, fake/manufactured
          commit history, or any deliberate deception should not be entered at
          all. Do not deflate to zero, simply do not create a record.
        </Key>
        <p>
          <strong>Deflation 1 - Inflated hours.</strong> Hours must be
          proportional to complexity/scope (a plain HTML page isn&apos;t 10
          hours). This is <em>not</em> to penalize beginners, learning time
          counts. Deflate when these converge: no commits showing incremental
          progress, fraud-like Hackatime patterns, and complexity that
          doesn&apos;t match the hours.
        </p>
        <p>
          <strong>Deflation 2 - AI-generated code.</strong> AI use is permitted
          (even mostly-AI projects) as long as there was genuine effort, it works,
          and the submitter learned something. The question is &quot;how much
          genuine effort?&quot; not &quot;how much did AI write?&quot;.{" "}
          <strong>AI slop</strong> (one prompt, no iteration/testing/refinement,
          no engagement) is not eligible - reject it. When unsure, deflate to what
          you&apos;re confident they did. Programs may be stricter, never more
          relaxed.
        </p>
        <Key>
          <strong>Art &amp; assets ≤ 25%.</strong> Time on art/asset creation
          (sprites, 3D models, sound, level design) can count if it&apos;s part of
          the core project, but must not exceed <strong>25%</strong> (one quarter)
          of the total approved hours.
        </Key>
      </div>
    ),
  },
  {
    title: "Override Hours Spent Justification",
    body: (
      <div className="space-y-3 text-sm leading-relaxed">
        <p>
          The standard: someone <em>not</em> involved in the review should be
          able to read your justification, follow the links, and reach the same
          conclusion. It must contain specific, verifiable info - links, numbers,
          concrete observations. It is <strong>internal</strong> (the submitter
          never sees it) and is <strong>not</strong> for encouragement or
          feedback.
        </p>
        <p>
          <strong>Justification fields:</strong>
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Hackatime project name(s) &amp; date range(s)</strong> -
            comma-separated. E.g.{" "}
            <code>hackatime-project 7/20/2026-7/22/2026, project-2 7/21-7/23</code>
            . For an update, only dates after the previous submission.
          </li>
          <li>
            <strong>Specific technical features</strong> - what specifically
            explains the hours (not just a list of languages).
          </li>
          <li>
            <strong>Alternate tracking method</strong> - what method (self-report,
            base amount, in-house tracker) and why you trust the number.
          </li>
          <li>
            <strong>Deflation justification</strong> - the number deflated to, and
            why. E.g. &quot;Deflated 10h → 2.5h: only basic HTML/CSS/JS, user has
            built sites before, UI clearly AI-made.&quot;
          </li>
          <li>
            <strong>Additional justification</strong> - for suspicious submissions
            (few significant commits vs hours, suspicious heartbeats, high AI% vs
            commits). Include submitter experience with evidence and why it does
            or doesn&apos;t match the features. Missing this on a suspicious
            submission can get <em>you</em> fined on spot-check.
          </li>
        </ul>
        <Key>
          What does <strong>not</strong> pass: &quot;Hackatime checks out&quot;,
          &quot;Looks solid, approving 10 hours&quot;, a bare Hackatime project
          name with no analysis, or &quot;Good job :)&quot;. Cite evidence anyone
          could go verify.
        </Key>
      </div>
    ),
  },
  {
    title: "Duplicate and Updated Submissions",
    body: (
      <div className="space-y-3 text-sm leading-relaxed">
        <p>
          A project may be submitted more than once if it received a{" "}
          <strong>meaningful update</strong> since its last submission. Each
          record must represent a distinct block of effort.
        </p>
        <Key>
          <strong>Not allowed:</strong> submitting the same work with the same
          hours to multiple programs and getting both approved. Attribution goes
          to the first program to approve a project.
        </Key>
        <p>
          <strong>Same-program updates:</strong> create a new record that approves{" "}
          <strong>only the new hours</strong>. The justification must state it&apos;s
          an update, reference how many hours were previously approved, and
          describe the new work. E.g. &quot;Previously approved 10h; added
          multiplayer + 3 levels; approving 4h for the update.&quot;
        </p>
        <p>
          <strong>Cross-program updates:</strong> new record, new hours only -
          hours already approved under the original program must not be counted
          again.
        </p>
      </div>
    ),
  },
  {
    title: "Spot-check Verdicts",
    body: (
      <div className="space-y-3 text-sm leading-relaxed">
        <p>Possible verdicts on a spot-check:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Accepted</strong> - no changes needed; stays in the Unified
            Database.
          </li>
          <li>
            <strong>Needs Changes (fine issued)</strong> - doesn&apos;t qualify as
            is, but can be resubmitted after changes.
          </li>
          <li>
            <strong>Rejected (fine issued)</strong> - can&apos;t qualify even with
            changes; should not be resubmitted.
          </li>
        </ul>
        <p>
          <strong>Disputes:</strong> spot-checkers make mistakes, you can raise
          one. You must <em>prove with evidence</em> the criteria were met and the
          checker erred (e.g. the screenshot does match, it&apos;s just dark
          mode). You can&apos;t dispute with an after-the-fact excuse; issues
          should have been resolved before submission.
        </p>
        <p>
          <strong>Resubmitting:</strong> &quot;Needs Changes&quot; and
          &quot;Rejected&quot; projects are removed from the database. Needs
          Changes can be resubmitted after fixing; Rejected should not be
          resubmitted unless a spot-checker gives permission.
        </p>
      </div>
    ),
  },
  {
    title: 'What Makes a Project "Shipped"?',
    body: (
      <div className="space-y-3 text-sm leading-relaxed">
        <p>
          All projects end up in the Unified Database, and everything there must
          be shipped. Generally, a shipped project:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Works - at least as a minimum viable product.</li>
          <li>Has its full code published somewhere like GitHub.</li>
          <li>Can be experienced by anyone with minimal technical knowledge.</li>
          <li>Requires &lt; 2 minutes of setup.</li>
        </ul>
        <p>
          Ship format varies by type (software, games, hardware, contributions/PRs,
          platform-specific like Sprig or custom hardware). For an unusual project
          or a new YSWS model, run the ship format by Max or a spot-checker.
        </p>
        <Key>
          <strong>Disallowed hosts:</strong> generic web hosts and demo videos in
          uncommon/proprietary formats aren&apos;t accepted. For a video, use a
          hosted/downloadable <code>.mp4</code> via #cdn (preferred) or on GitHub.
        </Key>
      </div>
    ),
  },
  {
    title: "🔑 Recap - the rules that matter most",
    body: (
      <div className="space-y-3 text-sm leading-relaxed">
        <p className="text-muted-foreground">
          The whole doc matters, but these are the ones that decide most reviews.
          Internalize them.
        </p>
        <ul className="space-y-2">
          <li>
            <Key>
              <strong>Default to deflation.</strong> When in doubt, deflate hard.
              Benefit of the doubt on intent, never on the number.
            </Key>
          </li>
          <li>
            <Key>
              <strong>Outright fraud → reject, don&apos;t record it.</strong> Fake
              Hackatime, plagiarism, manufactured commits = no record at all (not
              &quot;deflate to 0&quot;).
            </Key>
          </li>
          <li>
            <Key>
              <strong>AI slop → reject.</strong> One prompt, no iteration/learning.
              AI with genuine effort that works and taught them something is fine.
            </Key>
          </li>
          <li>
            <Key>
              <strong>Art &amp; assets ≤ 25%</strong> of total approved hours.
            </Key>
          </li>
          <li>
            <Key>
              <strong>Required fields:</strong> Playable URL (publicly
              experienceable - not source-only / compile-from-source / notebooks),
              Code URL (public + README + multiple commits; single commit ≠ ok for
              big hours), Screenshot (static image, no gif/mp4), Description,
              Reproducibility.
            </Key>
          </li>
          <li>
            <Key>
              <strong>Justification must be verifiable by an outsider</strong> -
              Hackatime name + dates, links, numbers. No &quot;checks out&quot; /
              &quot;looks good&quot; / &quot;good job&quot;.
            </Key>
          </li>
          <li>
            <Key>
              <strong>No duplicate hours.</strong> Updates = new record, new hours
              only. Can&apos;t approve the same work twice.
            </Key>
          </li>
          <li>
            <Key>
              <strong>Shipped =</strong> works (MVP) + code on GitHub + anyone can
              run it in &lt; 2 min.
            </Key>
          </li>
          <li>
            <Key>
              <strong>Can&apos;t be submitted:</strong> paid Hack Club work and
              school assignments.
            </Key>
          </li>
        </ul>
      </div>
    ),
  },
];
