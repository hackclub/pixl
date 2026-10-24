import type { EligibilityResult, EligibilityStatus } from "@/lib/eligibility/engine";
import {
  AIRTABLE_LABEL,
  ELIGIBILITY_HINT,
  ELIGIBILITY_LABEL,
  ELIGIBILITY_SHORT,
  ELIGIBILITY_TONE,
  usd,
} from "@/lib/eligibility/format";
import { airtableRecordUrl } from "@/lib/airtable";
import { VERIFICATION_LABEL, VERIFICATION_TONE, syncAgeText } from "@/lib/eligibility/format";
import type { ShipsView } from "@/lib/eligibility/ships";
import { refreshShipsSnapshot } from "@/app/actions";
import { ActionButton, Badge, Callout, DescriptionList, Muted, TextLink } from "@/app/_ui/ui";

export function VerificationBadge({ label }: { label: keyof typeof VERIFICATION_LABEL }) {
  return (
    <Badge tone={VERIFICATION_TONE[label]} outline={label !== "verified"}>
      {VERIFICATION_LABEL[label]}
    </Badge>
  );
}

export function ShipsSyncBar({ view }: { view: ShipsView }) {
  const snap = view.snapshot;
  const ok = !!snap && !view.error;
  return (
    <div className="fw-sync" data-state={ok ? "ok" : snap ? "stale" : "down"} role="status">
      <span>
        {snap ? (
          <>
            Ships synced <strong>{syncAgeText(view.ageMs)}</strong> · {snap.pixlCount} PIXL entries
            {snap.invalidCount + snap.duplicateCount > 0 && ` (${snap.invalidCount + snap.duplicateCount} unusable)`}
          </>
        ) : (
          <>Ships has not been reached. Project hours cannot be verified; reviewer payout ledger funding can still cover orders.</>
        )}
        {view.error && <Muted> · last refresh failed: {view.error}</Muted>}
      </span>
      <form action={refreshShipsSnapshot}>
        <ActionButton variant="outline" pendingLabel="Refreshing...">
          Refresh Ships
        </ActionButton>
      </form>
    </div>
  );
}

export function FundingBadge({ status, short = false }: { status: EligibilityStatus | null; short?: boolean }) {
  if (!status) return <Badge tone="neutral" outline>Unverified</Badge>;
  return (
    <span title={ELIGIBILITY_HINT[status]}>
      <Badge tone={ELIGIBILITY_TONE[status]} outline={status === "unverified"}>
        {short ? ELIGIBILITY_SHORT[status] : ELIGIBILITY_LABEL[status]}
      </Badge>
    </span>
  );
}

const BASIS_LABEL = { face: "Grant face value", actual: "Recorded supplier cost", budget: "Shop budget" } as const;

function ageText(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

function pixelsText(pixels: number): string {
  return `${pixels.toLocaleString(undefined, { maximumFractionDigits: 2 })} px`;
}

function signedPixelsText(pixels: number): string {
  return `${pixels < 0 ? "−" : ""}${Math.abs(pixels).toLocaleString(undefined, { maximumFractionDigits: 2 })} px`;
}

export function FundingBreakdown({ result, orderId }: { result: EligibilityResult | null; orderId: number }) {
  if (!result) {
    return (
      <Callout tone="warning" icon="important">
        <strong>Unverified.</strong> Eligibility evidence could not be loaded. Check funding by hand before claiming.
      </Callout>
    );
  }
  const r = result;
  const shipsVerifiedHours = r.projects
    .filter((p) => p.counted === "verified" && p.ships?.state === "approved")
    .reduce((sum, p) => sum + p.countedHours, 0);
  const otherVerifiedProjectHours = Math.max(0, r.verifiedHours - shipsVerifiedHours);
  return (
    <div className="fw-funding">
      {r.projects.length > 0 ? (
        <p className="fw-funding-verdict">
          <VerificationBadge label={r.verification} /> <span>{r.verificationSummary}</span>
        </p>
      ) : (
        <p className="fw-funding-verdict">
          <Badge tone="neutral" outline>No project earnings</Badge>{" "}
          <Muted>Reviewer earnings are checked independently against the payout ledger.</Muted>
        </p>
      )}
      <p className="fw-funding-verdict">
        <FundingBadge status={r.status} /> <Muted>{ELIGIBILITY_HINT[r.status]}</Muted>
      </p>
      {r.reasons.length > 0 && (
        <ul className="fw-funding-reasons">
          {r.reasons.map((x) => (
            <li key={x.code}>{x.message}</li>
          ))}
        </ul>
      )}

      <div className="fw-funding-scroll">
      <table className="fw-funding-table">
        <caption className="sr-only">Projects counted toward funding</caption>
        <thead>
          <tr>
            <th>Project</th>
            <th>Hours</th>
            <th>Verification</th>
            <th>Funding</th>
            <th>Counted</th>
          </tr>
        </thead>
        <tbody>
          {r.projects.length === 0 && (
            <tr>
              <td colSpan={5}>
                <Muted>No projects mapped to this player.</Muted>
              </td>
            </tr>
          )}
          {r.projects.map((p) => {
            const airtableUrl = p.airtableRecordId ? airtableRecordUrl(p.airtableRecordId) : null;
            return (
              <tr key={`${p.projectId}-${p.role}`} data-counted={p.counted}>
                <td>
                  <TextLink href={`/projects/${p.projectId}`}>{p.name || `Project ${p.projectId}`}</TextLink>
                  {p.role === "collaborator" && <Muted> (collaborator)</Muted>}
                </td>
                <td className="tabular-nums">
                  {p.hours.toFixed(1)}h
                  {p.originalHours != null && p.originalHours !== p.hours && (
                    <Muted> (was {p.originalHours.toFixed(1)}h)</Muted>
                  )}
                  {p.ships?.hours != null && (
                    <>
                      <br />
                      <Muted>
                        Ships {p.ships.hours}h
                        {p.discrepancy !== "none" && ` · counted ${p.countedHours.toFixed(1)}h`}
                      </Muted>
                    </>
                  )}
                </td>
                <td>
                  <VerificationBadge label={p.verification} />
                  <br />
                  <Muted>{p.verificationNote}</Muted>
                  <br />
                  <Muted>{AIRTABLE_LABEL[p.airtable]}</Muted>
                  {airtableUrl && (
                    <>
                      {" "}
                      <TextLink href={airtableUrl} external>
                        staging
                      </TextLink>
                    </>
                  )}
                </td>
                <td className="tabular-nums">
                  {p.fundingSource === "payout" && p.payoutCents != null && (
                    <>
                      {usd(p.payoutCents)}
                      <br />
                      <Muted>
                        ${p.effectiveRateUsd?.toFixed(2)}/h from payout history{p.payoutCapped ? ", capped at the maximum rate" : ""}
                      </Muted>
                    </>
                  )}
                  {p.fundingSource === "none" && <Muted>No payout history, funding not established</Muted>}
                  {p.fundingSource === "flat" && <Muted>${p.effectiveRateUsd?.toFixed(2)}/h flat rate</Muted>}
                </td>
                <td>
                  {p.counted === "verified" && "Verified"}
                  {p.counted === "provisional" && "Unverified"}
                  {p.counted === "excluded" && <Muted>Excluded: {p.excludedReason}</Muted>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      <DescriptionList
        items={[
          ["Ships verified hours", `${shipsVerifiedHours.toFixed(1)}h`],
          ["Other verified project hours", `${otherVerifiedProjectHours.toFixed(1)}h (Unified)`],
          ["Unverified project hours", `${r.provisionalHours.toFixed(1)}h`],
          ["Verified project funding", <span key="project">{usd(r.projectVerifiedFundingCents)} <Muted>({r.fundingBasis === "payout_history" ? `average $${r.rateUsd.toFixed(2)} per verified project hour, from payout history` : `$${r.rateUsd.toFixed(2)} per verified hour`})</Muted></span>],
          ["Unverified project funding", <span key="unverified-project">{usd(r.unverifiedProjectFundingCents)} <Muted>(upper bound only)</Muted></span>],
          ["Reviewer pixels credited", pixelsText(r.reviewerEarnings.creditedPixels)],
          ["Reviewer corrections / reversals", signedPixelsText(r.reviewerEarnings.correctionPixels)],
          ["Net verified reviewer pixels", r.reviewerEarnings.state === "verified" ? pixelsText(r.reviewerEarnings.verifiedPixels) : "Not verified"],
          [
            "Reviewer funding (USD equivalent)",
            <span key="reviewer">
              {usd(r.reviewerEarnings.fundingCents)}{" "}
              <Muted>
                {r.reviewerEarnings.state === "verified"
                  ? "Verified by payout ledger"
                  : r.reviewerEarnings.state === "unavailable"
                    ? "Payout ledger unavailable; reviewer funding excluded"
                    : "Payout ledger inconsistent; reviewer funding excluded pending review"}
              </Muted>
            </span>,
          ],
          ["Combined verified earned funding", usd(r.verifiedFundingCents)],
          ["Earned if every unverified project hour holds", usd(r.upperBoundFundingCents)],
          [
            "Already committed",
            r.commitments.length === 0 && r.priorGrants.length === 0 ? (
              usd(0)
            ) : (
              <span key="c">
                {usd(r.committedCents)}
                <ul className="fw-funding-list">
                  {r.commitments.map((c) => (
                    <li key={c.orderId}>
                      <TextLink href={`/fulfillment?status=all&order=${c.orderId}`}>Order #{c.orderId}</TextLink>{" "}
                      {c.itemName} ({c.status}) {usd(c.cents)}
                      {c.source === "derived" && <Muted> · not in ledger</Muted>}
                    </li>
                  ))}
                  {r.priorGrants.map((g) => (
                    <li key={`g${g.projectId}`}>
                      <TextLink href={`/projects/${g.projectId}`}>{g.name}</TextLink> project grant {usd(Math.round(g.usd * 100))}
                    </li>
                  ))}
                </ul>
              </span>
            ),
          ],
          ["Funding remaining", usd(r.remainingCents)],
          [
            "Requested order cost",
            <span key="o">
              {usd(r.amount.cents)} <Muted>({BASIS_LABEL[r.amount.basis]}; {r.amount.pixels.toLocaleString()} px paid, budget {usd(r.amount.budgetCents)})</Muted>
            </span>,
          ],
          ["Funding remaining after this order", usd(r.afterCents)],
          ["Remaining after, if unverified project hours hold", usd(r.provisionalRemainingCents - r.amount.cents)],
        ]}
      />
      <p className="hc-caption text-xs">
        Policy {r.policyVersion}. Evidence loaded {ageText(r.evidenceAgeMs)}
        {r.stale ? " (stale)" : ""}. Airtable {r.integrations.airtable ? "readable" : "unreachable"}, Verification source{" "}
        {r.integrations.unified ? "readable" : "unavailable"}. Ships{" "}
        {r.ships.fetchedAt == null ? "never synced" : `synced ${ageText(r.ships.ageMs ?? 0)}${r.ships.stale ? " (stale)" : ""}`}. Order #{orderId}.
      </p>
    </div>
  );
}
