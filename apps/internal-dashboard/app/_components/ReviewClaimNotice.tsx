import { Badge, ButtonLink, Icon, type Tone } from "@/app/_ui/ui";
import { ClaimActivityLine, ClaimRefreshButton } from "./ReviewClaimLive";

export type ReviewClaimStage = "first-pass" | "spot-check" | "final-pass";

const STAGE_LABEL: Record<ReviewClaimStage, string> = {
  "first-pass": "First pass",
  "spot-check": "Spot check",
  "final-pass": "Final pass",
};

const STAGE_TONE: Record<ReviewClaimStage, Tone> = {
  "first-pass": "warning",
  "spot-check": "cyan",
  "final-pass": "danger",
};

const STAGE_ACTION: Record<ReviewClaimStage, string> = {
  "first-pass": "is reviewing this submission.",
  "spot-check": "is spot checking this submission.",
  "final-pass": "is on the final pass of this submission.",
};

// Shown on the review detail page when another reviewer holds the live claim.
// Deliberately richer than a one-line warning: it names the holder (unless live
// mode is hiding names), says which stage they're on, shows how fresh their
// heartbeat is and when the claim frees up, and gives a retry path for the
// common case where they've walked away.
export function ReviewClaimNotice({
  stage,
  name,
  handle,
  slackId,
  claimedAt,
  expiresAt,
  serverNow,
}: {
  stage: ReviewClaimStage;
  /** Display name or handle for the holder, already masked in live mode. */
  name: string;
  /** "@handle" when Slack resolved one and names are visible. */
  handle: string | null;
  /** Safe to link to Slack only when live mode isn't hiding this reviewer. */
  slackId: string | null;
  /** Heartbeat timestamp behind reviewing_at, if it survived the round trip. */
  claimedAt: string | null;
  expiresAt: string | null;
  serverNow: number;
}) {
  const stageLabel = STAGE_LABEL[stage];
  const initial = (handle ?? name).replace(/^@/, "").trim().charAt(0).toUpperCase() || "R";
  const messageLabel = handle ? `Message ${handle}` : "Message reviewer";

  return (
    <section className="hc-claim" data-stage={stage} aria-label="Another reviewer is reviewing this">
      <div className="flex items-start gap-3">
        <span className="hc-claim-avatar" aria-hidden>
          {slackId ? initial : <Icon glyph="private" size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="hc-claim-live">
              <span className="hc-claim-dot" aria-hidden />
              Live review
            </span>
            <Badge tone={STAGE_TONE[stage]}>{stageLabel}</Badge>
            <span className="hc-caption ml-auto text-xs">Grading locked</span>
          </div>
          <p className="hc-claim-title mt-2">
            {name} {STAGE_ACTION[stage]}
          </p>
          <p className="hc-claim-copy mt-1">
            The verdict form is locked while their claim is live, so two reviewers can&apos;t grade the same
            submission. You can still read the project, journals and existing notes.
          </p>
        </div>
      </div>

      <div className="hc-claim-footer">
        <span className="hc-caption text-xs">
          {claimedAt && expiresAt ? (
            <ClaimActivityLine claimedAt={claimedAt} expiresAt={expiresAt} serverNow={serverNow} />
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Icon glyph="clock" size={15} className="hc-muted" />
              Refreshes while they&apos;re on the page
            </span>
          )}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {slackId && (
            <ButtonLink
              href={`https://hackclub.slack.com/team/${slackId}`}
              external
              variant="ghost"
              size="sm"
              icon="slack"
            >
              {messageLabel}
            </ButtonLink>
          )}
          <ClaimRefreshButton />
        </div>
      </div>
    </section>
  );
}
